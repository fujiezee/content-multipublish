import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { generateCharacterAngles } from "@/lib/ai/character-sheet";
import { listImageGenModels } from "@/lib/ai/image-gen-models";
import { listTtsVoices } from "@/lib/ai/ark-tts";
import {
  createStudioCharacter,
  listCharacterCatalog,
  updateStudioCharacter,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import { parseListPage, slicePage } from "@/lib/list-page";
import type { VideoCharacterPhoto } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

function normalizePhotos(raw: unknown): VideoCharacterPhoto[] {
  if (!Array.isArray(raw)) return [];
  return (raw as VideoCharacterPhoto[])
    .map((p) => ({ url: String(p?.url || "").trim() }))
    .filter((p) => p.url)
    .slice(0, 6);
}

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parseListPage(new URL(req.url));
  const rows = listCharacterCatalog(auth.ctx.workspaceId, {
    angles: "first",
    limit: limit + 1,
    offset,
  });
  const page = slicePage(rows, limit, offset);
  return NextResponse.json({
    items: page.items,
    nextOffset: page.nextOffset,
    hasMore: page.hasMore,
    voices: listTtsVoices(auth.ctx.workspaceId),
    imageModels: listImageGenModels(),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const photos = normalizePhotos(body.photos);
  const generate = body.generate !== false;
  if (generate && photos.length === 0) {
    return NextResponse.json({ error: "先上传一张自己的照片" }, { status: 400 });
  }

  const voiceId = typeof body.voice_id === "string" ? body.voice_id.trim() : "";
  const row = createStudioCharacter({
    workspaceId: auth.ctx.workspaceId,
    name,
    photos_json: JSON.stringify(photos),
    source: "photo",
    voice_id: voiceId,
  });

  if (!generate) {
    await persistCloudflareDb();
    return NextResponse.json({ id: row.id });
  }

  try {
    const angles = await generateCharacterAngles({
      name: name || "这个人",
      photos,
      imageModel:
        typeof body.imageModel === "string" ? body.imageModel : undefined,
    });
    updateStudioCharacter({
      id: row.id,
      workspaceId: auth.ctx.workspaceId,
      name: name || row.name,
      angles_json: JSON.stringify(angles),
      source: "photo",
    });
    await persistCloudflareDb();
    return NextResponse.json({ id: row.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "生成角色失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
