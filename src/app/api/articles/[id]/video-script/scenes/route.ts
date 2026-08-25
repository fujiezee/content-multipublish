import { requireApiUser } from "@/lib/auth/api";
import { parseAngles, parsePhotos } from "@/lib/ai/character-sheet";
import { generateEpisodeScenes } from "@/lib/ai/video-scenes";
import { ensureScriptProps, parseScriptProps } from "@/lib/ai/script-props";
import {
  extractSeriesWardrobe,
  parseDirectorLock,
  parseSeriesWardrobe,
  seriesWardrobeToJson,
} from "@/lib/ai/director-lock";
import { shotsFromJson, shotsToJson } from "@/lib/ai/video-script";
import {
  getArticleInWorkspace,
  getVideoEpisode,
  getVideoSeriesByArticle,
  listSeriesCharacters,
  updateVideoEpisodeFields,
  updateVideoSeriesFields,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import { resolveArkVideoPreset } from "@/lib/ai/ark-video";
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
  if (episode.confirmed !== 1) {
    return Response.json(
      { error: "先确认本集剧本没问题，再生成分镜" },
      { status: 400 },
    );
  }
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
        const shotIndex = Number(body.shotIndex);
        const shotIndexes = Array.isArray(body.shotIndexes)
          ? body.shotIndexes.map((n: unknown) => Number(n))
          : Number.isFinite(shotIndex) && shotIndex > 0
            ? [shotIndex]
            : [];
        const resume = body.resume === true;
        const propsJson = series.props_json;
        let propsReady = false;
        try {
          propsReady = Array.isArray(JSON.parse(propsJson || ""));
        } catch {
          propsReady = false;
        }
        if (!resume && !propsReady) {
          await ensureScriptProps({
            articleId: id,
            imageModel:
              typeof body.imageModel === "string" ? body.imageModel : undefined,
            onProgress: async (message) => {
              writeLine(controller, { type: "progress", message });
            },
          });
        }
        const fresh = getVideoSeriesByArticle(id);
        const episodeNow = getVideoEpisode(episode.id) || episode;
        const latestShots = shotsFromJson(episodeNow.shots_json);
        let latest: VideoShot[] = latestShots.length ? latestShots : shots;
        const next = await generateEpisodeScenes({
          shots: latest,
          characters: cast.map((row) => ({
            name: row.name,
            look: row.look,
            voiceId: row.voice_id,
            photos: parsePhotos(row.photos_json || "[]"),
            angles: parseAngles(row.angles_json || "[]"),
          })),
          force: body.force === true,
          onlyIndexes: shotIndexes,
          fillMissing: resume || body.fillMissing === true,
          maxNewShots: 1,
          refShotIndex: Number(body.refShotIndex) || undefined,
          lookStyle: series.look_style,
          director: parseDirectorLock(episodeNow.director_json),
          wardrobe: parseSeriesWardrobe(fresh?.wardrobe_json || series.wardrobe_json),
          seriesAnchorUrl: parseSeriesWardrobe(
            fresh?.wardrobe_json || series.wardrobe_json,
          ).lastFrameUrl,
          props: parseScriptProps(fresh?.props_json || series.props_json),
          imageModel:
            typeof body.imageModel === "string" ? body.imageModel : undefined,
          speakMode: series.speak_mode,
          narratorVoiceId: series.voice_id,
          castVoices: cast.map((row) => ({
            id: row.id,
            name: row.name,
            voice_id: row.voice_id,
          })),
          maxSec: resolveArkVideoPreset(
            typeof body.model === "string" ? body.model : undefined,
          ).maxSec,
          onProgress: async (event) => {
            if (event.shot) {
              latest = latest.map((s) =>
                s.index === event.shot?.index ? event.shot : s,
              );
              updateVideoEpisodeFields(episode.id, {
                shots_json: shotsToJson(latest),
              });
              await persistCloudflareDb();
            }
            writeLine(controller, { type: "progress", ...event });
          },
        });
        updateVideoEpisodeFields(episode.id, {
          shots_json: shotsToJson(next),
        });
        await persistCloudflareDb();
        const wardrobe = extractSeriesWardrobe(
          next,
          parseSeriesWardrobe(fresh?.wardrobe_json || series.wardrobe_json),
        );
        updateVideoSeriesFields(series.id, {
          wardrobe_json: seriesWardrobeToJson(wardrobe),
        });
        await persistCloudflareDb();
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
