import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import {
  generateVideoSeries,
  regenerateOneEpisode,
  shotsFromJson,
  shotsToJson,
  bindShotSpeakers,
  clampEpisodeCount,
} from "@/lib/ai/video-script";
import {
  genreFromHookStyle,
  normalizeHookStyle,
} from "@/lib/ai/video-script-styles";
import { videoGenConfigured, videoGenModels } from "@/lib/ai/video-gen";
import {
  getArticleInWorkspace,
  parseCastIds,
  setSeriesCast,
  getStudioCharacter,
  getVideoEpisode,
  getVideoSeriesByArticle,
  listCharacterCatalog,
  listVideoEpisodes,
  replaceVideoEpisodeScript,
  replaceVideoSeries,
  setVideoEpisodeRender,
  updateArticle,
  updateVideoEpisodeFields,
  updateVideoSeriesFields,
} from "@/lib/db";
import { listTtsVoices } from "@/lib/ai/ark-tts";
import {
  normalizeSpeakMode,
  type ArticleVideoEpisode,
  type VideoShot,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    confirmed: row.confirmed === 1,
    video_status: stale ? "idle" : row.video_status,
    video_url: row.video_url,
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

function payloadForArticle(articleId: string, workspaceId: string) {
  const series = getVideoSeriesByArticle(articleId);
  const article = getArticleInWorkspace(articleId, workspaceId);
  const extras = {
    videoReady: videoGenConfigured(),
    videoModels: videoGenModels(),
    voices: listTtsVoices(),
    characters: characterOptions(workspaceId),
    suggestedName: (article?.script_title || "").trim().slice(0, 16),
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
  return NextResponse.json(payloadForArticle(id, auth.ctx.workspaceId));
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
  const seriesName = String(
    body.seriesName || article.script_title || "",
  )
    .trim()
    .slice(0, 16);
  const speakMode = normalizeSpeakMode(body.speakMode ?? body.speak_mode);
  const voiceId = String(body.voiceId || body.voice_id || "").trim();
  const existingSeries = getVideoSeriesByArticle(id);
  const requestedCast = Array.isArray(body.cast)
    ? (body.cast as unknown[])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    : String(body.characterId || "").trim()
      ? [String(body.characterId).trim()]
      : parseCastIds(existingSeries?.cast_json, existingSeries?.character_id);
  const castCharacters = requestedCast.slice(0, 4).map((characterId) => {
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
    const onEvent = async (event: {
      type: string;
      message?: string;
      model?: string;
      delta?: string;
    }) => {
      writeLine(controller, event);
    };

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
          ),
        ),
      });
      writeLine(controller, { type: "done", ...payloadForArticle(id, auth.ctx.workspaceId) });
      return;
    }

    const generated = await generateVideoSeries(
      {
        title,
        bodyHtml,
        genre,
        hookStyle,
        episodeCount,
        seriesName,
        characterName,
        speakMode,
      },
      onEvent,
    );
    replaceVideoSeries({
      articleId: id,
      genre: generated.genre,
      hook_style: hookStyle,
      title: generated.title,
      logline: generated.logline,
      audience: generated.audience,
      notes: generated.notes,
      character_id: selectedCast[0]?.id || null,
      cast_json: JSON.stringify(selectedCast.map((row) => row.id)),
      speak_mode: speakMode,
      voice_id: voiceId || existingSeries?.voice_id || "",
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
          bindShotSpeakers(ep.shots, selectedCast, speakMode),
        ),
      })),
    });
    if (generated.title.trim()) {
      updateArticle(id, { script_title: generated.title.trim().slice(0, 16) });
    }
    writeLine(controller, { type: "done", ...payloadForArticle(id, auth.ctx.workspaceId) });
  };

  if (!stream) {
    try {
      const generated = await generateVideoSeries({
        title,
        bodyHtml,
        genre,
        hookStyle,
        episodeCount,
        seriesName,
        characterName,
        speakMode,
      });
      replaceVideoSeries({
        articleId: id,
        genre: generated.genre,
        hook_style: hookStyle,
        title: generated.title,
        logline: generated.logline,
        audience: generated.audience,
        notes: generated.notes,
        character_id: selectedCast[0]?.id || null,
        cast_json: JSON.stringify(selectedCast.map((row) => row.id)),
        speak_mode: speakMode,
        voice_id: voiceId || existingSeries?.voice_id || "",
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
            bindShotSpeakers(ep.shots, selectedCast, speakMode),
          ),
        })),
      });
      if (generated.title.trim()) {
        updateArticle(id, { script_title: generated.title.trim().slice(0, 16) });
      }
      return NextResponse.json(payloadForArticle(id, auth.ctx.workspaceId));
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
        const message = err instanceof Error ? err.message : "生成剧本失败";
        writeLine(controller, { type: "error", error: message });
      } finally {
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
  if (body.series && typeof body.series === "object") {
    const s = body.series as Record<string, unknown>;
    if (Array.isArray(s.cast)) {
      const ids = (s.cast as unknown[])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 4);
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
          ].slice(0, 4),
        );
      } else {
        setSeriesCast(series.id, []);
      }
    }
    updateVideoSeriesFields(series.id, {
      title: typeof s.title === "string" ? s.title : undefined,
      logline: typeof s.logline === "string" ? s.logline : undefined,
      audience: typeof s.audience === "string" ? s.audience : undefined,
      notes: typeof s.notes === "string" ? s.notes : undefined,
      speak_mode:
        s.speak_mode === "dialogue" || s.speak_mode === "narration"
          ? s.speak_mode
          : undefined,
      voice_id: typeof s.voice_id === "string" ? s.voice_id : undefined,
    });
    if (typeof s.title === "string" && s.title.trim()) {
      updateArticle(id, { script_title: s.title.trim().slice(0, 16) });
    }
  }

  if (typeof body.episodeId === "string" && body.episode) {
    const current = getVideoEpisode(body.episodeId);
    if (!current || current.series_id !== series.id) {
      return NextResponse.json({ error: "分集不存在" }, { status: 404 });
    }
    const e = body.episode as Record<string, unknown>;
    let shots_json: string | undefined;
    if (Array.isArray(e.shots)) {
      shots_json = shotsToJson(e.shots as VideoShot[]);
    }
    updateVideoEpisodeFields(current.id, {
      title: typeof e.title === "string" ? e.title : undefined,
      hook: typeof e.hook === "string" ? e.hook : undefined,
      voiceover: typeof e.voiceover === "string" ? e.voiceover : undefined,
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

  return NextResponse.json(payloadForArticle(id, auth.ctx.workspaceId));
}
