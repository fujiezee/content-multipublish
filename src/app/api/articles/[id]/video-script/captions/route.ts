import { requireApiUser } from "@/lib/auth/api";
import {
  dedupeCues,
  dropRepeatedFlowers,
  estimateFilmCues,
  filmCaptionCuesToJson,
  filmCaptionStyleToJson,
  parseFilmCaptionCues,
  parseFilmCaptionStyle,
} from "@/lib/ai/film-caption-style";
import { shotsFromJson } from "@/lib/ai/video-script";
import {
  getArticleInWorkspace,
  getVideoEpisode,
  getVideoSeriesByArticle,
  setVideoEpisodeRender,
} from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 180;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!getArticleInWorkspace(id, auth.ctx.workspaceId)) {
    return Response.json({ error: "文章不存在" }, { status: 404 });
  }
  const series = getVideoSeriesByArticle(id);
  const episodeId = new URL(req.url).searchParams.get("episodeId") || "";
  const episode = episodeId ? getVideoEpisode(episodeId) : undefined;
  if (!series || !episode || episode.series_id !== series.id) {
    return Response.json({ error: "分集不存在" }, { status: 404 });
  }
  if (!episode.video_url) {
    return Response.json({ error: "还没有成片，先合成再编辑" }, { status: 400 });
  }
  const shots = shotsFromJson(episode.shots_json);
  const style = parseFilmCaptionStyle(
    episode.caption_style_json,
    series.title || episode.title,
  );
  let cues = parseFilmCaptionCues(episode.caption_cues_json);
  if (!cues.captions.length || !cues.flowers.length) {
    const estimated = estimateFilmCues(shots);
    cues = {
      captions: cues.captions.length ? cues.captions : estimated.captions,
      flowers: cues.flowers.length ? cues.flowers : estimated.flowers,
    };
  }
  const captions = dedupeCues(cues.captions);
  cues = {
    captions,
    flowers: dropRepeatedFlowers(dedupeCues(cues.flowers), captions),
  };
  return Response.json({
    style,
    cues,
    sourceUrl: episode.source_video_url || null,
    videoUrl: episode.video_url,
    title: series.title || episode.title,
    canRestitch: shots.every((shot) => Boolean(shot.clipUrl?.trim())),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!getArticleInWorkspace(id, auth.ctx.workspaceId)) {
    return Response.json({ error: "文章不存在" }, { status: 404 });
  }
  const series = getVideoSeriesByArticle(id);
  const body = (await req.json().catch(() => ({}))) as {
    episodeId?: string;
    style?: unknown;
    cues?: unknown;
    burn?: boolean;
    prepare?: boolean;
  };
  const episode = body.episodeId ? getVideoEpisode(body.episodeId) : undefined;
  if (!series || !episode || episode.series_id !== series.id) {
    return Response.json({ error: "分集不存在" }, { status: 404 });
  }
  if (!episode.video_url) {
    return Response.json({ error: "还没有成片，先合成再编辑" }, { status: 400 });
  }
  const shots = shotsFromJson(episode.shots_json);
  if (body.prepare === true) {
    try {
      let source = episode.source_video_url?.trim() || "";
      if (!source) {
        if (!shots.every((shot) => Boolean(shot.clipUrl?.trim()))) {
          return Response.json(
            { error: "没有分镜视频，无法做实时预览" },
            { status: 400 },
          );
        }
        const { persistMp4, stitchShotClips } = await import("@/lib/ai/ark-video");
        const stitched = await stitchShotClips(shots);
        source = await persistMp4(stitched.buffer);
        setVideoEpisodeRender(episode.id, {
          video_status: episode.video_status,
          source_video_url: source,
        });
      }
      return Response.json({ sourceUrl: source, prepared: true });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "预览底片准备失败" },
        { status: 400 },
      );
    }
  }
  const style = parseFilmCaptionStyle(
    JSON.stringify(body.style || {}),
    series.title || episode.title,
  );
  const incoming = parseFilmCaptionCues(JSON.stringify(body.cues || {}));
  const stored = parseFilmCaptionCues(episode.caption_cues_json);
  const captions = dedupeCues(
    incoming.captions.length ? incoming.captions : stored.captions,
  );
  const flowers = dropRepeatedFlowers(
    dedupeCues(
      incoming.flowers.length
        ? incoming.flowers
        : stored.flowers.length
          ? stored.flowers
          : estimateFilmCues(shots).flowers,
    ),
    captions,
  );
  const cues = { captions, flowers };
  const styleJson = filmCaptionStyleToJson(style);
  const cuesJson = filmCaptionCuesToJson(cues);
  if (body.burn !== true) {
    const saved = setVideoEpisodeRender(episode.id, {
      video_status: episode.video_status,
      caption_style_json: styleJson,
      caption_cues_json: cuesJson,
    });
    return Response.json({ episode: saved, style, cues, burned: false });
  }

  setVideoEpisodeRender(episode.id, {
    video_status: "generating",
    caption_style_json: styleJson,
    caption_cues_json: cuesJson,
    video_error: null,
  });
  try {
    const {
      loadVideoBuffer,
      persistMp4,
      stitchShotClips,
    } = await import("@/lib/ai/ark-video");
    const { burnShotCaptions, resolveCaptionCues } = await import(
      "@/lib/ai/video-captions"
    );
    let source = episode.source_video_url?.trim() || "";
    let durations: number[] | undefined;
    let plate: Buffer;
    if (source) {
      plate = await loadVideoBuffer(source);
    } else if (shots.every((shot) => Boolean(shot.clipUrl?.trim()))) {
      const stitched = await stitchShotClips(shots);
      plate = stitched.buffer;
      durations = stitched.durations;
      source = await persistMp4(plate);
    } else {
      throw new Error("这一版没有无字幕底片，先重新合成一次再改字");
    }
    if (!cues.captions.length) {
      cues.captions = await resolveCaptionCues(plate, shots, durations);
    }
    const burned = await burnShotCaptions(plate, shots, durations, {
      title: style.title.text || series.title,
      style,
      cues: cues.captions,
      flowers: cues.flowers,
    });
    const url = await persistMp4(burned.buffer);
    const nextCues = {
      captions: burned.cues,
      flowers: burned.flowers,
    };
    const saved = setVideoEpisodeRender(episode.id, {
      video_status: "ready",
      video_url: url,
      source_video_url: source,
      caption_style_json: styleJson,
      caption_cues_json: filmCaptionCuesToJson(nextCues),
      video_error: null,
    });
    return Response.json({
      episode: saved,
      style,
      cues: nextCues,
      burned: true,
      videoUrl: url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "烧字幕失败";
    setVideoEpisodeRender(episode.id, {
      video_status: episode.video_status === "ready" ? "ready" : "failed",
      video_error: message,
    });
    return Response.json({ error: message }, { status: 400 });
  }
}
