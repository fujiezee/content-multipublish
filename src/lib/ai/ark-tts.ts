import { execFile } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { resolveDoubaoEnvConfig } from "@/lib/ai/doubao";
import {
  actingVoiceId,
  arkTtsModelsForVoice,
  CUSTOM_VOICE_GROUP,
  DEFAULT_CHARACTER_VOICE,
  isCustomVoiceId,
  resolveTtsSpeechModel,
  resolveVoiceId,
  TTS_SPEECH_MODELS,
  TTS_VOICE_OPTIONS,
  ttsSpeechModelMeta,
  ttsVoiceGeneration,
} from "@/lib/ai/tts-voice-ids";
import { getDoubaoStoredSecret, getStudioVoiceByProviderId, listStudioVoices } from "@/lib/db";
import { synthesizeClonedVoice } from "@/lib/ai/voice-clone";
import { isCloudflareRuntime, UPLOADS_DIR, ensureDataDirs } from "@/lib/paths";
import { persistPublicAsset } from "@/lib/storage/public-media";
import { VOICE_CLONE_CHECK_LINE } from "@/lib/ai/voice-lines";
import type { StudioVoice } from "@/lib/types";

const ARK_BASE = "https://ark.cn-beijing.volces.com/api/v3";
const SPEECH_TTS_URL =
  "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const PREVIEW_LINE =
  "今天这条，我用大白话讲。别端着，就像跟朋友吃饭时聊到的那样。";
const PREVIEW_VERSION = "v6";
const TTS_SPEED = 1.24;

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

const execFileAsync = promisify(execFile);

const NATURAL =
  "说自然普通话，像抖音短视频口播，语速快，句子短，有轻重但不拖腔，像跟人聊天。近、实、齿音清楚，音量够，不要虚、不要气声、不要远处喊。不要播音腔，不要匀速念稿，不要英文腔。";

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

export function listTtsVoices(workspaceId?: string): TtsVoiceOption[] {
  const catalog = ARK_TTS_VOICES.map(({ id, label, hint, group }) => ({
    id,
    label,
    hint,
    group,
  }));
  if (!workspaceId) return catalog;
  const mine = listStudioVoices(workspaceId).map((row) => ({
    id: row.provider_voice_id || row.id,
    label: row.name || "我的音色",
    hint: row.hint || "自己克隆的",
    group: CUSTOM_VOICE_GROUP,
  }));
  return [...mine, ...catalog];
}

export function listTtsSpeechModels(): Array<{
  id: string;
  label: string;
  hint: string;
  ready: boolean;
}> {
  const ark = Boolean(resolveSpeechTtsConfig() || resolveArkConfig());
  const openai = Boolean(resolveOpenAiTtsConfig());
  return TTS_SPEECH_MODELS.map((row) => ({
    id: row.id,
    label: row.label,
    hint: row.hint,
    ready: row.provider === "ark" ? ark : openai,
  }));
}

export function resolveTtsVoice(id?: string): string {
  const raw = id?.trim() || "";
  if (isCustomVoiceId(raw)) return raw;
  if (ARK_TTS_VOICES.some((row) => row.id === raw)) return raw;
  if (getStudioVoiceByProviderId(raw)) return raw;
  return voiceRow(id).id;
}

function openaiVoiceFor(id?: string): string {
  return voiceRow(id).openaiVoice;
}

function styleFor(id?: string): string {
  return voiceRow(id).style;
}

function resolveSpeechTtsConfig(): { apiKey: string } | null {
  const apiKey = (
    process.env.DOUBAO_TTS_API_KEY ||
    process.env.ARK_TTS_API_KEY ||
    process.env.DOUBAO_SPEECH_API_KEY ||
    ""
  ).trim();
  return apiKey ? { apiKey } : null;
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
  return (
    resolveSpeechTtsConfig() !== null ||
    resolveOpenAiTtsConfig() !== null ||
    resolveArkConfig() !== null ||
    Boolean(process.env.DASHSCOPE_API_KEY?.trim() || process.env.QWEN_API_KEY?.trim())
  );
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
  if (/resource not granted|requested resource not granted|45000030/i.test(raw)) {
    return "豆包语音合成还没授权给这个 Key。到语音技术控制台开通 2.0 字符版。";
  }
  if (/Invalid X-Api-Key|app key not found|45000010/i.test(raw)) {
    return "语音技术 Key 无效。";
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

function splitJsonObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

function audioFromSpeechJson(parsed: Record<string, unknown>): Buffer | null {
  const header =
    parsed.header && typeof parsed.header === "object"
      ? (parsed.header as Record<string, unknown>)
      : null;
  const code = Number(header?.code ?? parsed.code ?? 0);
  const message = String(header?.message ?? parsed.message ?? "");
  if (code && code !== 0 && code !== 20000000 && code !== 3000) {
    throw new Error(explainTtsError(message || JSON.stringify(parsed), 403));
  }
  const data = parsed.data;
  if (typeof data === "string" && data.length > 32) {
    return Buffer.from(data, "base64");
  }
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    const audio = rec.audio || rec.audio_data;
    if (typeof audio === "string" && audio.length > 32) {
      return Buffer.from(audio, "base64");
    }
  }
  return null;
}

function parseOpenspeechAudio(buf: Buffer, contentType: string): Buffer {
  if (looksLikeAudio(buf, contentType)) return buf;
  const text = buf.toString("utf8").trim();
  if (!text) throw new Error("配音没有返回音频");
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const clip = audioFromSpeechJson(parsed);
    if (clip) return clip;
  } catch (err) {
    if (err instanceof Error && /配音|开通|授权|欠费|Key/.test(err.message)) {
      throw err;
    }
  }
  const blobs = text.includes("\n")
    ? text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : splitJsonObjects(text);
  const chunks: Buffer[] = [];
  for (const blob of blobs.length ? blobs : [text]) {
    try {
      const parsed = JSON.parse(blob) as Record<string, unknown>;
      const clip = audioFromSpeechJson(parsed);
      if (clip) chunks.push(clip);
    } catch (err) {
      if (err instanceof Error && /配音|开通|授权|欠费|Key/.test(err.message)) {
        throw err;
      }
    }
  }
  if (!chunks.length) {
    throw new Error(explainTtsError(text.slice(0, 240), 502));
  }
  return Buffer.concat(chunks);
}

function speechResourceId(voice: string): string {
  return ttsVoiceGeneration(voice) === "1" ? "seed-tts-1.0" : "seed-tts-2.0";
}

async function synthesizeViaOpenspeech(
  text: string,
  voiceId: string,
  opts?: SpeechOpts,
): Promise<Buffer> {
  const config = resolveSpeechTtsConfig();
  if (!config) throw new Error("还没配语音技术 Key。");
  const voice = resolveTtsVoice(
    opts?.acting ? actingVoiceId(voiceId) : voiceId,
  );
  const speed = opts?.speed && opts.speed > 0 ? opts.speed : TTS_SPEED;
  const tone = String(opts?.tone || "").trim();
  const picked = resolveTtsSpeechModel(opts?.ttsModel);
  const expressive =
    picked === "seed-tts-2.0-expressive" ||
    Boolean(opts?.acting) ||
    Boolean(opts?.expressive);
  const additions: Record<string, unknown> = {};
  if (tone) additions.context_texts = [tone];
  if (expressive) {
    additions.use_tag_parser = true;
    additions.model = "seed-tts-2.0-expressive";
  }
  const reqParams: Record<string, unknown> = {
    text: text.slice(0, 4000),
    speaker: voice,
    audio_params: { format: "mp3", sample_rate: 24000 },
    speed_ratio: speed,
  };
  if (Object.keys(additions).length) {
    reqParams.additions = JSON.stringify(additions);
  }
  const res = await fetch(SPEECH_TTS_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Api-Key": config.apiKey,
      "X-Api-Resource-Id": speechResourceId(voice),
    },
    body: JSON.stringify({
      user: { uid: "dianwu-geo" },
      req_params: reqParams,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const contentType = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    throw new Error(explainTtsError(buf.toString("utf8"), res.status));
  }
  return parseOpenspeechAudio(buf, contentType);
}

let cachedOpenAiModel: string | undefined;

function speechInstructions(
  voiceId: string,
  tone?: string,
  acting?: boolean,
): string {
  const extra = String(tone || "").trim();
  if (acting) {
    return extra || "当面演戏，有轻重，语速快，像短剧对口，不要念稿，不要口播腔，不要匀速读。";
  }
  const style = styleFor(voiceId);
  return extra ? `${style}${extra}` : style;
}

type SpeechOpts = {
  tone?: string;
  speed?: number;
  acting?: boolean;
  /** 打开 2.0 表现力，不换音色、不走短剧演法 */
  expressive?: boolean;
  model?: string;
  ttsModel?: string;
};

async function synthesizeViaOpenAi(
  text: string,
  voiceId: string,
  opts?: SpeechOpts,
): Promise<Buffer> {
  const config = resolveOpenAiTtsConfig();
  if (!config) throw new Error("还没配 OPENAI_API_KEY，配音调不通。");
  const voice = openaiVoiceFor(voiceId);
  const speed = opts?.speed && opts.speed > 0 ? opts.speed : TTS_SPEED;
  const picked = resolveTtsSpeechModel(opts?.ttsModel);
  const models = [
    ttsSpeechModelMeta(picked).provider === "openai" ? picked : "",
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
        speed,
        ...(model.includes("gpt-4o")
          ? { instructions: speechInstructions(voiceId, opts?.tone, opts?.acting) }
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
  opts?: SpeechOpts,
): Promise<Buffer> {
  if (resolveSpeechTtsConfig()) {
    return synthesizeViaOpenspeech(text, voiceId, opts);
  }
  const config = resolveArkConfig();
  if (!config) throw new Error("还没配方舟。");
  const voice = resolveTtsVoice(
    opts?.acting ? actingVoiceId(voiceId) : voiceId,
  );
  const speed = opts?.speed && opts.speed > 0 ? opts.speed : TTS_SPEED;
  const tone = String(opts?.tone || "").trim();
  const spoken = text.slice(0, 4000);
  const picked = resolveTtsSpeechModel(opts?.ttsModel);
  const models = arkTtsModelsForVoice(voice, picked);
  const expressive =
    picked === "seed-tts-2.0-expressive" ||
    Boolean(opts?.acting) ||
    Boolean(opts?.expressive);
  let last = "方舟配音失败";
  for (const model of models) {
    const base = {
      model,
      input: spoken,
      voice,
      speaker: voice,
      response_format: "mp3",
      speed,
    };
    const instruct = tone || (opts?.acting ? "当面演戏，有轻重，不要念稿。" : "");
    const attempts: Record<string, unknown>[] = expressive
      ? [
          {
            ...base,
            instructions: instruct || "有轻重，像对谈，不要念稿。",
            extra: {
              context_texts: [instruct || "有轻重，像对谈，不要念稿"],
              additions: JSON.stringify({
                context_texts: [instruct || "有轻重，像对谈，不要念稿"],
                use_tag_parser: true,
                model: "seed-tts-2.0-expressive",
              }),
            },
          },
          {
            ...base,
            instructions: instruct || "有轻重，像对谈，不要念稿。",
          },
          base,
        ]
      : instruct
        ? [{ ...base, instructions: instruct }, base]
        : [base];
    for (const body of attempts) {
      try {
        return await postSpeech(`${config.baseUrl}/audio/speech`, config.apiKey, body);
      } catch (err) {
        last = err instanceof Error ? err.message : String(err);
      }
    }
  }
  throw new Error(last);
}

async function synthesizeSpeechBuffer(
  text: string,
  voiceId: string,
  opts?: SpeechOpts,
): Promise<Buffer> {
  const spoken = text.replace(/\s+/g, " ").trim();
  if (!spoken) throw new Error("没有可朗读的文字");
  const known = ARK_TTS_VOICES.some((row) => row.id === voiceId);
  if (!known) {
    const cloned = getStudioVoiceByProviderId(voiceId);
    if (cloned) return synthesizeClonedVoice(spoken, cloned);
    if (isCustomVoiceId(voiceId) || opts?.model) {
      return synthesizeClonedVoice(spoken, {
        provider_voice_id: voiceId,
        provider_model: opts?.model || "qwen3-tts-flash",
      } as StudioVoice);
    }
  }
  const errors: string[] = [];
  const preferOpenAi =
    ttsSpeechModelMeta(opts?.ttsModel).provider === "openai";
  const preferArk =
    !preferOpenAi && /bigtts|zh_|ICL_/i.test(voiceRow(voiceId).id);
  const tryArk = async () => {
    if (!resolveSpeechTtsConfig() && !resolveArkConfig()) return false;
    try {
      const buf = await synthesizeViaArk(spoken, voiceId, opts);
      return buf;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      return false;
    }
  };
  const tryOpenAi = async () => {
    if (!resolveOpenAiTtsConfig()) return false;
    try {
      const buf = await synthesizeViaOpenAi(spoken, voiceId, opts);
      return buf;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      return false;
    }
  };
  const first = preferArk ? await tryArk() : await tryOpenAi();
  if (first) return first;
  if (preferArk || preferOpenAi) {
    throw new Error(
      errors[0] ||
        (preferOpenAi ? "GPT 配音失败" : "方舟配音失败，这个音色不能换成别的声"),
    );
  }
  const second = await tryArk();
  if (second) return second;
  throw new Error(errors[0] || "还没配可用的配音接口");
}

function resolveFfmpeg(): string {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  for (const candidate of [
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "ffmpeg";
}

/** 参考音默认拉近、拉亮、拉齐，再喂给视频模型。 */
async function punchSpeechBuffer(buf: Buffer): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-tts-"));
  try {
    const src = path.join(dir, "in.mp3");
    const dest = path.join(dir, "out.mp3");
    fs.writeFileSync(src, buf);
    await execFileAsync(
      resolveFfmpeg(),
      [
        "-y",
        "-i",
        src,
        "-af",
        "highpass=f=80,equalizer=f=3200:t=q:w=1.1:g=3.5,loudnorm=I=-16:TP=-1.5:LRA=8",
        "-ar",
        "48000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        dest,
      ],
      { timeout: 30_000 },
    );
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 64) return buf;
    return fs.readFileSync(dest);
  } catch {
    return buf;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function persistSpeech(buf: Buffer, mime: string): Promise<string> {
  const ext = /wav/i.test(mime) ? ".wav" : ".mp3";
  const name = `${randomUUID()}${ext}`;
  return persistPublicAsset({
    bytes: buf,
    filename: name,
    contentType: mime || (ext === ".wav" ? "audio/wav" : "audio/mpeg"),
    label: "配音",
  });
}

export async function previewVoice(
  voiceId?: string,
  opts?: {
    model?: string;
    ttsModel?: string;
    tone?: string;
    expressive?: boolean;
  },
): Promise<{ buffer: Buffer; filename: string }> {
  const voice = resolveTtsVoice(voiceId);
  const cloned =
    Boolean(getStudioVoiceByProviderId(voice)) ||
    isCustomVoiceId(voice) ||
    Boolean(opts?.model);
  const ttsModel = resolveTtsSpeechModel(opts?.ttsModel);
  const tone = String(opts?.tone || "").trim();
  const line = cloned ? VOICE_CLONE_CHECK_LINE : PREVIEW_LINE;
  const tag = `${ttsModel}${tone ? `-t${tone.length}` : ""}`.replace(
    /[^a-zA-Z0-9._-]/g,
    "_",
  );
  const filename = `tts-preview-${PREVIEW_VERSION}-${cloned ? "clone-" : ""}${tag}-${voice.replace(/[^a-zA-Z0-9_]/g, "_")}.mp3`;
  if (!cloned && !tone && !isCloudflareRuntime()) {
    ensureDataDirs();
    const file = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(file) && fs.statSync(file).size > 64) {
      return { buffer: fs.readFileSync(file), filename };
    }
  }
  const buffer = await synthesizeSpeechBuffer(line, voice, {
    model: opts?.model,
    ttsModel,
    tone: tone || undefined,
    acting: false,
    expressive: Boolean(opts?.expressive),
    speed: 1,
  });
  if (!cloned && !tone && !isCloudflareRuntime()) {
    ensureDataDirs();
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  }
  return { buffer, filename };
}

export async function publishSpeechBuffer(buffer: Buffer): Promise<SpeechClip> {
  const url = await persistSpeech(buffer, "audio/mpeg");
  if (!url) {
    throw new Error(
      "配音没有传到公网图床，2.0 拿不到参考音。检查 PUBLIC_MEDIA_TOKEN。",
    );
  }
  return { buffer, url };
}

export async function synthesizeSpeechOrThrow(
  text: string,
  voiceId?: string,
  opts?: {
    requirePublicUrl?: boolean;
    tone?: string;
    speed?: number;
    acting?: boolean;
    expressive?: boolean;
    punch?: boolean;
    ttsModel?: string;
    persist?: boolean;
  },
): Promise<SpeechClip> {
  const spoken = text.replace(/\s+/g, " ").trim();
  if (!spoken) throw new Error("没有可朗读的口播，先把旁白写上");
  const raw = await synthesizeSpeechBuffer(spoken, resolveTtsVoice(voiceId), {
    tone: opts?.tone,
    speed: opts?.speed,
    acting: opts?.acting,
    expressive: opts?.expressive,
    ttsModel: opts?.ttsModel,
  });
  const buffer =
    opts?.punch === false || opts?.acting
      ? raw
      : await punchSpeechBuffer(raw);
  if (opts?.requirePublicUrl) return publishSpeechBuffer(buffer);
  if (opts?.persist === false) return { buffer };
  try {
    const url = await persistSpeech(buffer, "audio/mpeg");
    return { buffer, url };
  } catch {
    return { buffer, url: undefined };
  }
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
