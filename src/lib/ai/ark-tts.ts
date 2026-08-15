import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { resolveDoubaoEnvConfig } from "@/lib/ai/doubao";
import {
  DEFAULT_CHARACTER_VOICE,
  resolveVoiceId,
  TTS_VOICE_OPTIONS,
} from "@/lib/ai/tts-voice-ids";
import { getDoubaoStoredSecret } from "@/lib/db";
import { UPLOADS_DIR, ensureDataDirs } from "@/lib/paths";
import { uploadPublicMedia } from "@/lib/storage/public-media";

const ARK_BASE = "https://ark.cn-beijing.volces.com/api/v3";
const PREVIEW_LINE =
  "今天这条，我用大白话讲。别端着，就像跟朋友吃饭时聊到的那样。";
const PREVIEW_VERSION = "v3";

export type TtsVoiceOption = {
  id: string;
  label: string;
  hint: string;
  group?: string;
};

type VoiceRow = TtsVoiceOption & {
  openaiVoice: string;
  style: string;
};

const NATURAL =
  "说自然普通话，像短视频口播，句子短，有停顿，像跟人聊天，不要播音腔，不要念稿，不要英文腔。";

const VOICE_STYLES: Record<string, string> = {
  nova: `${NATURAL}语气热络一点，带着笑意。`,
  coral: `${NATURAL}干脆利落，别拖腔。`,
  shimmer: `${NATURAL}轻快一点，别端着。`,
  sage: `${NATURAL}稳，但别像新闻播报。`,
  marin: `${NATURAL}软一点，像小声讲给旁边人听。`,
  ballad: `${NATURAL}像讲一件亲身经历，有轻重。`,
  verse: `${NATURAL}情绪跟着内容走，该急就急。`,
  alloy: `${NATURAL}中性、干净，别拿腔。`,
  fable: `${NATURAL}活泼一点，像聊天。`,
  echo: `${NATURAL}像坐对面说话，别拉开距离。`,
  ash: `${NATURAL}低一点，像朋友提醒，不是念文件。`,
  onyx: `${NATURAL}沉，但别装腔。`,
  cedar: `${NATURAL}实在，短句，像东北以外的大白话。`,
};

export const ARK_TTS_VOICES: VoiceRow[] = TTS_VOICE_OPTIONS.map((row) => ({
  id: row.id,
  label: row.label,
  hint: row.hint,
  group: row.group,
  openaiVoice: row.openaiVoice,
  style: VOICE_STYLES[row.openaiVoice] || NATURAL,
}));

const DEFAULT_TTS_VOICE =
  process.env.ARK_TTS_VOICE?.trim() || DEFAULT_CHARACTER_VOICE;

function voiceRow(id?: string): VoiceRow {
  const wanted = resolveVoiceId(id, DEFAULT_TTS_VOICE);
  return (
    ARK_TTS_VOICES.find((v) => v.id === wanted) ||
    ARK_TTS_VOICES.find((v) => v.id === DEFAULT_TTS_VOICE) ||
    ARK_TTS_VOICES[0]
  );
}

export function listTtsVoices(): TtsVoiceOption[] {
  return ARK_TTS_VOICES.map(({ id, label, hint, group }) => ({
    id,
    label,
    hint,
    group,
  }));
}

export function resolveTtsVoice(id?: string): string {
  return voiceRow(id).id;
}

function openaiVoiceFor(id?: string): string {
  return voiceRow(id).openaiVoice;
}

function styleFor(id?: string): string {
  return voiceRow(id).style;
}

function resolveArkConfig(): { apiKey: string; baseUrl: string } | null {
  const env = resolveDoubaoEnvConfig();
  const stored = getDoubaoStoredSecret();
  const apiKey = env?.apiKey || stored.apiKey;
  if (!apiKey) return null;
  return { apiKey, baseUrl: env?.baseUrl || ARK_BASE };
}

function resolveOpenAiTtsConfig(): { apiKey: string; baseUrl: string } | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  let baseUrl = (
    process.env.OPENAI_TTS_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    "https://api.openai-proxy.org/v1"
  ).replace(/\/$/, "");
  if (!baseUrl.endsWith("/v1")) baseUrl = `${baseUrl}/v1`;
  return { apiKey, baseUrl };
}

export function ttsConfigured(): boolean {
  return resolveOpenAiTtsConfig() !== null || resolveArkConfig() !== null;
}

export type SpeechClip = {
  buffer: Buffer;
  url?: string;
};

function looksLikeAudio(buf: Buffer, contentType: string): boolean {
  if (buf.length < 64) return false;
  if (/audio|mpeg|mp3|wav|ogg|mp4/i.test(contentType)) return true;
  return (
    buf[0] === 0xff ||
    buf.slice(0, 4).toString("ascii") === "RIFF" ||
    buf.slice(0, 3).toString("ascii") === "ID3"
  );
}

function explainTtsError(raw: string, status: number): string {
  if (/AccountOverdueError|overdue|欠费/i.test(raw)) {
    return "账号欠费，配音调不通。";
  }
  if (/ModelNotOpen|未开通/i.test(raw)) {
    return "语音模型还没开通。";
  }
  if (/InvalidEndpointOrModel|does not exist|NotFound|404/i.test(raw) || status === 404) {
    return "这个配音接口不可用。";
  }
  const trimmed = raw.replace(/\s+/g, " ").trim().slice(0, 160);
  return trimmed || `配音失败 ${status}`;
}

async function postSpeech(
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
    signal: AbortSignal.timeout(45_000),
  });
  const contentType = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.ok && looksLikeAudio(buf, contentType)) return buf;
  const raw = buf.toString("utf8");
  throw new Error(explainTtsError(raw, res.status));
}

let cachedOpenAiModel: string | undefined;

async function synthesizeViaOpenAi(
  text: string,
  voiceId: string,
): Promise<Buffer> {
  const config = resolveOpenAiTtsConfig();
  if (!config) throw new Error("还没配 OPENAI_API_KEY，配音调不通。");
  const voice = openaiVoiceFor(voiceId);
  const models = [
    process.env.OPENAI_TTS_MODEL?.trim(),
    cachedOpenAiModel,
    "gpt-4o-mini-tts",
    "gpt-4o-tts",
    "tts-1-hd",
    "tts-1",
  ].filter((x, i, arr): x is string => Boolean(x) && arr.indexOf(x) === i);

  let last = "配音失败";
  for (const model of models) {
    try {
      const buffer = await postSpeech(`${config.baseUrl}/audio/speech`, config.apiKey, {
        model,
        input: text.slice(0, 4000),
        voice,
        response_format: "mp3",
        speed: 1.06,
        ...(model.includes("gpt-4o")
          ? { instructions: styleFor(voiceId) }
          : {}),
      });
      cachedOpenAiModel = model;
      return buffer;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(last);
}

async function synthesizeViaArk(
  text: string,
  voiceId: string,
): Promise<Buffer> {
  const config = resolveArkConfig();
  if (!config) throw new Error("还没配方舟。");
  const voice = voiceRow(voiceId).id;
  const models = [
    process.env.ARK_TTS_MODEL?.trim(),
    "doubao-seed-tts-2.0",
    "doubao-seed-tts-1.0",
    "seed-tts-2.0",
  ].filter((x, i, arr): x is string => Boolean(x) && arr.indexOf(x) === i);
  let last = "方舟配音失败";
  for (const model of models) {
    try {
      return await postSpeech(`${config.baseUrl}/audio/speech`, config.apiKey, {
        model,
        input: text.slice(0, 4000),
        voice,
        response_format: "mp3",
      });
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(last);
}

async function synthesizeSpeechBuffer(
  text: string,
  voiceId: string,
): Promise<Buffer> {
  const spoken = text.replace(/\s+/g, " ").trim();
  if (!spoken) throw new Error("没有可朗读的文字");
  const errors: string[] = [];
  const preferArk = /bigtts|zh_/i.test(voiceRow(voiceId).id);
  const tryArk = async () => {
    if (!resolveArkConfig()) return false;
    try {
      const buf = await synthesizeViaArk(spoken, voiceId);
      return buf;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      return false;
    }
  };
  const tryOpenAi = async () => {
    if (!resolveOpenAiTtsConfig()) return false;
    try {
      const buf = await synthesizeViaOpenAi(spoken, voiceId);
      return buf;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      return false;
    }
  };
  const first = preferArk ? await tryArk() : await tryOpenAi();
  if (first) return first;
  const second = preferArk ? await tryOpenAi() : await tryArk();
  if (second) return second;
  throw new Error(errors[0] || "还没配可用的配音接口");
}

async function persistSpeech(buf: Buffer, mime: string): Promise<string | undefined> {
  ensureDataDirs();
  const ext = /wav/i.test(mime) ? ".wav" : ".mp3";
  const name = `${randomUUID()}${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
  const publicUrl = await uploadPublicMedia({
    bytes: buf,
    filename: name,
    contentType: mime || (ext === ".wav" ? "audio/wav" : "audio/mpeg"),
  });
  return publicUrl || undefined;
}

export async function previewVoice(
  voiceId?: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const voice = resolveTtsVoice(voiceId);
  const filename = `tts-preview-${PREVIEW_VERSION}-${voice.replace(/[^a-zA-Z0-9_]/g, "_")}.mp3`;
  ensureDataDirs();
  const file = path.join(UPLOADS_DIR, filename);
  if (fs.existsSync(file) && fs.statSync(file).size > 64) {
    return { buffer: fs.readFileSync(file), filename };
  }
  const buffer = await synthesizeSpeechBuffer(PREVIEW_LINE, voice);
  fs.writeFileSync(file, buffer);
  return { buffer, filename };
}

export async function publishSpeechBuffer(buffer: Buffer): Promise<SpeechClip> {
  const url = await persistSpeech(buffer, "audio/mpeg");
  if (!url) {
    throw new Error(
      "配音没有传到公网图床，2.0 拿不到参考音，口型对不上。先配置 PUBLIC_MEDIA_UPLOAD_URL。",
    );
  }
  return { buffer, url };
}

export async function synthesizeSpeechOrThrow(
  text: string,
  voiceId?: string,
  opts?: { requirePublicUrl?: boolean },
): Promise<SpeechClip> {
  const spoken = text.replace(/\s+/g, " ").trim();
  if (!spoken) throw new Error("没有可朗读的口播，先把旁白写上");
  const buffer = await synthesizeSpeechBuffer(spoken, resolveTtsVoice(voiceId));
  if (opts?.requirePublicUrl) return publishSpeechBuffer(buffer);
  const url = await persistSpeech(buffer, "audio/mpeg");
  return { buffer, url };
}

export async function synthesizeSpeech(
  text: string,
  voiceId?: string,
): Promise<SpeechClip | null> {
  try {
    return await synthesizeSpeechOrThrow(text, voiceId);
  } catch {
    return null;
  }
}
