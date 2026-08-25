import { randomBytes } from "crypto";
import {
  resolveQwenApiKey,
  resolveQwenOpenAiBase,
} from "@/lib/ai/model-catalog/qwen-seed";
import { persistPublicAsset } from "@/lib/storage/public-media";
import type { StudioVoice } from "@/lib/types";
import {
  isRealtimeTtsModel,
  synthesizeQwenRealtime,
} from "@/lib/ai/qwen-tts-realtime";

const MAX_BYTES = 10 * 1024 * 1024;
const MIN_BYTES = 8 * 1024;

type CloneResult = {
  provider: string;
  providerVoiceId: string;
  providerModel: string;
};

const DASHSCOPE_ORIGIN = "https://dashscope.aliyuncs.com";

function qwenHost(): string {
  const base = resolveQwenOpenAiBase().replace(/\/$/, "");
  if (!base) return DASHSCOPE_ORIGIN;
  return base
    .replace(/\/compatible-mode\/v1$/i, "")
    .replace(/\/v1$/i, "");
}

function customizationUrls(): string[] {
  return [
    ...new Set([
      `${DASHSCOPE_ORIGIN}/api/v1/services/audio/tts/customization`,
      `${qwenHost()}/api/v1/services/audio/tts/customization`,
    ]),
  ];
}

function customizationUrl(): string {
  return customizationUrls()[0];
}

function mimeOf(filename: string, contentType?: string): string {
  const type = (contentType || "").toLowerCase();
  if (/wav/.test(type) || /\.wav$/i.test(filename)) return "audio/wav";
  if (/mpeg|mp3/.test(type) || /\.mp3$/i.test(filename)) return "audio/mpeg";
  if (/mp4|m4a/.test(type) || /\.m4a$/i.test(filename) || /\.mp4$/i.test(filename)) {
    return "audio/mp4";
  }
  if (/ogg/.test(type) || /\.ogg$/i.test(filename)) return "audio/ogg";
  return type.startsWith("audio/") ? type : "audio/mpeg";
}

function formatOf(filename: string, contentType?: string): string {
  const mime = mimeOf(filename, contentType);
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "mp3";
}

export function cloneAudioAllowed(
  filename: string,
  contentType?: string,
): boolean {
  const mime = mimeOf(filename, contentType);
  const name = filename.toLowerCase();
  return (
    /audio\/(wav|mpeg|mp3|mp4|m4a|x-m4a|ogg)/.test(mime) ||
    /\.(wav|mp3|m4a|mp4|ogg)$/.test(name)
  );
}

function preferredName(): string {
  return `dw${randomBytes(4).toString("hex")}`.slice(0, 16);
}

function dashScopeError(raw: string, status: number): string {
  try {
    const parsed = JSON.parse(raw) as {
      message?: string;
      code?: string;
      error?: { message?: string };
    };
    const msg =
      parsed.message || parsed.error?.message || parsed.code || "";
    if (msg) return msg.replace(/\s+/g, " ").trim().slice(0, 180);
  } catch {
    /* ignore */
  }
  const trimmed = raw.replace(/\s+/g, " ").trim().slice(0, 180);
  return trimmed || `克隆失败 ${status}`;
}

async function postJson(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status, json, text };
}

function outputVoiceId(json: Record<string, unknown>): string {
  const output = json.output as Record<string, unknown> | undefined;
  const id = String(
    output?.voice_id || output?.voice || json.voice_id || json.voice || "",
  ).trim();
  return id;
}

async function enrollQwenTts(
  apiKey: string,
  audio: Buffer,
  filename: string,
  contentType: string | undefined,
  model: string,
): Promise<CloneResult> {
  const mime = mimeOf(filename, contentType);
  const payload = {
    model: "qwen-voice-enrollment",
    input: {
      action: "create",
      target_model: model,
      preferred_name: preferredName(),
      language: "zh",
      audio: {
        data: `data:${mime};base64,${audio.toString("base64")}`,
      },
    },
  };
  const errors: string[] = [];
  for (const url of customizationUrls()) {
    const { status, json, text } = await postJson(url, apiKey, payload);
    const voiceId = outputVoiceId(json);
    if (status < 400 && voiceId) {
      return {
        provider: "qwen",
        providerVoiceId: voiceId,
        providerModel: String(
          (json.output as { target_model?: string } | undefined)?.target_model ||
            model,
        ),
      };
    }
    errors.push(dashScopeError(text, status));
  }
  throw new Error(errors[0] || "克隆失败");
}

async function enrollCosyVoice(
  apiKey: string,
  sampleUrl: string,
  model: string,
): Promise<CloneResult> {
  const payload = {
    model: "voice-enrollment",
    input: {
      action: "create_voice",
      target_model: model,
      prefix: "dw",
      url: sampleUrl,
      language_hints: ["zh"],
      enable_preprocess: true,
    },
  };
  const errors: string[] = [];
  for (const url of customizationUrls()) {
    const { status, json, text } = await postJson(url, apiKey, payload);
    const voiceId = outputVoiceId(json);
    if (status < 400 && voiceId) {
      return {
        provider: "qwen",
        providerVoiceId: voiceId,
        providerModel: model,
      };
    }
    errors.push(dashScopeError(text, status));
  }
  throw new Error(errors[0] || "克隆失败");
}

export async function cloneStudioVoice(input: {
  bytes: Buffer;
  filename: string;
  contentType?: string;
  name?: string;
}): Promise<CloneResult & { sampleUrl: string }> {
  const apiKey = resolveQwenApiKey();
  if (!apiKey) {
    throw new Error("还没配千问。音色克隆走 DASHSCOPE_API_KEY。");
  }
  if (input.bytes.length < MIN_BYTES) {
    throw new Error("录音太短。请说满 5 秒以上，或换一段更长的音频。");
  }
  if (input.bytes.length > MAX_BYTES) {
    throw new Error("音频超过 10MB，请剪短再传。");
  }
  if (!cloneAudioAllowed(input.filename, input.contentType)) {
    throw new Error("请上传 wav、mp3 或 m4a。");
  }

  const ext = formatOf(input.filename, input.contentType);
  const sampleUrl = await persistPublicAsset({
    bytes: input.bytes,
    filename: `voice-${Date.now()}.${ext}`,
    contentType: mimeOf(input.filename, input.contentType),
    label: "音色样本",
  });

  const errors: string[] = [];
  const qwenModels = [
    "qwen3-tts-vc-2026-01-22",
    "qwen3-tts-flash",
    "qwen3-tts-vc-realtime-2026-01-15",
  ];
  for (const model of qwenModels) {
    try {
      const cloned = await enrollQwenTts(
        apiKey,
        input.bytes,
        input.filename,
        input.contentType,
        model,
      );
      return { ...cloned, sampleUrl };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  const cosyModels = ["cosyvoice-v3-flash", "qwen-audio-3.0-tts-flash"];
  for (const model of cosyModels) {
    try {
      const cloned = await enrollCosyVoice(apiKey, sampleUrl, model);
      return { ...cloned, sampleUrl };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(errors[0] || "克隆失败");
}

export async function deleteClonedProviderVoice(voice: StudioVoice): Promise<void> {
  const apiKey = resolveQwenApiKey();
  if (!apiKey || !voice.provider_voice_id) return;
  const model = /cosyvoice-|qwen-audio-/i.test(voice.provider_voice_id)
    ? "voice-enrollment"
    : "qwen-voice-enrollment";
  const action = model === "voice-enrollment" ? "delete_voice" : "delete";
  const key = model === "voice-enrollment" ? "voice_id" : "voice";
  try {
    await postJson(customizationUrl(), apiKey, {
      model,
      input: { action, [key]: voice.provider_voice_id },
    });
  } catch {
    /* 本地删掉即可 */
  }
}

function looksLikeAudio(buf: Buffer, contentType: string): boolean {
  if (buf.length < 64) return false;
  if (
    /audio|mpeg|mp3|wav|ogg|mp4/i.test(contentType) &&
    buf[0] !== 0x7b &&
    buf[0] !== 0x3c
  ) {
    return true;
  }
  return (
    buf[0] === 0xff ||
    buf.slice(0, 4).toString("ascii") === "RIFF" ||
    buf.slice(0, 3).toString("ascii") === "ID3"
  );
}

function extractAudioRef(json: Record<string, unknown>): {
  url?: string;
  base64?: string;
} {
  const output = (json.output || json) as Record<string, unknown>;
  const audio = (output.audio || output.audio_data || json.audio) as
    | Record<string, unknown>
    | string
    | undefined;
  if (typeof audio === "string" && audio.trim()) {
    if (/^https?:\/\//i.test(audio) || audio.startsWith("//")) {
      return { url: audio.trim() };
    }
    return { base64: audio.trim() };
  }
  if (!audio || typeof audio !== "object") return {};
  const url = String(audio.url || audio.audio_url || "").trim();
  const data = String(audio.data || audio.audio || "").trim();
  return {
    url: url || undefined,
    base64: data || undefined,
  };
}

async function decodeTtsResponse(res: Response): Promise<Buffer> {
  const contentType = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.ok && looksLikeAudio(buf, contentType)) return buf;
  const raw = buf.toString("utf8");
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(dashScopeError(raw, res.status));
  }
  if (!res.ok) throw new Error(dashScopeError(raw, res.status));
  const extracted = extractAudioRef(json);
  if (extracted.base64) {
    const b64 = extracted.base64.replace(/^data:[^;]+;base64,/, "");
    const decoded = Buffer.from(b64, "base64");
    if (decoded.length > 64) return decoded;
  }
  if (extracted.url) {
    const audioUrl = extracted.url.startsWith("http://")
      ? `https://${extracted.url.slice("http://".length)}`
      : extracted.url;
    const audioRes = await fetch(audioUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    const audioBuf = Buffer.from(await audioRes.arrayBuffer());
    if (audioRes.ok && audioBuf.length > 64) return audioBuf;
    throw new Error("合成音频下载失败");
  }
  throw new Error(dashScopeError(raw, res.status) || "合成没有返回音频");
}

async function postTts(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Buffer> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(18_000),
  });
  return decodeTtsResponse(res);
}

export async function synthesizeClonedVoice(
  text: string,
  voice: StudioVoice,
): Promise<Buffer> {
  const apiKey = resolveQwenApiKey();
  if (!apiKey) throw new Error("还没配千问，克隆音色配不通。");
  const spoken = text.replace(/\s+/g, " ").trim().slice(0, 4000);
  const voiceId = voice.provider_voice_id;
  const stored = voice.provider_model || "qwen3-tts-vc-2026-01-22";
  const maas = qwenHost();
  const attempts: Array<() => Promise<Buffer>> = [];
  const realtimeModel = isRealtimeTtsModel(stored)
    ? stored
    : "qwen3-tts-vc-realtime-2026-01-15";

  const realtime = () =>
    synthesizeQwenRealtime({
      apiKey,
      model: realtimeModel,
      voice: voiceId,
      text: spoken,
    });

  if (isRealtimeTtsModel(stored) || /qwen-tts-vc-|qwen-omni-vc-/i.test(voiceId)) {
    attempts.push(realtime);
  }

  if (!isRealtimeTtsModel(stored) && !/cosyvoice-|qwen-audio-/i.test(stored)) {
    attempts.push(() =>
      postTts(
        `${DASHSCOPE_ORIGIN}/api/v1/services/aigc/multimodal-generation/generation`,
        apiKey,
        {
          model: stored,
          input: {
            text: spoken,
            voice: voiceId,
            language_type: "Chinese",
          },
        },
      ),
    );
    attempts.push(() =>
      postTts(
        `${DASHSCOPE_ORIGIN}/api/v1/services/aigc/multimodal-generation/generation`,
        apiKey,
        {
          model: "qwen3-tts-vc-2026-01-22",
          input: {
            text: spoken,
            voice: voiceId,
            language_type: "Chinese",
          },
        },
      ),
    );
  }

  if (/cosyvoice-|qwen-audio-/i.test(stored)) {
    attempts.push(() =>
      postTts(
        `${maas}/api/v1/services/audio/tts/SpeechSynthesizer`,
        apiKey,
        {
          model: stored,
          input: {
            text: spoken,
            voice: voiceId,
            format: "mp3",
            sample_rate: 24000,
          },
        },
      ),
    );
  }

  if (!attempts.some((fn) => fn === realtime)) {
    attempts.push(realtime);
  }

  const errors: string[] = [];
  for (const run of attempts) {
    try {
      return await run();
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  const useful = errors.filter((msg) => !/Invalid message type/i.test(msg));
  throw new Error(useful[0] || errors[0] || "试听失败");
}
