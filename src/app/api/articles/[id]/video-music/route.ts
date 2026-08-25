import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import {
  ensureVideoSeries,
  getArticleInWorkspace,
  getVideoSeriesByArticle,
  listVideoEpisodes,
  updateVideoSeriesFields,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import { fetchSunoTask, startSunoGeneration } from "@/lib/ai/suno";
import {
  normalizeScriptLlmId,
  withScriptLlm,
} from "@/lib/ai/script-llm";
import {
  articleMusicSource,
  mergeMusicTracks,
  musicPublicPayload,
  musicStyleWithDuration,
  parseSeriesMusic,
  resolveMusicProviderModel,
  resolveMusicSongTitle,
  sanitizeSongTitle,
  streamSeriesLyrics,
  streamStandaloneLyrics,
  stringifySeriesMusic,
  syncSelectedTrackCover,
  type SeriesMusicState,
} from "@/lib/ai/video-music";
import { composeMusicStylePrompt } from "@/lib/ai/music-styles";
import { generateMusicCover } from "@/lib/ai/cover";
import { resolveCoverImageModelId } from "@/lib/ai/image-gen-models";
import {
  chargeMusicOrRespond,
  refundWallet,
} from "@/lib/billing/api-charge";

export const maxDuration = 300;

const COVER_VARIANTS = [
  "暖色近景、主体偏左",
  "冷色远景、留白较多",
  "高对比剪影、中心构图",
  "低饱和胶片感、偏暗",
];

const COVER_FILL_LOCK_MS = 90_000;
const coverFillInFlight = new Set<string>();

async function persistMusic(seriesId: string, state: SeriesMusicState) {
  updateVideoSeriesFields(seriesId, {
    music_json: stringifySeriesMusic(state),
  });
  await persistCloudflareDb();
}

function readSeriesMusic(articleId: string): SeriesMusicState | null {
  const series = getVideoSeriesByArticle(articleId);
  return series ? parseSeriesMusic(series.music_json) : null;
}

async function ensureMissingTrackCovers(
  articleId: string,
  seriesId: string,
  state: SeriesMusicState,
  lyrics: string,
): Promise<SeriesMusicState> {
  let next = syncSelectedTrackCover(state);
  if (next.coverWanted === false) return next;
  if (next.status !== "ready" || next.tracks.length === 0) return next;
  if (!next.tracks.some((row) => !row.coverUrl)) {
    if (next.coverFillingAt) {
      next = { ...next, coverFillingAt: 0 };
      await persistMusic(seriesId, next);
    }
    return next;
  }

  const lockAt = Number(next.coverFillingAt || 0);
  if (
    coverFillInFlight.has(seriesId) ||
    (lockAt > 0 && Date.now() - lockAt < COVER_FILL_LOCK_MS)
  ) {
    return next;
  }

  coverFillInFlight.add(seriesId);
  next = { ...next, coverFillingAt: Date.now() };
  await persistMusic(seriesId, next);

  const titleForCover = sanitizeSongTitle(next.songTitle) || "未名曲";
  const coverModel =
    (next.coverModel || resolveCoverImageModelId()).trim() ||
    resolveCoverImageModelId();

  try {
    const pending = next.tracks.filter((row) => !row.coverUrl);
    for (const row of pending) {
      const latest = readSeriesMusic(articleId) || next;
      const current = latest.tracks.find((track) => track.id === row.id);
      const trackIndex = Math.max(
        0,
        latest.tracks.findIndex((track) => track.id === row.id),
      );
      if (!current || current.coverUrl) {
        next = syncSelectedTrackCover({ ...latest, coverModel });
        continue;
      }
      try {
        const cover = await generateMusicCover({
          songTitle: titleForCover,
          lyrics,
          style: latest.style || next.style,
          model: coverModel,
          variant: `第${trackIndex + 1}版 · ${current.title || ""} · ${COVER_VARIANTS[trackIndex % COVER_VARIANTS.length]}`,
        });
        const after = readSeriesMusic(articleId) || latest;
        next = syncSelectedTrackCover({
          ...after,
          coverModel,
          tracks: after.tracks.map((track) =>
            track.id === row.id ? { ...track, coverUrl: cover.url } : track,
          ),
        });
        await persistMusic(seriesId, next);
      } catch {
        next = syncSelectedTrackCover(readSeriesMusic(articleId) || next);
      }
    }
  } finally {
    const latest = readSeriesMusic(articleId) || next;
    next = syncSelectedTrackCover({
      ...latest,
      coverModel,
      coverFillingAt: 0,
    });
    await persistMusic(seriesId, next);
    coverFillInFlight.delete(seriesId);
  }
  return next;
}

type Ctx = { params: Promise<{ id: string }> };

function ndjsonLyricsResponse(
  lyricsModel: string,
  stream: () => AsyncGenerator<{
    type: string;
    delta?: string;
    lyrics?: string;
    songTitle?: string;
    message?: string;
  }>,
  onDone: (
    lyrics: string,
    songTitle: string,
  ) => Promise<Record<string, unknown> | void>,
) {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await withScriptLlm(lyricsModel, async () => {
          for await (const event of stream()) {
            if (event.type === "done" && event.lyrics) {
              const songTitle = String(event.songTitle || "").trim();
              const extra = await onDone(event.lyrics, songTitle);
              send({
                type: "done",
                lyrics: event.lyrics,
                songTitle,
                ...extra,
              });
              continue;
            }
            send(event);
            if (event.type === "error") break;
          }
        });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "写歌词失败",
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function loadArticle(articleId: string, workspaceId: string) {
  return getArticleInWorkspace(articleId, workspaceId) || null;
}

function payload(series: ReturnType<typeof getVideoSeriesByArticle> | null) {
  const current = series || undefined;
  const episodes = current ? listVideoEpisodes(current.id) : [];
  return {
    ...musicPublicPayload(current || null),
    series: Boolean(current),
    hasScript: episodes.some((ep) => String(ep.voiceover || "").trim()),
    hasComposedVideo: episodes.some((ep) => String(ep.video_url || "").trim()),
  };
}

async function refreshMusic(state: SeriesMusicState): Promise<SeriesMusicState> {
  if (!state.taskId) return state;
  if (state.status !== "pending" && state.status !== "processing") return state;
  const suno = await fetchSunoTask(state.taskId);
  const nextTracks = suno.tracks.map((track) => ({
    id: track.id,
    url: track.audioUrl,
    streamUrl: track.streamAudioUrl,
    title: track.title,
    duration: track.duration,
  }));
  const tracks = mergeMusicTracks(state.tracks, nextTracks);
  return syncSelectedTrackCover({
    ...state,
    status: suno.status,
    error: suno.error || "",
    tracks,
    selectedTrackId:
      tracks.some((row) => row.id === state.selectedTrackId)
        ? state.selectedTrackId
        : tracks[0]?.id || "",
  });
}

export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!(await loadArticle(id, auth.ctx.workspaceId))) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  const series = getVideoSeriesByArticle(id) || null;
  if (!series) return NextResponse.json(payload(null));
  let music = parseSeriesMusic(series.music_json);
  try {
    let next = await refreshMusic(music);
    if (JSON.stringify(next) !== JSON.stringify(music)) {
      await persistMusic(series.id, next);
      music = next;
    }
    next = await ensureMissingTrackCovers(
      id,
      series.id,
      next,
      series.lyrics || "",
    );
    music = next;
  } catch (err) {
    music = {
      ...music,
      error: err instanceof Error ? err.message : "查询音乐任务失败",
    };
  }
  return NextResponse.json({
    ...payload({ ...series, music_json: stringifySeriesMusic(music) }),
    music,
    lyrics: series.lyrics || "",
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const article = await loadArticle(id, auth.ctx.workspaceId);
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  const series = ensureVideoSeries(id, article.script_title || article.title);
  const body = (await req.json()) as {
    lyrics?: string;
    style?: string;
    styleTags?: string[];
    styleExtra?: string;
    model?: string;
    lyricsModel?: string;
    songTitle?: string;
    vocal?: "m" | "f";
    selectedTrackId?: string;
    mixIntoVideo?: boolean;
    coverWanted?: boolean;
    coverModel?: string;
    coverUrl?: string;
  };
  const music = parseSeriesMusic(series.music_json);
  if (typeof body.style === "string") music.style = body.style.trim();
  if (Array.isArray(body.styleTags)) {
    music.styleTags = body.styleTags.filter((row) => typeof row === "string");
  }
  if (typeof body.styleExtra === "string") {
    music.styleExtra = body.styleExtra.trim();
  }
  if (typeof body.model === "string" && body.model.trim()) {
    music.model = body.model.trim();
  }
  if (typeof body.lyricsModel === "string" && body.lyricsModel.trim()) {
    music.lyricsModel = normalizeScriptLlmId(body.lyricsModel);
  }
  if (typeof body.songTitle === "string") {
    music.songTitle = sanitizeSongTitle(body.songTitle);
  }
  if (body.vocal === "m" || body.vocal === "f") music.vocal = body.vocal;
  if (typeof body.selectedTrackId === "string") {
    music.selectedTrackId = body.selectedTrackId;
  }
  if (typeof body.mixIntoVideo === "boolean") {
    music.mixIntoVideo = body.mixIntoVideo;
  }
  if (typeof body.coverWanted === "boolean") {
    music.coverWanted = body.coverWanted;
  }
  if (typeof body.coverModel === "string" && body.coverModel.trim()) {
    music.coverModel = body.coverModel.trim();
  }
  if (typeof body.coverUrl === "string") {
    music.coverUrl = body.coverUrl.trim();
  }
  if (!music.style.trim()) {
    music.style = composeMusicStylePrompt(
      music.styleTags,
      music.styleExtra,
      music.vocal,
    );
  }
  const next = syncSelectedTrackCover(music);
  const updated = updateVideoSeriesFields(series.id, {
    lyrics: typeof body.lyrics === "string" ? body.lyrics : series.lyrics,
    music_json: stringifySeriesMusic(next),
  });
  return NextResponse.json(payload(updated || series));
}

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  try {
    return await postVideoMusic(req, ctx, {
      workspaceId: auth.ctx.workspaceId,
      email: auth.ctx.email,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : "";
    const message =
      !raw.trim() || /Unexpected end of JSON/i.test(raw)
        ? "出歌失败，请再试一次"
        : raw;
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function postVideoMusic(
  req: Request,
  ctx: Ctx,
  actor: { workspaceId: string; email: string },
) {
  const { workspaceId, email } = actor;
  const { id } = await ctx.params;
  const article = await loadArticle(id, workspaceId);
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  const series = ensureVideoSeries(id, article.script_title || article.title);
  let body: {
    action?: string;
    lyrics?: string;
    style?: string;
    styleTags?: string[];
    styleExtra?: string;
    model?: string;
    lyricsModel?: string;
    songTitle?: string;
    vocal?: "m" | "f";
    coverWanted?: boolean;
    coverModel?: string;
    trackId?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求内容不完整，请再试一次" }, { status: 400 });
  }
  const action = body.action || "generate";
  const music = parseSeriesMusic(series.music_json);
  if (typeof body.songTitle === "string") {
    music.songTitle = sanitizeSongTitle(body.songTitle);
  }
  if (Array.isArray(body.styleTags)) {
    music.styleTags = body.styleTags.filter((row) => typeof row === "string");
  }
  if (typeof body.styleExtra === "string") {
    music.styleExtra = body.styleExtra.trim();
  }
  const vocal =
    body.vocal === "f" || body.vocal === "m" ? body.vocal : music.vocal;
  const style =
    (typeof body.style === "string" ? body.style : music.style).trim() ||
    composeMusicStylePrompt(music.styleTags, music.styleExtra, vocal);
  const model = (body.model || music.model || "suno-v5-5").trim();
  const lyricsModel = normalizeScriptLlmId(
    body.lyricsModel || music.lyricsModel,
  );
  music.lyricsModel = lyricsModel;
  const source = articleMusicSource(article);
  const title = (source.title || series.title || "短视频").slice(0, 80);
  const episodes = listVideoEpisodes(series.id);
  const hasScript = episodes.some((ep) => String(ep.voiceover || "").trim());

  let lyrics = (typeof body.lyrics === "string" ? body.lyrics : series.lyrics).trim();

  if (action === "generate-from-script") {
    return NextResponse.json(
      { error: "先写歌词，再点生成音乐。可以按文章或按剧本出词。" },
      { status: 400 },
    );
  }

  if (action === "lyrics") {
    if (!hasScript) {
      return NextResponse.json(
        { error: "还没有剧本对白。可以先按文章写歌词，或先写短视频剧本。" },
        { status: 400 },
      );
    }
    return ndjsonLyricsResponse(
      lyricsModel,
      () =>
        streamSeriesLyrics({
          title,
          logline: series.logline,
          style,
          episodes,
        }),
      async (nextLyrics, songTitle) => {
        const updated = updateVideoSeriesFields(series.id, {
          lyrics: nextLyrics,
          music_json: stringifySeriesMusic({
            ...music,
            style,
            vocal,
            model,
            lyricsModel,
            songTitle: songTitle || music.songTitle,
          }),
        });
        await persistCloudflareDb();
        return payload(updated || series);
      },
    );
  }

  if (action === "lyrics-free") {
    if (!source.title && !source.excerpt) {
      return NextResponse.json(
        { error: "先写文章标题或正文，再单独写歌词。" },
        { status: 400 },
      );
    }
    return ndjsonLyricsResponse(
      lyricsModel,
      () =>
        streamStandaloneLyrics({
          title: source.title || title,
          excerpt: source.excerpt,
          style,
        }),
      async (nextLyrics, songTitle) => {
        const updated = updateVideoSeriesFields(series.id, {
          lyrics: nextLyrics,
          music_json: stringifySeriesMusic({
            ...music,
            style,
            vocal,
            model,
            lyricsModel,
            songTitle: songTitle || music.songTitle,
          }),
        });
        await persistCloudflareDb();
        return payload(updated || series);
      },
    );
  }

  if (typeof body.coverWanted === "boolean") {
    music.coverWanted = body.coverWanted;
  }
  if (typeof body.coverModel === "string" && body.coverModel.trim()) {
    music.coverModel = body.coverModel.trim();
  }
  const coverModel =
    (music.coverModel || resolveCoverImageModelId()).trim() ||
    resolveCoverImageModelId();
  music.coverModel = coverModel;

  if (action === "cover") {
    const titleForCover =
      sanitizeSongTitle(music.songTitle || body.songTitle || "") ||
      sanitizeSongTitle(title) ||
      "未名曲";
    const trackId = String(body.trackId || "").trim();
    const targetId =
      trackId ||
      music.selectedTrackId ||
      music.tracks[0]?.id ||
      "";
    const trackIndex = Math.max(
      0,
      music.tracks.findIndex((row) => row.id === targetId),
    );
    try {
      const cover = await generateMusicCover({
        songTitle: titleForCover,
        lyrics,
        style,
        model: coverModel,
        variant: targetId
          ? `第${trackIndex + 1}版 · ${music.tracks[trackIndex]?.title || ""} · ${COVER_VARIANTS[trackIndex % COVER_VARIANTS.length]}`
          : undefined,
      });
      music.coverWanted = true;
      music.songTitle = titleForCover;
      if (targetId && music.tracks.some((row) => row.id === targetId)) {
        music.tracks = music.tracks.map((row) =>
          row.id === targetId ? { ...row, coverUrl: cover.url } : row,
        );
      } else {
        music.coverUrl = cover.url;
      }
      const next = syncSelectedTrackCover(music);
      const updated = updateVideoSeriesFields(series.id, {
        lyrics: lyrics || series.lyrics,
        music_json: stringifySeriesMusic(next),
      });
      await persistCloudflareDb();
      return NextResponse.json(payload(updated || series));
    } catch (err) {
      const message = err instanceof Error ? err.message : "封面生成失败";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  if (!lyrics) {
    return NextResponse.json(
      { error: "先写歌词再出歌。可以按文章或按剧本生成，也可以自己改。" },
      { status: 400 },
    );
  }

  const songTitle = await withScriptLlm(lyricsModel, () =>
    resolveMusicSongTitle({
      songTitle: music.songTitle,
      lyrics,
      articleTitle: title,
      style,
    }),
  );

  const musicCharge = chargeMusicOrRespond(workspaceId, model, email);
  if (!musicCharge.ok) return musicCharge.response;

  let started: { taskId: string };
  try {
    started = await startSunoGeneration({
      jobId: series.id,
      prompt: lyrics.slice(0, 4800),
      title: songTitle.slice(0, 80),
      style: musicStyleWithDuration(style).slice(0, 1000),
      model: resolveMusicProviderModel(model),
      vocalGender: vocal,
      instrumental: false,
    });
  } catch (err) {
    refundWallet(workspaceId, musicCharge.fen, {
      kind: "music",
      label: "出歌",
      meter: model,
      email,
    });
    await persistCloudflareDb();
    const message = err instanceof Error ? err.message : "出歌失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const next: SeriesMusicState = {
    status: "processing",
    taskId: started.taskId,
    model,
    style,
    vocal,
    error: "",
    tracks: [],
    selectedTrackId: "",
    mixIntoVideo: music.mixIntoVideo !== false,
    styleTags: music.styleTags,
    styleExtra: music.styleExtra,
    lyricsModel,
    songTitle,
    coverUrl: "",
    coverModel,
    coverWanted: music.coverWanted !== false,
  };
  const updated = updateVideoSeriesFields(series.id, {
    lyrics,
    music_json: stringifySeriesMusic(next),
  });
  try {
    await persistCloudflareDb();
  } catch {
    // 先把任务回给前台，落库失败下次写入会再试
  }
  return NextResponse.json(payload(updated || series));
}
