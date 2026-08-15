import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { generateCharacterAngles } from "@/lib/ai/character-sheet";
import { listTtsVoices } from "@/lib/ai/ark-tts";
import {
  createStudioCharacter,
  listCharacterCatalog,
  updateStudioCharacter,
} from "@/lib/db";
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
  return NextResponse.json({
    items: listCharacterCatalog(auth.ctx.workspaceId),
    voices: listTtsVoices(),
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
    return NextResponse.json({
      items: listCharacterCatalog(auth.ctx.workspaceId),
      id: row.id,
    });
  }

  try {
    const angles = await generateCharacterAngles({
      name: name || "这个人",
      photos,
    });
    updateStudioCharacter({
      id: row.id,
      workspaceId: auth.ctx.workspaceId,
      name: name || row.name,
      angles_json: JSON.stringify(angles),
      source: "photo",
    });
    return NextResponse.json({
      items: listCharacterCatalog(auth.ctx.workspaceId),
      id: row.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "生成角色失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
