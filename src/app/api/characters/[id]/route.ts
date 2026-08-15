import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { generateCharacterAngles, parsePhotos } from "@/lib/ai/character-sheet";
import {
  getStudioCharacter,
  listCharacterCatalog,
  updateStudioCharacter,
} from "@/lib/db";
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
  const photos = parsePhotos(current.photos_json);
  if (photos.length === 0) {
    return NextResponse.json({ error: "这个角色还没有参考照片" }, { status: 400 });
  }
  try {
    const angles = await generateCharacterAngles({
      name: current.name || "这个人",
      photos,
    });
    updateStudioCharacter({
      id,
      workspaceId: auth.ctx.workspaceId,
      angles_json: JSON.stringify(angles),
      source: "photo",
    });
    return NextResponse.json({
      items: listCharacterCatalog(auth.ctx.workspaceId),
    });
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
  return NextResponse.json({
    items: listCharacterCatalog(auth.ctx.workspaceId),
  });
}
