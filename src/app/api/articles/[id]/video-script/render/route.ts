import { requireApiUser } from "@/lib/auth/api";
import { dubEpisodeVideo, generateEpisodeVideo } from "@/lib/ai/video-gen";
import {
  shotsFromJson,
  shotsHaveClips,
  shotsToJson,
} from "@/lib/ai/video-script";
import { parseAngles } from "@/lib/ai/character-sheet";
import {
  getArticleInWorkspace,
  getBoundStudioCharacter,
  getVideoEpisode,
  getVideoSeriesByArticle,
  listSeriesCharacters,
  setVideoEpisodeRender,
  updateVideoEpisodeFields,
} from "@/lib/db";
import { normalizeSpeakMode } from "@/lib/types";
import type { VideoShot } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 800;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!getArticleInWorkspace(id, auth.ctx.workspaceId)) {
    return Response.json({ error: "文章不存在" }, { status: 404 });
  }
  const series = getVideoSeriesByArticle(id);
  const body = await req.json().catch(() => ({}));
  const episodeId = String(body.episodeId || "");
  const episode = episodeId ? getVideoEpisode(episodeId) : undefined;
  if (!series || !episode || episode.series_id !== series.id) {
    return Response.json({ error: "分集不存在" }, { status: 404 });
  }
  const dubOnly = body.dubOnly === true;
  const composeOnly = body.composeOnly === true;
  const shotIndex = Number(body.shotIndex);
  const onlyIndexes =
    Number.isFinite(shotIndex) && shotIndex > 0 ? [shotIndex] : [];
  if (!dubOnly && episode.confirmed !== 1) {
    return Response.json({ error: "先确认本集剧本，再生成视频" }, { status: 400 });
  }
  const shots = shotsFromJson(episode.shots_json);
  if (dubOnly && !episode.video_url) {
    return Response.json(
      { error: "还没有成片，先出一版画面再补旁白" },
      { status: 400 },
    );
  }
  if (!dubOnly && composeOnly && !shotsHaveClips(shots)) {
    return Response.json(
      { error: "还有分镜没有出片，先按镜出完再合成" },
      { status: 400 },
    );
  }
  if (!dubOnly && !composeOnly) {
    const pending = onlyIndexes.length
      ? shots.filter((shot) => onlyIndexes.includes(shot.index))
      : shots.filter((shot) => !shot.clipUrl?.trim());
    if (pending.some((shot) => !shot.sceneUrl?.trim())) {
      return Response.json(
        { error: "先生成本集每一镜的场景图，再出视频" },
        { status: 400 },
      );
    }
  }

  setVideoEpisodeRender(episode.id, {
    video_status: "generating",
    video_error: null,
    video_url: episode.video_url,
  });

  const voiceId =
    typeof body.voiceId === "string" && body.voiceId.trim()
      ? body.voiceId.trim()
      : getBoundStudioCharacter(id)?.voice_id || series.voice_id;

  const encoder = new TextEncoder();
  const writeLine = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: Record<string, unknown>,
  ) => {
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
  };

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let latest: VideoShot[] = shots;
        const onProgress = async (event: {
          index: number;
          total: number;
          done: number;
          message: string;
          shot?: VideoShot;
        }) => {
          if (event.shot) {
            latest = latest.map((row) =>
              row.index === event.shot?.index ? event.shot : row,
            );
            updateVideoEpisodeFields(episode.id, {
              shots_json: shotsToJson(latest),
            });
          }
          writeLine(controller, { type: "progress", ...event });
        };
        const cast = listSeriesCharacters(id);
        if (dubOnly) {
          const out = await dubEpisodeVideo(
            {
              videoUrl: episode.video_url || "",
              voiceover:
                episode.voiceover ||
                shots
                  .map((s) => s.voiceover)
                  .filter(Boolean)
                  .join(""),
              voiceId,
            },
            onProgress,
          );
          const saved = setVideoEpisodeRender(episode.id, {
            video_status: "ready",
            video_url: out.url,
            video_model: out.model,
            video_error: null,
          });
          writeLine(controller, { type: "done", episode: saved, shots: latest });
          return;
        }
        const out = await generateEpisodeVideo(
          {
            seriesTitle: series.title,
            episodeNo: episode.episode_no,
            title: episode.title,
            hook: episode.hook,
            voiceover: episode.voiceover,
            onScreen: episode.on_screen,
            durationSec: episode.duration_sec,
            shots,
            aspectRatio: "9:16",
            characterName: cast
              .map((row) => row.name.trim())
              .filter(Boolean)
              .join("、"),
            characterAngles: cast.flatMap((row) =>
              parseAngles(row.angles_json || "[]"),
            ),
            presetId: typeof body.model === "string" ? body.model : undefined,
            speakMode: normalizeSpeakMode(body.speakMode ?? series.speak_mode),
            voiceId,
            cast: cast.map((row) => ({
              id: row.id,
              name: row.name,
              voice_id: row.voice_id,
            })),
            onlyIndexes,
            composeOnly,
          },
          onProgress,
        );
        if (out.shots?.length) {
          latest = out.shots;
          updateVideoEpisodeFields(episode.id, {
            shots_json: shotsToJson(latest),
          });
        }
        const saved = setVideoEpisodeRender(episode.id, {
          video_status: out.composed || episode.video_url ? "ready" : "idle",
          video_url: out.url || episode.video_url,
          video_model: out.model,
          video_error: null,
        });
        writeLine(controller, {
          type: "done",
          episode: saved,
          shots: latest,
          composed: out.composed,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "生成视频失败";
        setVideoEpisodeRender(episode.id, {
          video_status: "failed",
          video_error: message,
        });
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
