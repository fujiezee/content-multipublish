import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import {
  generateVideoSeries,
  generateNextEpisode,
  regenerateOneEpisode,
  writeSeriesPremise,
  shotsFromJson,
  shotsToJson,
  bindShotSpeakers,
  bindShotsToVoiceover,
  canonicalizeVoiceover,
  clampEpisodeCount,
  MAX_EPISODE_COUNT,
  MAX_SERIES_CAST,
} from "@/lib/ai/video-script";
import {
  clampEpisodeDuration,
  durationBudget,
  genreFromHookStyle,
  normalizeHookStyle,
} from "@/lib/ai/video-script-styles";
import { normalizeLookStyle } from "@/lib/ai/look-styles";
import { resolveScriptSourceKind } from "@/lib/ai/script-import";
import {
  videoGenConfigured,
  videoGenModels,
  videoGenModelsWithOpen,
} from "@/lib/ai/video-gen";
import { listImageGenModels } from "@/lib/ai/image-gen-models";
import { listScriptLlmOptions, withScriptLlm } from "@/lib/ai/script-llm";
import {
  listHumanTalkModelOptions,
  withHumanTalk,
} from "@/lib/ai/human-talk-agent";
import { directEpisodeShots } from "@/lib/ai/shot-agent";
import {
  getArticleInWorkspace,
  parseCastIds,
  setSeriesCast,
  getStudioCharacter,
  getVideoEpisode,
  getVideoSeriesByArticle,
  listCharacterCatalog,
  listSeriesCharacters,
  listVideoEpisodes,
  insertVideoEpisode,
  replaceVideoEpisodeScript,
  replaceVideoSeries,
  setVideoEpisodeRender,
  updateArticle,
  updateVideoEpisodeFields,
  updateVideoSeriesFields,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import { listTtsVoices } from "@/lib/ai/ark-tts";
import { ensureScriptCast } from "@/lib/ai/ensure-script-cast";
import { ensureScriptProps, parseScriptProps } from "@/lib/ai/script-props";
import {
  directorLockToJson,
  extractSeriesWardrobe,
  parseDirectorLock,
  parseSeriesWardrobe,
  seriesWardrobeToJson,
} from "@/lib/ai/director-lock";
import { pickScriptTitle } from "@/lib/ai/copywriting";
import {
  embedStanceNotes,
  episodeScriptBlob,
  generateStanceCards,
  parseStanceCards,
} from "@/lib/ai/stance-card";
import {
  DEFAULT_SPEAK_MODE,
  normalizeSpeakMode,
  resolveInnerVoice,
  type ArticleVideoEpisode,
  type VideoShot,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 800;

type Ctx = { params: Promise<{ id: string }> };

function isStaleStubError(error: string | null): boolean {
  return Boolean(error && /VIDEO_GEN_PROVIDER|视频模型还没对接/.test(error));
}

function publicEpisode(row: ArticleVideoEpisode) {
  const stale = isStaleStubError(row.video_error);
  if (stale && row.video_status === "failed") {
    setVideoEpisodeRender(row.id, {
      video_status: "idle",
      video_error: null,
    });
  }
  return {
    id: row.id,
    series_id: row.series_id,
    episode_no: row.episode_no,
    title: row.title,
    hook: row.hook,
    voiceover: row.voiceover,
    on_screen: row.on_screen,
    recap: row.recap,
    next_hook: row.next_hook,
    duration_sec: row.duration_sec,
    shots: shotsFromJson(row.shots_json),
    director: parseDirectorLock(row.director_json),
    confirmed: row.confirmed === 1,
    video_status: stale ? "idle" : row.video_status,
    video_url: row.video_url,
    source_video_url: row.source_video_url || null,
    subtitle_url: row.subtitle_url || null,
    caption_style_json: row.caption_style_json || "",
    caption_cues_json: row.caption_cues_json || "",
    video_error: stale ? null : row.video_error,
    video_model: row.video_model,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function characterOptions(workspaceId: string) {
  return listCharacterCatalog(workspaceId).map((c) => ({
    id: c.id,
    name: c.name || "未命名角色",
    thumb: c.angles[0]?.url || c.photos[0]?.url || "",
    voice_id: c.voice_id || "",
    angles: c.angles,
    photos: c.photos,
  }));
}

async function syncCastFromScript(
  articleId: string,
  workspaceId: string,
  speakMode: string,
  voiceId: string,
  onProgress?: (message: string) => void | Promise<void>,
  onCastChange?: () => void | Promise<void>,
  imageModel?: string,
) {
  const before = getVideoSeriesByArticle(articleId);
  const notice = await ensureScriptCast({
    articleId,
    workspaceId,
    hookStyle: before?.hook_style,
    speakMode,
    imageModel,
    onProgress,
    onCastChange,
  });
  const after = getVideoSeriesByArticle(articleId);
  if (!after) return notice;
  await onProgress?.("正在把角色挂到各镜…");
  const mode = normalizeSpeakMode(speakMode);
  const cast = listSeriesCharacters(articleId).map((row) => ({
    id: row.id,
    name: row.name,
    voice_id: row.voice_id,
  }));
  for (const ep of listVideoEpisodes(after.id)) {
    updateVideoEpisodeFields(ep.id, {
      shots_json: shotsToJson(
        bindShotSpeakers(shotsFromJson(ep.shots_json), cast, mode, voiceId),
      ),
    });
  }
  await onCastChange?.();
  const propsNotice = await ensureScriptProps({
    articleId,
    imageModel,
    onProgress,
  });
  await onCastChange?.();
  if (propsNotice.message) {
    return {
      ...notice,
      message: [notice.message, propsNotice.message].filter(Boolean).join("。"),
    };
  }
  return notice;
}

function payloadForArticle(articleId: string, workspaceId: string) {
  const series = getVideoSeriesByArticle(articleId);
  const article = getArticleInWorkspace(articleId, workspaceId);
  const extras = {
    videoReady: videoGenConfigured(),
    videoModels: videoGenModels(),
    imageModels: listImageGenModels(),
    scriptModels: listScriptLlmOptions(),
    reviewModels: listHumanTalkModelOptions(),
    voices: listTtsVoices(workspaceId),
    characters: characterOptions(workspaceId),
    suggestedName: (article?.script_title || "").trim().slice(0, 16),
    props: parseScriptProps(series?.props_json),
  };
  const library = extras.characters;
  if (!series) {
    return {
      series: null,
      episodes: [],
      cast: [],
      ...extras,
    };
  }
  const castIds = parseCastIds(series.cast_json, series.character_id);
  return {
    series,
    episodes: listVideoEpisodes(series.id).map(publicEpisode),
    cast: castIds
      .map((id) => library.find((c) => c.id === id))
      .filter((c): c is (typeof library)[number] => Boolean(c)),
    ...extras,
  };
}

export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!getArticleInWorkspace(id, auth.ctx.workspaceId)) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  const payload = payloadForArticle(id, auth.ctx.workspaceId);
  try {
    payload.videoModels = await videoGenModelsWithOpen();
  } catch {
    // keep static list
  }
  return NextResponse.json(payload);
}

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const article = getArticleInWorkspace(id, auth.ctx.workspaceId);
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const title = String(body.title || article.title || "").trim();
  const bodyHtml = String(body.body || body.bodyHtml || article.body || "");
  const hookStyle = normalizeHookStyle(
    body.hookStyle ?? body.hook_style ?? body.genre,
  );
  const genre = genreFromHookStyle(hookStyle);
  const episodeCount = clampEpisodeCount(body.episodeCount);
  const durationSec = clampEpisodeDuration(
    body.durationSec ?? body.duration_sec,
  );
  const existingSeries = getVideoSeriesByArticle(id);
  const speakMode = normalizeSpeakMode(
    body.speakMode ??
      body.speak_mode ??
      existingSeries?.speak_mode ??
      DEFAULT_SPEAK_MODE,
  );
  const hasSequel = body.hasSequel === true || body.has_sequel === true;
  const voiceId = String(body.voiceId || body.voice_id || "").trim();
  const lookStyle = normalizeLookStyle(
    body.lookStyle ?? body.look_style ?? existingSeries?.look_style,
  );
  const sourceKind = resolveScriptSourceKind(
    body.sourceKind ?? body.source_kind,
    bodyHtml,
  );
  const seriesName = pickScriptTitle(
    body.seriesName,
    article.script_title,
    existingSeries?.title,
  );
  const innerVoice = resolveInnerVoice(
    body.innerVoice ?? body.inner_voice ?? existingSeries?.inner_voice,
  );
  const requestedCast = Array.isArray(body.cast)
    ? (body.cast as unknown[])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    : String(body.characterId || "").trim()
      ? [String(body.characterId).trim()]
      : parseCastIds(existingSeries?.cast_json, existingSeries?.character_id);
  const castCharacters = requestedCast.slice(0, MAX_SERIES_CAST).map((characterId) => {
    const row = getStudioCharacter(characterId, auth.ctx.workspaceId);
    if (!row) return null;
    return row;
  });
  if (castCharacters.some((row) => !row)) {
    return NextResponse.json({ error: "角色不存在" }, { status: 404 });
  }
  const selectedCast = castCharacters.filter(
    (row): row is NonNullable<typeof row> => Boolean(row),
  );
  const characterName = selectedCast
    .map((row) => row.name.trim())
    .filter(Boolean);

  const stream = body.stream !== false;
  const scriptModelId = String(body.scriptModel || body.script_model || "");
  const shotModelId = String(body.shotModel || body.shot_model || "");
  const imageModel = String(body.imageModel || body.image_model || "");
  const reviewModelId = String(body.reviewModel || body.review_model || "");
  const encoder = new TextEncoder();
  const writeLine = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: Record<string, unknown>,
  ) => {
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
  };

  const run = async (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) => {
    await withHumanTalk(auth.ctx.workspaceId, reviewModelId, async () => {
    await withScriptLlm(scriptModelId, async () => {
    const onEvent = async (event: {
      type: string;
      message?: string;
      model?: string;
      delta?: string;
    }) => {
      writeLine(controller, event);
    };

    if (body.regenerateShots === true && typeof body.episodeId === "string") {
      const current = getVideoEpisode(body.episodeId);
      const series = getVideoSeriesByArticle(id);
      if (!current || !series || current.series_id !== series.id) {
        writeLine(controller, { type: "error", error: "分集不存在" });
        return;
      }
      const names =
        characterName.length > 0
          ? characterName
          : parseCastIds(series.cast_json, series.character_id)
              .map(
                (characterId) =>
                  getStudioCharacter(characterId, auth.ctx.workspaceId)?.name ||
                  "",
              )
              .filter(Boolean);
      const directed = await withScriptLlm(shotModelId || scriptModelId, () =>
        directEpisodeShots(
          {
            episode: {
              episode_no: current.episode_no,
              title: current.title,
              hook: current.hook,
              voiceover: current.voiceover,
              on_screen: current.on_screen,
              recap: current.recap,
              next_hook: current.next_hook,
              duration_sec: current.duration_sec,
              shots: shotsFromJson(current.shots_json),
            },
            hookStyle: hookStyle || series.hook_style,
            lookStyle: lookStyle || series.look_style,
            seriesTitle: series.title,
            characterName: names,
            speakMode: speakMode || series.speak_mode,
            innerVoice:
              innerVoice !== "off"
                ? innerVoice
                : resolveInnerVoice(series.inner_voice),
            durationSec:
              body.durationSec != null || body.duration_sec != null
                ? durationSec
                : series.duration_sec === 15 || series.duration_sec === 90
                  ? series.duration_sec
                  : durationBudget(current.duration_sec),
            cards: parseStanceCards(series.notes),
            wardrobe: parseSeriesWardrobe(series.wardrobe_json),
          },
          onEvent,
        ),
      );
      replaceVideoEpisodeScript(current.id, {
        title: current.title,
        hook: directed.hook || current.hook,
        voiceover: current.voiceover,
        on_screen: current.on_screen,
        recap: current.recap,
        next_hook: current.next_hook,
        duration_sec: current.duration_sec,
        shots_json: shotsToJson(
          bindShotSpeakers(
            directed.shots,
            selectedCast,
            speakMode || series.speak_mode,
            voiceId || series.voice_id,
          ),
        ),
        director_json: directorLockToJson(directed.director),
      });
      await onEvent({ type: "status", message: "分镜已按导演重排，对白未改" });
      writeLine(controller, {
        type: "done",
        ...payloadForArticle(id, auth.ctx.workspaceId),
      });
      return;
    }

    if (typeof body.regenerateEpisodeId === "string" && body.regenerateEpisodeId) {
      const current = getVideoEpisode(body.regenerateEpisodeId);
      const series = getVideoSeriesByArticle(id);
      if (!current || !series || current.series_id !== series.id) {
        writeLine(controller, { type: "error", error: "分集不存在" });
        return;
      }
      const ep = await regenerateOneEpisode(
        {
          title,
          bodyHtml,
          genre: series.genre,
          hookStyle: hookStyle || series.hook_style,
          lookStyle: lookStyle || series.look_style,
          seriesTitle: series.title,
          episodeNo: current.episode_no,
          existing: listVideoEpisodes(series.id).map((row) => ({
            episode_no: row.episode_no,
            title: row.title,
          })),
          characterName:
            characterName.length > 0
              ? characterName
              : parseCastIds(series.cast_json, series.character_id)
                  .map(
                    (characterId) =>
                      getStudioCharacter(characterId, auth.ctx.workspaceId)
                        ?.name || "",
                  )
                  .filter(Boolean),
          speakMode: speakMode || series.speak_mode,
          innerVoice:
            innerVoice !== "off"
              ? innerVoice
              : resolveInnerVoice(series.inner_voice),
          stanceNotes: series.notes,
          premise: series.premise,
          shotModel: shotModelId,
          wardrobe: parseSeriesWardrobe(series.wardrobe_json),
          hasSequel,
          durationSec:
            body.durationSec != null || body.duration_sec != null
              ? durationSec
              : series.duration_sec === 15 || series.duration_sec === 90
                ? series.duration_sec
                : durationBudget(current.duration_sec),
        },
        onEvent,
      );
      replaceVideoEpisodeScript(current.id, {
        title: ep.title,
        hook: ep.hook,
        voiceover: ep.voiceover,
        on_screen: ep.on_screen,
        recap: ep.recap,
        next_hook: ep.next_hook,
        duration_sec: ep.duration_sec,
        shots_json: shotsToJson(
          bindShotSpeakers(
            ep.shots,
            selectedCast,
            speakMode || series.speak_mode,
            voiceId || series.voice_id,
          ),
        ),
        director_json: directorLockToJson(ep.director),
      });
      await onEvent({ type: "status", message: "本集已落盘，正在认角色…" });
      writeLine(controller, {
        type: "partial",
        ...payloadForArticle(id, auth.ctx.workspaceId),
      });
      const castNotice = await syncCastFromScript(
        id,
        auth.ctx.workspaceId,
        speakMode || series.speak_mode,
        voiceId || series.voice_id,
        (message) => onEvent({ type: "status", message }),
        () =>
          writeLine(controller, {
            type: "partial",
            ...payloadForArticle(id, auth.ctx.workspaceId),
          }),
        imageModel,
      );
      writeLine(controller, {
        type: "done",
        ...payloadForArticle(id, auth.ctx.workspaceId),
        castNotice,
      });
      return;
    }

    if (body.appendNext === true || body.append_next === true) {
      if (!hasSequel) {
        writeLine(controller, {
          type: "error",
          error: "本集已收束，先点「还有后续」再写下一集",
        });
        return;
      }
      const series = getVideoSeriesByArticle(id);
      if (!series) {
        writeLine(controller, { type: "error", error: "还没有剧本，先写出第一集" });
        return;
      }
      const previous = listVideoEpisodes(series.id);
      if (previous.length === 0) {
        writeLine(controller, { type: "error", error: "还没有上一集，先写出第一集" });
        return;
      }
      if (previous.length >= MAX_EPISODE_COUNT) {
        writeLine(controller, {
          type: "error",
          error: `最多 ${MAX_EPISODE_COUNT} 集`,
        });
        return;
      }
      const toBrief = (row: {
        episode_no: number;
        title: string;
        hook: string;
        voiceover: string;
        on_screen: string;
        recap: string;
        next_hook: string;
      }) => ({
        episode_no: row.episode_no,
        title: row.title,
        hook: row.hook,
        voiceover: row.voiceover,
        on_screen: row.on_screen,
        recap: row.recap,
        next_hook: row.next_hook,
      });
      const appendCount = Math.min(
        MAX_EPISODE_COUNT - previous.length,
        Math.max(1, Math.round(Number(body.appendCount ?? body.append_count) || 1)),
      );
      const names =
        characterName.length > 0
          ? characterName
          : parseCastIds(series.cast_json, series.character_id)
              .map(
                (characterId) =>
                  getStudioCharacter(characterId, auth.ctx.workspaceId)?.name ||
                  "",
              )
              .filter(Boolean);
      const running = previous.map(toBrief);
      const added: ReturnType<typeof toBrief>[] = [];
      for (let i = 0; i < appendCount; i++) {
        const ep = await generateNextEpisode(
          {
            title,
            bodyHtml,
            genre: series.genre,
            hookStyle: hookStyle || series.hook_style,
            lookStyle: lookStyle || series.look_style,
            sourceKind,
            seriesTitle: series.title,
            previous: running,
            characterName: names,
            speakMode: speakMode || series.speak_mode,
            innerVoice:
              innerVoice !== "off"
                ? innerVoice
                : resolveInnerVoice(series.inner_voice),
            stanceNotes: series.notes,
            premise: series.premise,
            hasSequel: hasSequel || i < appendCount - 1,
            durationSec,
            shotModel: shotModelId,
            wardrobe: parseSeriesWardrobe(series.wardrobe_json),
          },
          onEvent,
        );
        insertVideoEpisode({
          seriesId: series.id,
          episode_no: ep.episode_no,
          title: ep.title,
          hook: ep.hook,
          voiceover: ep.voiceover,
          on_screen: ep.on_screen,
          recap: ep.recap,
          next_hook: ep.next_hook,
          duration_sec: ep.duration_sec,
          shots_json: shotsToJson(
            bindShotSpeakers(
              ep.shots,
              selectedCast,
              speakMode || series.speak_mode,
              voiceId || series.voice_id,
            ),
          ),
          director_json: directorLockToJson(ep.director),
        });
        const brief = toBrief(ep);
        running.push(brief);
        added.push(brief);
        writeLine(controller, {
          type: "partial",
          ...payloadForArticle(id, auth.ctx.workspaceId),
        });
      }
      await onEvent({ type: "status", message: "正在更新剧情介绍…" });
      const nextPremise = await writeSeriesPremise({
        seriesTitle: series.title,
        logline: series.logline,
        premise: series.premise,
        hookStyle: series.hook_style,
        characterName: names.length > 0 ? names : undefined,
        cards: parseStanceCards(series.notes),
        episodes: running,
      });
      if (nextPremise) updateVideoSeriesFields(series.id, { premise: nextPremise });
      await onEvent({
        type: "status",
        message:
          added.length > 1
            ? `后 ${added.length} 集已落盘，正在认角色…`
            : "下一集已落盘，正在认角色…",
      });
      const castNotice = await syncCastFromScript(
        id,
        auth.ctx.workspaceId,
        speakMode || series.speak_mode,
        voiceId || series.voice_id,
        (message) => onEvent({ type: "status", message }),
        () =>
          writeLine(controller, {
            type: "partial",
            ...payloadForArticle(id, auth.ctx.workspaceId),
          }),
        imageModel,
      );
      writeLine(controller, {
        type: "done",
        ...payloadForArticle(id, auth.ctx.workspaceId),
        castNotice,
      });
      return;
    }

    const generated = await generateVideoSeries(
      {
        title,
        bodyHtml,
        genre,
        hookStyle,
        lookStyle,
        sourceKind,
        episodeCount,
        seriesName,
        characterName,
        speakMode,
        innerVoice,
        durationSec,
        hasSequel,
        shotModel: shotModelId,
        wardrobe: parseSeriesWardrobe(existingSeries?.wardrobe_json),
        savedNotes: existingSeries?.notes,
      },
      onEvent,
    );
    replaceVideoSeries({
      articleId: id,
      genre: generated.genre,
      hook_style: hookStyle,
      look_style: lookStyle,
      title: generated.title,
      logline: generated.logline,
      premise: generated.premise,
      audience: generated.audience,
      notes: generated.notes,
      character_id: selectedCast[0]?.id || null,
      cast_json: JSON.stringify(selectedCast.map((row) => row.id)),
      speak_mode: speakMode,
      inner_voice: innerVoice,
      voice_id: voiceId || existingSeries?.voice_id || "",
      duration_sec: durationSec,
      episodes: generated.episodes.map((ep) => ({
        episode_no: ep.episode_no,
        title: ep.title,
        hook: ep.hook,
        voiceover: ep.voiceover,
        on_screen: ep.on_screen,
        recap: ep.recap,
        next_hook: ep.next_hook,
        duration_sec: ep.duration_sec,
        shots_json: shotsToJson(
          bindShotSpeakers(
            ep.shots,
            selectedCast,
            speakMode,
            voiceId || existingSeries?.voice_id,
          ),
        ),
        director_json: directorLockToJson(ep.director),
      })),
    });
    const savedSeries = getVideoSeriesByArticle(id);
    if (savedSeries) {
      const first = generated.episodes[0];
      if (first?.shots?.length) {
        updateVideoSeriesFields(savedSeries.id, {
          wardrobe_json: seriesWardrobeToJson(
            extractSeriesWardrobe(
              first.shots,
              parseSeriesWardrobe(savedSeries.wardrobe_json),
            ),
          ),
        });
      }
    }
    if (generated.title.trim()) {
      updateArticle(id, { script_title: generated.title.trim().slice(0, 16) });
    }
    await onEvent({ type: "status", message: "剧本已保存，正在认角色…" });
    writeLine(controller, {
      type: "partial",
      ...payloadForArticle(id, auth.ctx.workspaceId),
    });
    const castNotice = await syncCastFromScript(
      id,
      auth.ctx.workspaceId,
      speakMode,
      voiceId || existingSeries?.voice_id || "",
      (message) => onEvent({ type: "status", message }),
      () =>
        writeLine(controller, {
          type: "partial",
          ...payloadForArticle(id, auth.ctx.workspaceId),
        }),
      imageModel,
    );
    writeLine(controller, {
      type: "done",
      ...payloadForArticle(id, auth.ctx.workspaceId),
      castNotice,
    });
    });
    });
  };

  if (!stream) {
    try {
      const generated = await withHumanTalk(auth.ctx.workspaceId, reviewModelId, () =>
        withScriptLlm(scriptModelId, () => generateVideoSeries({
        title,
        bodyHtml,
        genre,
        hookStyle,
        lookStyle,
        sourceKind,
        episodeCount,
        seriesName,
        characterName,
        speakMode,
        durationSec,
        savedNotes: existingSeries?.notes,
      })),
      );
      replaceVideoSeries({
        articleId: id,
        genre: generated.genre,
        hook_style: hookStyle,
        look_style: lookStyle,
        title: generated.title,
        logline: generated.logline,
        premise: generated.premise,
        audience: generated.audience,
        notes: generated.notes,
        character_id: selectedCast[0]?.id || null,
        cast_json: JSON.stringify(selectedCast.map((row) => row.id)),
        speak_mode: speakMode,
        inner_voice: innerVoice,
        voice_id: voiceId || existingSeries?.voice_id || "",
        duration_sec: durationSec,
        episodes: generated.episodes.map((ep) => ({
          episode_no: ep.episode_no,
          title: ep.title,
          hook: ep.hook,
          voiceover: ep.voiceover,
          on_screen: ep.on_screen,
          recap: ep.recap,
          next_hook: ep.next_hook,
          duration_sec: ep.duration_sec,
          shots_json: shotsToJson(
            bindShotSpeakers(
              ep.shots,
              selectedCast,
              speakMode,
              voiceId || existingSeries?.voice_id,
            ),
          ),
        })),
      });
      if (generated.title.trim()) {
        updateArticle(id, { script_title: generated.title.trim().slice(0, 16) });
      }
      const castNotice = await syncCastFromScript(
        id,
        auth.ctx.workspaceId,
        speakMode,
        voiceId || existingSeries?.voice_id || "",
        undefined,
        undefined,
        imageModel,
      );
      return NextResponse.json({
        ...payloadForArticle(id, auth.ctx.workspaceId),
        castNotice,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成剧本失败";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await run(controller);
      } catch (err) {
        const raw = err instanceof Error ? err.message : "生成剧本失败";
        const message = /已取消生成|abort|timeout|超时/i.test(raw)
          ? "分镜导演超时，换一个更快的分镜模型或再点一次"
          : raw;
        writeLine(controller, { type: "error", error: message });
      } finally {
        await persistCloudflareDb().catch(() => undefined);
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!getArticleInWorkspace(id, auth.ctx.workspaceId)) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  const series = getVideoSeriesByArticle(id);
  if (!series) {
    return NextResponse.json({ error: "还没有剧本" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  if (body.fillPremise === true) {
    const episodes = listVideoEpisodes(series.id);
    if (episodes.length === 0) {
      return NextResponse.json({ error: "还没有分集，先写出剧本" }, { status: 400 });
    }
    const premise = await writeSeriesPremise({
      seriesTitle: series.title,
      logline: series.logline,
      premise: series.premise,
      hookStyle: series.hook_style,
      characterName: listSeriesCharacters(id).map((row) => row.name).filter(Boolean),
      cards: parseStanceCards(series.notes),
      episodes: episodes.map((row) => ({
        episode_no: row.episode_no,
        title: row.title,
        hook: row.hook,
        voiceover: row.voiceover,
        on_screen: row.on_screen,
        recap: row.recap,
        next_hook: row.next_hook,
      })),
    });
    updateVideoSeriesFields(series.id, { premise });
    return NextResponse.json(payloadForArticle(id, auth.ctx.workspaceId));
  }
  if (body.fillStance === true) {
    const episodes = listVideoEpisodes(series.id);
    if (episodes.length === 0) {
      return NextResponse.json({ error: "还没有分集，先写出剧本" }, { status: 400 });
    }
    const names = listSeriesCharacters(id)
      .map((row) => row.name.trim())
      .filter(Boolean);
    if (names.length === 0) {
      return NextResponse.json({ error: "还没认出角色" }, { status: 400 });
    }
    const article = getArticleInWorkspace(id, auth.ctx.workspaceId);
    const cards = await generateStanceCards({
      names,
      hookStyle: series.hook_style,
      title: series.title,
      body: String(article?.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      script: episodeScriptBlob(episodes),
    });
    updateVideoSeriesFields(series.id, {
      notes: embedStanceNotes(series.notes, cards),
    });
    return NextResponse.json(payloadForArticle(id, auth.ctx.workspaceId));
  }
  if (body.series && typeof body.series === "object") {
    const s = body.series as Record<string, unknown>;
    if (Array.isArray(s.cast)) {
      const ids = (s.cast as unknown[])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, MAX_SERIES_CAST);
      for (const characterId of ids) {
        if (!getStudioCharacter(characterId, auth.ctx.workspaceId)) {
          return NextResponse.json({ error: "角色不存在" }, { status: 404 });
        }
      }
      setSeriesCast(series.id, ids);
    } else if (typeof s.character_id === "string" || s.character_id === null) {
      const nextId =
        typeof s.character_id === "string" ? s.character_id.trim() : "";
      if (nextId) {
        const ch = getStudioCharacter(nextId, auth.ctx.workspaceId);
        if (!ch) {
          return NextResponse.json({ error: "角色不存在" }, { status: 404 });
        }
        setSeriesCast(
          series.id,
          [
            ...parseCastIds(series.cast_json, series.character_id).filter(
              (id) => id !== nextId,
            ),
            nextId,
          ].slice(0, MAX_SERIES_CAST),
        );
      } else {
        setSeriesCast(series.id, []);
      }
    }
    updateVideoSeriesFields(series.id, {
      title: typeof s.title === "string" ? s.title : undefined,
      logline: typeof s.logline === "string" ? s.logline : undefined,
      premise: typeof s.premise === "string" ? s.premise : undefined,
      audience: typeof s.audience === "string" ? s.audience : undefined,
      notes: typeof s.notes === "string" ? s.notes : undefined,
      speak_mode:
        s.speak_mode === "dialogue" || s.speak_mode === "narration"
          ? s.speak_mode
          : undefined,
      inner_voice:
        s.inner_voice !== undefined || s.innerVoice !== undefined
          ? resolveInnerVoice(s.inner_voice ?? s.innerVoice)
          : undefined,
      voice_id: typeof s.voice_id === "string" ? s.voice_id : undefined,
      episode_count:
        s.episode_count != null || s.episodeCount != null
          ? clampEpisodeCount(s.episode_count ?? s.episodeCount)
          : undefined,
      duration_sec:
        s.duration_sec != null || s.durationSec != null
          ? clampEpisodeDuration(s.duration_sec ?? s.durationSec)
          : undefined,
      look_style:
        typeof s.look_style === "string" || typeof s.lookStyle === "string"
          ? normalizeLookStyle(s.look_style ?? s.lookStyle)
          : undefined,
    });
    if (typeof s.title === "string" && s.title.trim()) {
      updateArticle(id, { script_title: s.title.trim().slice(0, 16) });
    }
    if (s.speak_mode === "dialogue" || s.speak_mode === "narration") {
      for (const ep of listVideoEpisodes(series.id)) {
        const nextVo = canonicalizeVoiceover(ep.voiceover, s.speak_mode);
        if (nextVo !== ep.voiceover) {
          updateVideoEpisodeFields(ep.id, { voiceover: nextVo });
        }
      }
    }
  }

  if (typeof body.episodeId === "string" && body.episode) {
    const current = getVideoEpisode(body.episodeId);
    if (!current || current.series_id !== series.id) {
      return NextResponse.json({ error: "分集不存在" }, { status: 404 });
    }
    const e = body.episode as Record<string, unknown>;
    let shots_json: string | undefined;
    const incomingShots = Array.isArray(e.shots)
      ? (e.shots as VideoShot[])
      : shotsFromJson(current.shots_json);
    const nextVo =
      typeof e.voiceover === "string"
        ? canonicalizeVoiceover(e.voiceover, series.speak_mode)
        : current.voiceover;
    if (typeof e.voiceover === "string" && nextVo !== current.voiceover) {
      shots_json = shotsToJson(
        bindShotsToVoiceover(incomingShots, nextVo, current.duration_sec),
      );
    } else if (Array.isArray(e.shots)) {
      shots_json = shotsToJson(e.shots as VideoShot[]);
    }
    updateVideoEpisodeFields(current.id, {
      title: typeof e.title === "string" ? e.title : undefined,
      hook: typeof e.hook === "string" ? e.hook : undefined,
      voiceover: typeof e.voiceover === "string" ? nextVo : undefined,
      on_screen: typeof e.on_screen === "string" ? e.on_screen : undefined,
      recap: typeof e.recap === "string" ? e.recap : undefined,
      next_hook: typeof e.next_hook === "string" ? e.next_hook : undefined,
      duration_sec:
        typeof e.duration_sec === "number" ? e.duration_sec : undefined,
      shots_json,
      confirmed:
        typeof e.confirmed === "boolean" ? (e.confirmed ? 1 : 0) : undefined,
    });
  }

  await persistCloudflareDb().catch(() => undefined);
  return NextResponse.json(payloadForArticle(id, auth.ctx.workspaceId));
}
