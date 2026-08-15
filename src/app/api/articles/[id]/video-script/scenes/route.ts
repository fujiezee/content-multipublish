import { requireApiUser } from "@/lib/auth/api";
import { parseAngles, parsePhotos } from "@/lib/ai/character-sheet";
import { generateEpisodeScenes } from "@/lib/ai/video-scenes";
import { shotsFromJson, shotsToJson } from "@/lib/ai/video-script";
import {
  getArticleInWorkspace,
  getVideoEpisode,
  getVideoSeriesByArticle,
  listSeriesCharacters,
  updateVideoEpisodeFields,
} from "@/lib/db";
import type { VideoShot } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

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

  const shots = shotsFromJson(episode.shots_json);
  if (shots.length === 0) {
    return Response.json({ error: "这集还没有分镜" }, { status: 400 });
  }

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
        const cast = listSeriesCharacters(id);
        let latest: VideoShot[] = shots;
        const shotIndex = Number(body.shotIndex);
        const shotIndexes = Array.isArray(body.shotIndexes)
          ? body.shotIndexes.map((n: unknown) => Number(n))
          : Number.isFinite(shotIndex) && shotIndex > 0
            ? [shotIndex]
            : [];
        const next = await generateEpisodeScenes({
          shots,
          characters: cast.map((row) => ({
            name: row.name,
            photos: parsePhotos(row.photos_json || "[]"),
            angles: parseAngles(row.angles_json || "[]"),
          })),
          force: body.force === true,
          onlyIndexes: shotIndexes,
          onProgress: async (event) => {
            if (event.shot) {
              latest = latest.map((s) =>
                s.index === event.shot?.index ? event.shot : s,
              );
              updateVideoEpisodeFields(episode.id, {
                shots_json: shotsToJson(latest),
              });
            }
            writeLine(controller, { type: "progress", ...event });
          },
        });
        updateVideoEpisodeFields(episode.id, {
          shots_json: shotsToJson(next),
        });
        writeLine(controller, {
          type: "done",
          episodeId: episode.id,
          shots: next,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "生成场景失败";
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
