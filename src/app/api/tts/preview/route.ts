import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { previewVoice, resolveTtsVoice, ttsConfigured } from "@/lib/ai/ark-tts";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  if (!ttsConfigured()) {
    return NextResponse.json(
      { error: "还没配配音。.env.local 里要有 OPENAI_API_KEY。" },
      { status: 400 },
    );
  }
  const voice = resolveTtsVoice(new URL(req.url).searchParams.get("voice") || "");
  try {
    const clip = await previewVoice(voice);
    return new NextResponse(Uint8Array.from(clip.buffer), {
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "private, max-age=86400",
        "content-disposition": `inline; filename="${clip.filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "试听失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
