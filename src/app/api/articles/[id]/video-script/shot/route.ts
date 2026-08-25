import { requireApiUser } from "@/lib/auth/api";
import {
  applyShotEmotionPatches,
  rewriteShotCopy,
} from "@/lib/ai/emotion-beat";
import { shotsFromJson, shotsToJson } from "@/lib/ai/video-script";
import {
  getArticleInWorkspace,
  getVideoEpisode,
  getVideoSeriesByArticle,
  updateVideoEpisodeFields,
} from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

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
    shotIndex?: number;
    intent?: string;
  };
  const episode = body.episodeId ? getVideoEpisode(body.episodeId) : undefined;
  if (!series || !episode || episode.series_id !== series.id) {
    return Response.json({ error: "分集不存在" }, { status: 404 });
  }
  const shots = shotsFromJson(episode.shots_json);
  const index = Number(body.shotIndex);
  const at = shots.findIndex((shot) => shot.index === index);
  if (at < 0) {
    return Response.json({ error: "这一镜不存在" }, { status: 400 });
  }
  const intent = body.intent === "emotion" ? "emotion" : "visual";
  try {
    const patch = await rewriteShotCopy({
      shot: shots[at],
      intent,
      prev: shots[at - 1],
      next: shots[at + 1],
      title: episode.title,
      hook: episode.hook,
    });
    const next = applyShotEmotionPatches(shots, [patch]);
    updateVideoEpisodeFields(episode.id, { shots_json: shotsToJson(next) });
    return Response.json({
      shot: next[at],
      shots: next,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "重写失败" },
      { status: 400 },
    );
  }
}
