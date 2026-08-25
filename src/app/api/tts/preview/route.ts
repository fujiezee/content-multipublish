import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { previewVoice, resolveTtsVoice, ttsConfigured } from "@/lib/ai/ark-tts";
import { podcastTone } from "@/lib/ai/podcast-shared";
import { ttsSpeechModelMeta } from "@/lib/ai/tts-voice-ids";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  if (!ttsConfigured()) {
    return NextResponse.json(
      { error: "还没配配音。" },
      { status: 400 },
    );
  }
  const url = new URL(req.url);
  const voice = resolveTtsVoice(url.searchParams.get("voice") || "");
  const model = url.searchParams.get("model")?.trim() || undefined;
  const ttsModel = url.searchParams.get("ttsModel")?.trim() || undefined;
  const kind = url.searchParams.get("kind")?.trim() || "";
  const speaker = url.searchParams.get("speaker") === "guest" ? "guest" : "host";
  const mode = url.searchParams.get("mode") === "solo" ? "solo" : "dialogue";
  const tone =
    kind === "podcast" ? podcastTone(speaker, mode) : undefined;
  const ttsMeta = ttsSpeechModelMeta(ttsModel);
  try {
    const clip = await previewVoice(voice, {
      model,
      ttsModel,
      tone,
      expressive:
        kind === "podcast" &&
        ttsMeta.provider === "ark" &&
        ttsMeta.id !== "doubao-seed-tts-1.0",
    });
    const bytes = new Uint8Array(clip.buffer.byteLength);
    bytes.set(clip.buffer);
    const isWav = clip.buffer.slice(0, 4).toString("ascii") === "RIFF";
    const filename = isWav
      ? clip.filename.replace(/\.mp3$/i, ".wav")
      : clip.filename;
    return new NextResponse(bytes, {
      headers: {
        "content-type": isWav ? "audio/wav" : "audio/mpeg",
        "cache-control": "private, no-store",
        "content-disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "试听失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
