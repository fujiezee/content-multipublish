import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { cloneStudioVoice } from "@/lib/ai/voice-clone";
import {
  createStudioVoice,
  listStudioVoices,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({
    items: listStudioVoices(auth.ctx.workspaceId),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "请上传一段音频" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传一段音频" }, { status: 400 });
  }
  const name =
    typeof form.get("name") === "string" ? String(form.get("name")) : "";
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const cloned = await cloneStudioVoice({
      bytes,
      filename: file.name || "voice.wav",
      contentType: file.type,
      name,
    });
    const row = createStudioVoice({
      workspaceId: auth.ctx.workspaceId,
      name: name || "我的音色",
      hint: "自己克隆的",
      provider: cloned.provider,
      provider_voice_id: cloned.providerVoiceId,
      provider_model: cloned.providerModel,
      sample_url: cloned.sampleUrl,
    });
    await persistCloudflareDb();
    return NextResponse.json({ item: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : "克隆失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
