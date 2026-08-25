import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import {
  describeCharactersFromScript,
  generateCharacterAngles,
  parseAngles,
  parsePhotos,
} from "@/lib/ai/character-sheet";
import {
  getStudioCharacter,
  getVideoSeriesByArticle,
  listVideoEpisodes,
  updateStudioCharacter,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import type { VideoCharacterPhoto } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const current = getStudioCharacter(id, auth.ctx.workspaceId);
  if (!current) {
    return NextResponse.json({ error: "角色不存在" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  let photos = parsePhotos(current.photos_json);
  let look = typeof body.look === "string" ? body.look.trim() : "";
  if (!look && photos.length === 0 && current.article_id) {
    const series = getVideoSeriesByArticle(current.article_id);
    const episodes = series ? listVideoEpisodes(series.id) : [];
    if (episodes.length > 0) {
      const briefs = await describeCharactersFromScript({
        seriesTitle: series?.title,
        genre: series?.genre,
        hookStyle: series?.hook_style,
        nameHint: current.name,
        episodes: episodes.map((ep) => ({
          title: ep.title,
          hook: ep.hook,
          voiceover: ep.voiceover,
          on_screen: ep.on_screen,
        })),
      });
      look =
        briefs.find((item) => item.name.trim() === current.name.trim())?.look ||
        briefs[0]?.look ||
        "";
    }
  }
  if (photos.length === 0 && !look) {
    const angles = parseAngles(current.angles_json);
    const front = angles.find((a) => a.id === "front") || angles[0];
    if (front?.url) photos = [{ url: front.url }];
  }
  if (photos.length === 0 && !look) {
    return NextResponse.json(
      { error: "这个角色没有外形设定，也没有参考图，没法重出" },
      { status: 400 },
    );
  }
  try {
    const series = current.article_id
      ? getVideoSeriesByArticle(current.article_id)
      : undefined;
    const angles = await generateCharacterAngles({
      name: current.name || "这个人",
      look,
      photos,
      lookStyle: series?.look_style,
      imageModel:
        typeof body.imageModel === "string" ? body.imageModel : undefined,
    });
    updateStudioCharacter({
      id,
      workspaceId: auth.ctx.workspaceId,
      angles_json: JSON.stringify(angles),
    });
    await persistCloudflareDb();
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "生成角色失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!getStudioCharacter(id, auth.ctx.workspaceId)) {
    return NextResponse.json({ error: "角色不存在" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const photos = Array.isArray(body.photos)
    ? (body.photos as VideoCharacterPhoto[])
        .map((p) => ({ url: String(p?.url || "").trim() }))
        .filter((p) => p.url)
        .slice(0, 6)
    : undefined;
  updateStudioCharacter({
    id,
    workspaceId: auth.ctx.workspaceId,
    name: typeof body.name === "string" ? body.name : undefined,
    photos_json: photos ? JSON.stringify(photos) : undefined,
    voice_id: typeof body.voice_id === "string" ? body.voice_id : undefined,
  });
  await persistCloudflareDb();
  return NextResponse.json({ ok: true, id });
}
