import { requireApiUser } from "@/lib/auth/api";
import { resolveArkVideoPreset } from "@/lib/ai/ark-video";
import { lockEpisodeSpeechTiming } from "@/lib/ai/shot-speech";
import { shotsFromJson, shotsToJson } from "@/lib/ai/video-script";
import {
  getArticleInWorkspace,
  getVideoEpisode,
  getVideoSeriesByArticle,
  listSeriesCharacters,
  updateVideoEpisodeFields,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";
export const maxDuration = 180;

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
  if (episode.confirmed !== 1) {
    return Response.json({ error: "先确认本集剧本，再按对白卡秒" }, { status: 400 });
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
        let latest = shots;
        const next = await lockEpisodeSpeechTiming({
          shots,
          speakMode: series.speak_mode,
          narratorVoiceId: series.voice_id,
          maxSec: resolveArkVideoPreset(
            typeof body.model === "string" ? body.model : undefined,
          ).maxSec,
          cast: cast.map((row) => ({
            id: row.id,
            name: row.name,
            voice_id: row.voice_id,
          })),
          onProgress: async (message, shot) => {
            if (shot) {
              latest = latest.map((row) =>
                row.index === shot.index ? shot : row,
              );
              updateVideoEpisodeFields(episode.id, {
                shots_json: shotsToJson(latest),
              });
              await persistCloudflareDb();
            }
            writeLine(controller, { type: "progress", message, shot });
          },
        });
        updateVideoEpisodeFields(episode.id, {
          shots_json: shotsToJson(next),
        });
        await persistCloudflareDb();
        writeLine(controller, {
          type: "done",
          episodeId: episode.id,
          shots: next,
        });
      } catch (err) {
        writeLine(controller, {
          type: "error",
          error: err instanceof Error ? err.message : "按对白卡秒失败",
        });
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
