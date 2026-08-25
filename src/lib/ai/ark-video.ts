import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { randomUUID } from "crypto";
import {
  publishSpeechBuffer,
  synthesizeSpeechOrThrow,
  type SpeechClip,
} from "@/lib/ai/ark-tts";
import { readAudioDurationSec } from "@/lib/ai/shot-speech";
import {
  directSpeechPerformance,
  emotionFaceLine,
  isLectureAskLine,
  normalizeShotBeat,
  shotSpeakerLockLine,
  actingSpeechText,
  inferSoundRole,
  shotSpeaksFromStart,
  innerNativeVoiceLine,
  innerSpeechSpeed,
  innerSpeechTone,
  SPEECH_CHARS_PER_SEC,
  speechActLine,
  speechActSpeed,
  spokenForPlay,
  speechToneLine,
  speechToneSpeed,
} from "@/lib/ai/emotion-beat";
import { parseStanceCards } from "@/lib/ai/stance-card";
import {
  cameraScheduleLine,
  inferShotCamera,
  manhuaVideoStyle,
  inferShotJoin,
  sceneCutsAway,
} from "@/lib/ai/manhua-look";
import { negativeShotLines, positiveShotLines } from "@/lib/ai/shot-constraints";
import { inferShotPlate } from "@/lib/ai/shot-plate";
import { defaultRenderVoicePath, isShowStyle } from "@/lib/ai/video-script-styles";
import {
  actingVoiceId,
  lockEpisodeVoices,
  resolveShotVoiceId,
} from "@/lib/ai/tts-voice-ids";
import { resolveDoubaoEnvConfig } from "@/lib/ai/doubao";
import { getDoubaoStoredSecret } from "@/lib/db";
import { UPLOADS_DIR, ensureDataDirs } from "@/lib/paths";
import {
  persistPublicAsset,
  publishLocalCoverPath,
} from "@/lib/storage/public-media";
import { burnShotCaptions } from "@/lib/ai/video-captions";
import { mixComposeAudio } from "@/lib/ai/film-mix";
import { splitShotDialogue } from "@/lib/ai/video-script";
import { listCatalogVideoModels } from "@/lib/ai/model-catalog/legacy";
import { hasCloudflareAiReady } from "@/lib/ai/model-catalog/cloudflare-seed";
import {
  normalizeSpeakMode,
  resolveInnerVoice,
  resolveVoicePath,
  shotCanLipSync,
  shotNeedsLockedSpeech,
  type InnerVoiceLevel,
  shotEndUrl,
  shotHasKeyframes,
  shotInnerLevel,
  shotIsInner,
  shotRawClipUrl,
  shotStartUrl,
  type VideoShot,
  type VideoSpeakMode,
} from "@/lib/types";

const execFileAsync = promisify(execFile);
const DEFAULT_BASE = "https://ark.cn-beijing.volces.com/api/v3";

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

function resolveFfprobe(): string {
  const ffmpeg = resolveFfmpeg();
  const probe = ffmpeg.replace(/ffmpeg$/i, "ffprobe");
  if (probe !== ffmpeg && fs.existsSync(probe)) return probe;
  for (const candidate of [
    "/opt/homebrew/bin/ffprobe",
    "/usr/local/bin/ffprobe",
    "/usr/bin/ffprobe",
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "ffprobe";
}

export type ArkVideoPreset = {
  id: string;
  label: string;
  hint: string;
  model: string;
  resolution: "480p" | "720p" | "1080p";
  minSec: number;
  maxSec: number;
  generateAudio: boolean;
};

export type ArkVideoResolution = "480p" | "720p";

export type ArkVideoModelOption = {
  id: string;
  label: string;
  model: string;
  hint: string;
  generateAudio: boolean;
  resolutions: ArkVideoResolution[];
  maxSec: number;
  badges?: import("@/lib/ai/model-catalog/types").AiModelBadge[];
};

export const ARK_VIDEO_MODELS_FALLBACK: ArkVideoModelOption[] = [
  {
    id: "seedance-2-mini",
    label: "Seedance-2.0-mini",
    model: "doubao-seedance-2-0-mini-260615",
    hint: "模型直接出声。口型不准再点对口型",
    generateAudio: true,
    resolutions: ["480p", "720p"],
    maxSec: 15,
    badges: ["recommended"],
  },
  {
    id: "seedance-2-fast",
    label: "Seedance-2.0-fast",
    model: "doubao-seedance-2-0-fast-260128",
    hint: "比 mini 更清，须先开通",
    generateAudio: true,
    resolutions: ["480p", "720p"],
    maxSec: 15,
  },
  {
    id: "seedance-2-0",
    label: "Seedance-2.0",
    model: "doubao-seedance-2-0-260128",
    hint: "标准档，画质比 mini/fast 稳，须先开通",
    generateAudio: true,
    resolutions: ["480p", "720p"],
    maxSec: 15,
  },
  {
    id: "seedance-2-5",
    label: "Seedance-2.5",
    model: "doubao-seedance-2-5-260628",
    hint: "指令更稳，单镜可到 30 秒，须先开通",
    generateAudio: true,
    resolutions: ["480p", "720p"],
    maxSec: 30,
  },
];

function makePreset(
  model: ArkVideoModelOption,
  resolution: ArkVideoResolution,
): ArkVideoPreset {
  return {
    id: `${model.id}-${resolution === "720p" ? "720" : "480"}`,
    label: `${model.label} · ${resolution}`,
    hint: model.hint,
    model: model.model,
    resolution,
    minSec: 4,
    maxSec: model.maxSec,
    generateAudio: model.generateAudio,
  };
}

/** @deprecated 使用 listArkVideoModels() */
export const ARK_VIDEO_MODELS = ARK_VIDEO_MODELS_FALLBACK;

function arkVideoModelList(): ArkVideoModelOption[] {
  const fromCatalog = listCatalogVideoModels();
  return fromCatalog.length ? fromCatalog : ARK_VIDEO_MODELS_FALLBACK;
}

function buildArkVideoPresets(models: ArkVideoModelOption[]): ArkVideoPreset[] {
  return models.flatMap((model) =>
    model.resolutions.map((res) => makePreset(model, res)),
  );
}

function arkVideoPresetList(): ArkVideoPreset[] {
  return buildArkVideoPresets(arkVideoModelList());
}

export const ARK_VIDEO_PRESETS: ArkVideoPreset[] = buildArkVideoPresets(
  ARK_VIDEO_MODELS_FALLBACK,
);

export const DEFAULT_ARK_VIDEO_PRESET = "seedance-2-mini-480";

export function listArkVideoModels(): ArkVideoModelOption[] {
  return arkVideoModelList();
}

export function composeArkPresetId(
  modelId: string,
  resolution: ArkVideoResolution,
): string {
  const models = arkVideoModelList();
  const model = models.find((m) => m.id === modelId) || models[0];
  const res = model.resolutions.includes(resolution) ? resolution : model.resolutions[0];
  return `${model.id}-${res === "720p" ? "720" : "480"}`;
}

export function parseArkPresetId(id?: string): {
  modelId: string;
  resolution: ArkVideoResolution;
} {
  const raw = (id || DEFAULT_ARK_VIDEO_PRESET).trim();
  const resolution: ArkVideoResolution = /720/.test(raw) ? "720p" : "480p";
  const models = arkVideoModelList();
  const modelId =
    models
      .slice()
      .sort((a, b) => b.id.length - a.id.length)
      .find((m) => raw === m.id || raw.startsWith(`${m.id}-`))?.id ||
    models[0].id;
  return { modelId, resolution };
}

export function listArkVideoPresets(): Array<
  Pick<ArkVideoPreset, "id" | "label" | "hint" | "resolution" | "generateAudio" | "model">
> {
  return arkVideoPresetList().map((p) => ({
    id: p.id,
    model: p.model,
    label: `${p.label}`,
    hint: p.hint,
    resolution: p.resolution,
    generateAudio: p.generateAudio,
  }));
}

export function resolveArkVideoPreset(id?: string): ArkVideoPreset {
  const presets = arkVideoPresetList();
  const { modelId, resolution } = parseArkPresetId(id);
  return (
    presets.find((p) => p.id === id) ||
    presets.find((p) => p.id === composeArkPresetId(modelId, resolution)) ||
    presets[0]
  );
}

export type ArkVideoConfig = {
  apiKey: string;
  baseUrl: string;
};

function normalizeArkBase(raw: string): string {
  let base = raw.replace(/\/$/, "");
  if (base.endsWith("/chat/completions")) {
    base = base.replace(/\/chat\/completions$/, "");
  }
  if (!/\/api\/v3$/i.test(base)) {
    base = `${base}/api/v3`;
  }
  return base;
}

export function resolveArkVideoConfig(): ArkVideoConfig | null {
  const env = resolveDoubaoEnvConfig();
  const stored = getDoubaoStoredSecret();
  const apiKey = env?.apiKey || stored.apiKey;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: env?.baseUrl || normalizeArkBase(DEFAULT_BASE),
  };
}

export type ArkModelOpenStatus = "open" | "closed" | "unknown";

const modelOpenCache = new Map<
  string,
  { at: number; status: ArkModelOpenStatus }
>();

export async function probeArkVideoModelOpen(
  model: string,
): Promise<ArkModelOpenStatus> {
  const hit = modelOpenCache.get(model);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.status;
  const config = resolveArkVideoConfig();
  if (!config) return "unknown";
  let status: ArkModelOpenStatus = "unknown";
  try {
    await arkJson(
      config,
      "POST",
      "/contents/generations/tasks",
      {
        model,
        content: [{ type: "text", text: "probe" }],
        resolution: "480p",
        duration: 1,
        watermark: false,
      },
      8_000,
      model,
    );
    status = "open";
  } catch (err) {
    const raw =
      (err instanceof Error && "arkRaw" in err
        ? String((err as { arkRaw?: string }).arkRaw || "")
        : "") + (err instanceof Error ? err.message : String(err));
    if (/has not activated|not activated|ModelNotOpen|未开通/i.test(raw)) {
      status = "closed";
    } else if (/AccountOverdue|overdue|欠费/i.test(raw)) {
      status = "unknown";
    } else {
      status = "open";
    }
  }
  modelOpenCache.set(model, { at: Date.now(), status });
  return status;
}

export async function listArkVideoModelsWithOpen(): Promise<
  Array<ArkVideoModelOption & { open?: ArkModelOpenStatus }>
> {
  const rows = await Promise.all(
    arkVideoModelList().map(async (model) => {
      if (!/doubao-seedance|^ep-/i.test(model.model)) return model;
      if (model.id !== "seedance-2-5") return model;
      const open = await probeArkVideoModelOpen(model.model);
      return {
        ...model,
        open,
        hint:
          open === "closed"
            ? `${model.hint}（未开通）`
            : model.hint,
      };
    }),
  );
  return rows;
}

function isRealPersonBlock(message: string): boolean {
  return /real person|真实人物|真人(人脸|照片)?|InputImageSensitiveContentDetected\.PrivacyInformation/i.test(
    message,
  );
}

function explainRealPersonBlock(
  message: string,
  extra?: { shot?: number; start?: string; end?: string },
): string {
  const shot = extra?.shot ? `第 ${extra.shot} 镜` : "这一镜";
  const frames = [
    extra?.start ? `开头 ${extra.start}` : "",
    extra?.end ? `结尾 ${extra.end}` : "",
  ]
    .filter(Boolean)
    .join("；");
  return [
    `${shot}被方舟预检拦住：输入图可能含真人。`,
    frames ? `投喂的是本镜头尾：${frames}` : "",
    `方舟原文：${message.replace(/\s+/g, " ").trim().slice(0, 220)}`,
  ]
    .filter(Boolean)
    .join("");
}

function explainArkVideoError(message: string, modelHint?: string): string {
  if (/AccountOverdueError|overdue|欠费/i.test(message)) {
    return "火山引擎账号欠费，视频生成调不通。先到费用中心充值。";
  }
  if (/has not activated|not activated|ModelNotOpen|未开通/i.test(message)) {
    const name = modelHint || "这个 Seedance 模型";
    return `这个方舟账号还没开通 ${name}。到开通管理打开后再出片。`;
  }
  if (isRealPersonBlock(message)) {
    return explainRealPersonBlock(message);
  }
  if (/InvalidEndpointOrModel|NotFound|does not exist/i.test(message)) {
    return "方舟找不到这个视频模型。确认已开通 Seedance，或换一个档位再试。";
  }
  if (/ratio specified|output ratio follows the first-frame|ratio.*not valid/i.test(message)) {
    return "首尾帧出片时画幅跟第一帧走，不能再指定 9:16。再出一次即可。";
  }
  if (/last frame|first frame|cannot be mixed|reference image|draft_task/i.test(message)) {
    return "这一镜出片参数冲突。对口型时不能同时喂首尾帧和参考音频，已改成用头尾两张参考图对口型。再出一次即可。";
  }
  if (/image_url.*not valid|invalid.*image_url|content\[\d+\]\.image_url/i.test(message)) {
    return "方舟拉不到这张静帧。需要公网 https 图链，本地地址或素材库假链都会被拒。";
  }
  return message;
}

function isSeedanceImageUrl(url: string): boolean {
  return /^https:\/\//i.test(url.trim()) && !/127\.0\.0\.1|localhost/i.test(url);
}

type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string };
      role?: "first_frame" | "last_frame" | "reference_image";
    }
  | {
      type: "audio_url";
      audio_url: { url: string };
      role?: "reference_audio";
    };

async function arkJson<T>(
  config: ArkVideoConfig,
  method: string,
  pathname: string,
  body?: unknown,
  timeoutMs = 60_000,
  modelHint?: string,
): Promise<T> {
  const res = await fetch(`${config.baseUrl}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text();
  let json: T & { error?: { message?: string }; message?: string };
  try {
    json = JSON.parse(raw) as T & {
      error?: { message?: string };
      message?: string;
    };
  } catch {
    throw new Error(`方舟视频接口 ${res.status}: ${raw.slice(0, 240)}`);
  }
  if (!res.ok) {
    const raw =
      json.error?.message || json.message || `方舟视频接口 ${res.status}`;
    const err = new Error(explainArkVideoError(raw, modelHint)) as Error & {
      arkRaw?: string;
    };
    err.arkRaw = raw;
    if (isRealPersonBlock(raw)) err.name = "RealPersonBlock";
    throw err;
  }
  return json;
}

function contentLocksRatioToFrame(content: ContentPart[]): boolean {
  return content.some(
    (part) =>
      part.type === "image_url" &&
      (part.role === "first_frame" || part.role === "last_frame"),
  );
}

function isCloudflareVideoModel(model: string): boolean {
  const id = model.trim();
  if (!id) return false;
  if (/^(doubao-|ep-)/i.test(id)) return false;
  return id.includes("/") || /^@(cf|hf)\//i.test(id);
}

async function runProviderClip(
  config: ArkVideoConfig | null,
  preset: ArkVideoPreset,
  content: ContentPart[],
  duration: number,
  onTick?: (info: { status: string; elapsedSec: number }) => void | Promise<void>,
): Promise<string> {
  if (isCloudflareVideoModel(preset.model)) {
    const { generateCloudflareVideo } = await import("@/lib/ai/cloudflare-ai");
    const prompt = content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .slice(0, 2500);
    const image = content.find(
      (part): part is Extract<ContentPart, { type: "image_url" }> =>
        part.type === "image_url",
    );
    await onTick?.({ status: "running", elapsedSec: 0 });
    return generateCloudflareVideo({
      model: preset.model,
      prompt: prompt || "cinematic shot",
      duration,
      ratio: "9:16",
      resolution: preset.resolution === "720p" ? "720P" : "480P",
      imageUrl: image?.image_url.url,
    });
  }
  if (!config) {
    throw new Error(
      "还没配方舟。在查排名页填入火山方舟 API Key，或在 .env.local 设置 ARK_API_KEY",
    );
  }
  const taskId = await createTask(config, preset, content, duration);
  return waitForVideo(config, taskId, onTick, duration, preset.label);
}

async function createTask(
  config: ArkVideoConfig,
  preset: ArkVideoPreset,
  content: ContentPart[],
  duration: number,
): Promise<string> {
  const frameLocked = contentLocksRatioToFrame(content);
  const json = await arkJson<{ id?: string }>(
    config,
    "POST",
    "/contents/generations/tasks",
    {
      model: preset.model,
      content,
      resolution: preset.resolution,
      ...(frameLocked ? {} : { ratio: "9:16" }),
      duration,
      watermark: false,
      ...(preset.model.includes("seedance-2")
        ? { generate_audio: preset.generateAudio }
        : { camera_fixed: false }),
    },
    60_000,
    preset.label,
  );
  if (!json.id) throw new Error("方舟没有返回任务 ID");
  return json.id;
}

function arkWaitLabel(status: string): string {
  if (/queue|pending|waiting/i.test(status)) return "排队中";
  if (/run|process|generat/i.test(status)) return "生成中";
  return "生成中";
}

export type VideoGenProgress = {
  index: number;
  total: number;
  done: number;
  message: string;
  shot?: VideoShot;
};

function waitLimitMs(durationSec?: number): number {
  const dur = Math.max(4, Number(durationSec) || 15);
  return Math.max(180_000, dur * 20_000);
}

async function waitForVideo(
  config: ArkVideoConfig,
  taskId: string,
  onTick?: (info: { status: string; elapsedSec: number }) => void | Promise<void>,
  durationSec?: number,
  modelHint?: string,
): Promise<string> {
  const started = Date.now();
  const limit = waitLimitMs(durationSec);
  while (Date.now() - started < limit) {
    const json = await arkJson<{
      status?: string;
      content?: { video_url?: string };
      error?: { message?: string };
    }>(
      config,
      "GET",
      `/contents/generations/tasks/${taskId}`,
      undefined,
      60_000,
      modelHint,
    );
    const status = (json.status || "").toLowerCase();
    if (status === "succeeded") {
      const url = json.content?.video_url?.trim();
      if (!url) throw new Error("方舟任务成功但没有视频地址");
      return url;
    }
    if (status === "failed" || status === "cancelled") {
      const raw = json.error?.message || "方舟视频任务失败";
      const err = new Error(explainArkVideoError(raw, modelHint)) as Error & {
        arkRaw?: string;
      };
      err.arkRaw = raw;
      if (isRealPersonBlock(raw)) err.name = "RealPersonBlock";
      throw err;
    }
    await onTick?.({
      status,
      elapsedSec: Math.round((Date.now() - started) / 1000),
    });
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("方舟出片超时，请再试一次");
}

async function downloadVideo(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`下载视频失败 ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function loadVideoBuffer(url: string): Promise<Buffer> {
  const raw = url.trim();
  const match = raw.match(/\/api\/uploads\/([^/?#]+)/i);
  if (match) {
    const name = decodeURIComponent(match[1]);
    if (name && !name.includes("..") && !name.includes("/")) {
      const file = path.join(UPLOADS_DIR, name);
      if (fs.existsSync(file)) return fs.readFileSync(file);
    }
  }
  const uuid = raw.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.mp4/i,
  );
  if (uuid) {
    const file = path.join(UPLOADS_DIR, `${uuid[1]}.mp4`);
    if (fs.existsSync(file)) return fs.readFileSync(file);
  }
  return downloadVideo(raw);
}

async function extractSpeechFromClip(clipUrl: string): Promise<SpeechClip> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-lip-"));
  try {
    const src = path.join(dir, "in.mp4");
    const dest = path.join(dir, "out.mp3");
    fs.writeFileSync(src, await loadVideoBuffer(clipUrl));
    await execFileAsync(
      resolveFfmpeg(),
      [
        "-y",
        "-i",
        src,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "libmp3lame",
        "-q:a",
        "4",
        dest,
      ],
      { timeout: 60_000 },
    );
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 64) {
      throw new Error("成片里没有可抽的声音");
    }
    return publishSpeechBuffer(fs.readFileSync(dest));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`抽成片声音失败：${message.slice(0, 120)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function probeClipOnsetSec(url: string): Promise<number | undefined> {
  try {
    const buf = await loadVideoBuffer(url);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-onset-"));
    const file = path.join(dir, "clip.mp4");
    try {
      fs.writeFileSync(file, buf);
      const duration = await probeMediaDuration(file);
      return detectSpeechSpan(await readClipRms(file), duration).head;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    return undefined;
  }
}

export async function persistMp4(buf: Buffer): Promise<string> {
  const name = `${randomUUID()}.mp4`;
  return persistPublicAsset({
    bytes: buf,
    filename: name,
    contentType: "video/mp4",
    label: "视频",
  });
}

const STITCH_W = 720;
const STITCH_H = 1280;
const STITCH_FPS = 24;
const EDGE_FADE = 0.008;
const RMS_HOP_MS = 50;
/** 对白前多留一点，避免把「臣」「大人」这种字头切掉 */
const SPEECH_PAD = 0.4;

async function probeMediaDuration(file: string): Promise<number> {
  const { stdout } = await execFileAsync(
    resolveFfprobe(),
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ],
    { timeout: 20_000 },
  );
  const n = Number(String(stdout).trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function readClipRms(file: string): Promise<number[]> {
  const wav = `${file}.span.wav`;
  try {
    await execFileAsync(
      resolveFfmpeg(),
      ["-y", "-i", file, "-ac", "1", "-ar", "8000", "-f", "wav", wav],
      { timeout: 30_000 },
    );
    const buf = fs.readFileSync(wav);
    const pcm = buf.subarray(44);
    const win = 400;
    const rms: number[] = [];
    for (let i = 0; i + win * 2 <= pcm.length; i += win * 2) {
      let sum = 0;
      for (let j = 0; j < win; j += 1) {
        const s = pcm.readInt16LE(i + j * 2);
        sum += s * s;
      }
      rms.push(Math.sqrt(sum / win));
    }
    return rms;
  } catch {
    return [];
  } finally {
    if (fs.existsSync(wav)) fs.unlinkSync(wav);
  }
}

function detectSpeechSpan(
  rms: number[],
  duration: number,
): { head: number; tail: number } {
  if (rms.length < 8 || duration <= 0) return { head: 0, tail: 0 };
  const midSlice = rms.slice(
    Math.floor(rms.length / 4),
    Math.max(Math.floor(rms.length / 4) + 1, Math.floor((rms.length * 3) / 4)),
  );
  const mid =
    [...midSlice].sort((a, b) => a - b)[Math.floor(midSlice.length / 2)] || 0;
  const speech = Math.max(360, mid * 0.26);
  const regions: Array<{ start: number; end: number; dur: number }> = [];
  for (let i = 0; i < rms.length; ) {
    if (rms[i] <= speech) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < rms.length && rms[j] > speech) j += 1;
    regions.push({
      start: i,
      end: j,
      dur: ((j - i) * RMS_HOP_MS) / 1000,
    });
    i = j;
  }
  const voiced = regions.filter((row) => row.dur >= 0.12);
  if (!voiced.length) return { head: 0, tail: 0 };
  let first = voiced[0];
  // 只丢掉极短开场音效。「大人，」这种短称呼后面常有停顿，不能当撞击切掉。
  if (voiced.length >= 2) {
    const gap = ((voiced[1].start - first.end) * RMS_HOP_MS) / 1000;
    if (first.dur < 0.18 && gap > 0.8) first = voiced[1];
  }
  const last =
    [...voiced].reverse().find((row) => row.dur >= 0.18) ||
    voiced[voiced.length - 1];
  let head = Math.max(0, (first.start * RMS_HOP_MS) / 1000 - SPEECH_PAD);
  let tail = ((rms.length - last.end) * RMS_HOP_MS) / 1000;
  if (head < 0.08) head = 0;
  if (tail < 0.1) tail = 0;
  head = Math.min(1.8, head);
  tail = Math.min(0.45, tail);
  if (duration - head - tail < 1.6) {
    const overflow = 1.6 - (duration - head - tail);
    tail = Math.max(0, tail - overflow);
    if (duration - head - tail < 1.6) head = Math.max(0, duration - tail - 1.6);
  }
  return { head, tail };
}

async function trimToSpeech(
  src: string,
  dest: string,
  opts?: { keepHead?: boolean; maxSec?: number },
): Promise<string> {
  const duration = await probeMediaDuration(src);
  const span = detectSpeechSpan(await readClipRms(src), duration);
  const head = opts?.keepHead ? 0 : span.head;
  const speechTail =
    opts?.maxSec && opts.maxSec > 0 && duration - head > opts.maxSec
      ? duration - head - opts.maxSec
      : 0;
  const tail = Math.max(span.tail, speechTail);
  if (head <= 0 && tail <= 0) return src;
  const keep = Math.max(1.6, duration - head - tail);
  await execFileAsync(
    resolveFfmpeg(),
    [
      "-y",
      "-i",
      src,
      "-ss",
      head.toFixed(3),
      "-t",
      keep.toFixed(3),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      dest,
    ],
    { timeout: 60_000 },
  );
  return dest;
}

async function normalizeClip(input: {
  src: string;
  dest: string;
  keepAudio: boolean;
  trimStart: boolean;
  fadeIn: boolean;
  fadeOut: boolean;
}): Promise<void> {
  const start = input.trimStart ? 2 / STITCH_FPS : 0;
  const vf = [
    start > 0 ? `trim=start=${start.toFixed(3)},setpts=PTS-STARTPTS` : "",
    `scale=${STITCH_W}:${STITCH_H}:force_original_aspect_ratio=decrease`,
    `pad=${STITCH_W}:${STITCH_H}:(ow-iw)/2:(oh-ih)/2`,
    `fps=${STITCH_FPS}`,
    "format=yuv420p",
    "setsar=1",
  ]
    .filter(Boolean)
    .join(",");
  const args = ["-y", "-i", input.src, "-vf", vf, "-r", String(STITCH_FPS)];
  if (input.keepAudio) {
    const af = [
      start > 0 ? `atrim=start=${start.toFixed(3)},asetpts=PTS-STARTPTS` : "",
      "aresample=48000",
      "aformat=sample_fmts=fltp:channel_layouts=stereo",
      "loudnorm=I=-16:TP=-1.5:LRA=11",
    ].filter(Boolean);
    if (input.fadeIn) af.push(`afade=t=in:st=0:d=${EDGE_FADE}`);
    if (input.fadeOut) {
      const dur = await probeMediaDuration(input.src);
      const outAt = Math.max(0, dur - start - EDGE_FADE);
      af.push(`afade=t=out:st=${outAt.toFixed(3)}:d=${EDGE_FADE}`);
    }
    args.push("-af", af.join(","), "-c:a", "aac", "-ar", "48000", "-ac", "2");
  } else {
    args.push("-an");
  }
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    input.dest,
  );
  await execFileAsync(resolveFfmpeg(), args, { timeout: 120_000 });
}

async function persistJpeg(buf: Buffer): Promise<string> {
  const name = `${randomUUID()}.jpg`;
  return persistPublicAsset({
    bytes: buf,
    filename: name,
    contentType: "image/jpeg",
    label: "帧图",
  });
}

async function lastFramePublicUrl(clipUrl: string): Promise<string | undefined> {
  const raw = clipUrl.trim();
  if (!raw) return undefined;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-frame-"));
  try {
    const src = path.join(dir, "in.mp4");
    const out = path.join(dir, "last.jpg");
    fs.writeFileSync(src, await loadVideoBuffer(raw));
    await execFileAsync(
      resolveFfmpeg(),
      ["-y", "-sseof", "-0.05", "-i", src, "-frames:v", "1", "-q:v", "2", out],
      { timeout: 30_000 },
    );
    if (!fs.existsSync(out)) return undefined;
    return publicHttpUrl(await persistJpeg(fs.readFileSync(out)));
  } catch {
    return undefined;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 只在临时副本上剪到对白、拉齐响度再硬切。原片文件一律不动。 */
export async function stitchShotClips(
  shots: VideoShot[],
): Promise<{ buffer: Buffer; durations: number[] }> {
  const clips: Buffer[] = [];
  for (const shot of shots) {
    const url = shotRawClipUrl(shot);
    if (!url) throw new Error("还有分镜没有出片，先按镜出完再编辑");
    clips.push(await loadVideoBuffer(url));
  }
  return stitchMp4(clips, true);
}

async function stitchMp4(
  clips: Buffer[],
  keepAudio: boolean,
  speechCaps?: Array<number | undefined>,
): Promise<{ buffer: Buffer; durations: number[] }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-video-"));
  try {
    const parts: string[] = [];
    const durations: number[] = [];
    for (const [i, clip] of clips.entries()) {
      const raw = path.join(dir, `${String(i).padStart(2, "0")}-raw.mp4`);
      const spoken = path.join(dir, `${String(i).padStart(2, "0")}-speak.mp4`);
      const norm = path.join(dir, `${String(i).padStart(2, "0")}.mp4`);
      fs.writeFileSync(raw, clip);
      const src = keepAudio
        ? await trimToSpeech(raw, spoken, {
            keepHead: i === 0,
            maxSec: speechCaps?.[i],
          })
        : raw;
      await normalizeClip({
        src,
        dest: norm,
        keepAudio,
        trimStart: !keepAudio && i > 0,
        fadeIn: keepAudio && i > 0,
        fadeOut: keepAudio && i < clips.length - 1,
      });
      parts.push(norm);
      durations.push(await probeMediaDuration(norm));
    }
    const out = path.join(dir, "out.mp4");
    if (parts.length === 1) {
      return { buffer: fs.readFileSync(parts[0]), durations };
    }
    const inputs = parts.flatMap((file) => ["-i", file]);
    const vchain = parts.map((_, i) => `[${i}:v]`).join("");
    const filters = keepAudio
      ? `${vchain}concat=n=${parts.length}:v=1:a=0[v];${parts
          .map((_, i) => `[${i}:a]`)
          .join("")}concat=n=${parts.length}:v=0:a=1[a]`
      : `${vchain}concat=n=${parts.length}:v=1:a=0[v]`;
    const mapped = keepAudio
      ? ["-map", "[v]", "-map", "[a]", "-c:a", "aac", "-ar", "48000"]
      : ["-map", "[v]", "-an"];
    await execFileAsync(
      resolveFfmpeg(),
      [
        "-y",
        ...inputs,
        "-filter_complex",
        filters,
        ...mapped,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "18",
        out,
      ],
      { timeout: 180_000 },
    );
    return { buffer: fs.readFileSync(out), durations };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`分镜拼接失败：${message.slice(0, 180)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function muxAudio(video: Buffer, audio: Buffer): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-mux-"));
  try {
    const v = path.join(dir, "v.mp4");
    const a = path.join(dir, "a.mp3");
    const out = path.join(dir, "out.mp4");
    fs.writeFileSync(v, video);
    fs.writeFileSync(a, audio);
    await execFileAsync(
      resolveFfmpeg(),
      [
        "-y",
        "-i",
        v,
        "-i",
        a,
        "-c:v",
        "copy",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-af",
        "loudnorm=I=-14:LRA=11:TP=-1.5,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-shortest",
        out,
      ],
      { timeout: 120_000 },
    );
    return fs.readFileSync(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`配音合成失败：${message.slice(0, 180)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function clampDuration(sec: number, preset: ArkVideoPreset): number {
  const n = Math.round(Number(sec) || preset.minSec);
  return Math.min(preset.maxSec, Math.max(preset.minSec, n));
}

async function loadSpeechBuffer(url: string): Promise<Buffer> {
  const raw = url.trim();
  const match = raw.match(/\/api\/uploads\/([^/?#]+)/i);
  if (match) {
    const name = decodeURIComponent(match[1]);
    if (name && !name.includes("..") && !name.includes("/")) {
      const file = path.join(UPLOADS_DIR, name);
      if (fs.existsSync(file)) return fs.readFileSync(file);
    }
  }
  const res = await fetch(raw, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`配音读不到 ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function speechCapForShot(shot: VideoShot): Promise<number | undefined> {
  const url = shot.speechUrl?.trim();
  if (!url) return undefined;
  try {
    return (await audioDurationSec(await loadSpeechBuffer(url))) + 0.35;
  } catch {
    return undefined;
  }
}

async function audioDurationSec(buf: Buffer): Promise<number> {
  const parsed = readAudioDurationSec(buf);
  if (parsed > 0.2) return parsed;
  throw new Error("读不出配音时长");
}

async function fitSpeechToDuration(
  speech: { buffer: Buffer; url?: string },
  duration: number,
): Promise<{ buffer: Buffer; url: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-fit-"));
  try {
    const src = path.join(dir, "in.mp3");
    const out = path.join(dir, "out.mp3");
    fs.writeFileSync(src, speech.buffer);
    await execFileAsync(
      resolveFfmpeg(),
      [
        "-y",
        "-i",
        src,
        "-af",
        `apad=pad_dur=${duration}`,
        "-t",
        String(duration),
        "-c:a",
        "libmp3lame",
        "-q:a",
        "4",
        out,
      ],
      { timeout: 30_000 },
    );
    const published = await publishSpeechBuffer(fs.readFileSync(out));
    if (!published.url) throw new Error("配音没有公网地址");
    return { buffer: published.buffer, url: published.url };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function spokenLineOf(voiceover: string): string {
  return spokenForPlay(voiceover);
}

function shotPrompt(input: {
  seriesTitle: string;
  episodeTitle: string;
  hook: string;
  shot: VideoShot;
  prevShot?: VideoShot;
  nextShot?: VideoShot;
  characterName?: string;
  preset: ArkVideoPreset;
  speakMode: VideoSpeakMode;
  durationSec: number;
  fromPrevFrame?: boolean;
  cutsAway?: boolean;
  refFrames?: boolean;
  nativeVoice?: boolean;
  inner?: boolean;
  innerLevel?: Exclude<InnerVoiceLevel, "off"> | "";
  lookStyle?: string | null;
  director?: import("@/lib/ai/director-lock").ShotAgentLock | null;
  talk?: boolean;
  /** 首尾帧出片时画幅跟第一帧走，提示词里不能再写 --ratio */
  frameLocked?: boolean;
}): string {
  const who = input.characterName?.trim();
  const line = spokenForPlay(input.shot.voiceover);
  const role = inferSoundRole(input.shot);
  const inner = Boolean(input.inner) || role === "inner";
  const speak = role === "speak" || (inner && Boolean(line));
  const hit = role === "hit";
  const first = !input.prevShot;
  const join = inferShotJoin(input.shot, input.prevShot);
  const continueSame = Boolean(input.fromPrevFrame && join === "continue");
  const hardCut = join === "cut";
  const beat = normalizeShotBeat(input.shot.beat);
  const coldVoice = beat === "顶" || beat === "停" || isLectureAskLine(line);
  const names = who
    ? who.split(/[、,，]/).map((n) => n.replace(/[「」]/g, "").trim()).filter(Boolean)
    : [];
  const castLine = names.length
    ? `出镜：${names.map((n, i) => `${i + 1}「${n}」`).join(" ")}。脸跟第一帧走，不要换人。`
    : "";
  const camera = inferShotCamera(input.shot.visual, input.shot.camera);
  const lines = [
    input.refFrames
      ? "图片1是这一镜开头，必须当作第一帧。图片2是这一镜结尾，必须当作最后一帧。只在这两帧之间往前演，不要另起构图。"
      : "第一帧和最后一帧已经锁死。只描述这两帧之间看得见的变化。",
    manhuaVideoStyle(input.lookStyle),
    castLine,
    continueSame
      ? "同场连拍：从上一镜结束帧接着演到本镜结束帧。不要重新起势。"
      : input.cutsAway || join === "away"
        ? "换场：从新场开头演到本镜结束。不要瞬移，不要另找一张静帧当第一帧。"
        : hardCut
          ? "硬切：第一帧已经是新构图。只在这两帧之间演，不要演回上一镜的构图，不要从上镜站位往前挪半步。"
        : first
          ? shotSpeaksFromStart(input.shot)
            ? "本集第一镜。第一帧嘴已经张开，第一帧就出声。不要先盯镜头酝酿，不要嘴角微动才开口。"
            : "本集第一镜，从定装开头演到本镜结束帧。"
          : "第一帧和最后一帧之间只往前演半步。同一场、同一套已定装的衣服。",
    cameraScheduleLine(camera),
    ...positiveShotLines({
      shot: input.shot,
      lookStyle: input.lookStyle,
      talk: Boolean(input.talk) || shotSpeaksFromStart(input.shot),
      first,
      durationSec: input.durationSec,
      phase: "video",
      plate: inferShotPlate(input.shot, input.lookStyle),
    }),
    `可见动作：${input.shot.visual || "人在场上，表情按这一镜的节拍来，不要讲解脸"}`,
    emotionFaceLine(input.shot.beat, input.shot.look, inner, {
      feel: input.director?.feel,
      hookHit: input.director?.hookHit,
      talk: Boolean(input.talk) || shotSpeaksFromStart(input.shot),
    }),
    shotSpeaksFromStart(input.shot)
      ? "第一帧就已经在说话。禁止先冷脸摆拍再开口。"
      : input.director?.hookHit && beat === "钩"
        ? `开场必须演到：${input.director.hookHit}。`
        : "",
    inner
      ? innerNativeVoiceLine({
          speaker: input.shot.speaker,
          voiceover: line,
          level: input.innerLevel,
        })
      : speak
        ? input.nativeVoice
          ? `${shotSpeakerLockLine({
              speaker: input.shot.speaker,
              voiceover: line,
            })} 按这句话自己演、自己出声。${speechActLine({
              beat: input.shot.beat,
              voiceover: line,
              talk: input.talk,
            })}${
              input.talk
                ? "语速快，像当面讲，不要匀速念稿。"
                : "语速快，像短剧对口，不要匀速念稿。"
            }嘴型必须跟上正在说的每一个字。不要播音，不要加开场白，不要把提示词念出声。${
              input.prevShot &&
              (input.prevShot.speaker || "") === (input.shot.speaker || "") &&
              (input.prevShot.speaker || "").trim()
                ? "必须和上一镜是同一条嗓子：同一音色、同一年龄、同一音高，不要换声线，不要换成旁白播音。"
                : input.talk
                  ? "这一集说话的人只用一条嗓子，后面各镜都要接这条声，不要每镜换人配音。"
                  : ""
            }`
          : `${shotSpeakerLockLine({
              speaker: input.shot.speaker,
              voiceover: line,
            })} ${speechToneLine({
              beat: input.shot.beat,
              voiceover: line,
              talk: input.talk,
            })}不要加开场白，不要复述上一镜，不要把提示词念出声。`
        : hit
          ? "这一镜不要说话，不要对口型。动作自己带一声实响：拍桌、摔帖或杯子顿住。不要BGM，不要配乐，不要念提示词。"
          : "这一镜不要说话，不要念提示词。画面里所有人闭嘴，靠脸、手、停顿。",
    input.refFrames && !inner
      ? coldVoice
        ? "Audio: close, dry, present. Cold and controlled. No hall reverb, no distant mix, no announcer punch, no whisper, no BGM."
        : "Audio: close-mic dialogue only. Fast short-drama pace, punchy, not even manuscript reading. Chest voice, clear consonants, full level, dry and present. No hall reverb, no distant mix, no muffled voice, no whisper, no BGM, no soundtrack. Match the reference audio's presence and punch — do not recast it as room tone."
      : "",
    input.refFrames && !inner
      ? coldVoice
        ? "声音只要近处对白。冷、短、有轻重，不要拖腔，不要播音，不要殿堂回声，不要背景音乐。口型必须对齐参考音频的每一个字，不要另说一句。"
        : "声音只要近讲对白。语速快，像短剧对口，不要匀速念稿。贴着嘴说，实、亮、有力，齿音清楚，音量拉满但不破。禁止殿堂回声、远距离、闷声、气声、背景音乐、配乐、BGM。口型必须对齐参考音频的每一个字，不要另说一句，音质也要跟上参考音，不要演成远处小声。"
      : inner
        ? "Audio: inner monologue VO only. Mouths stay shut. Close, dry, full level, no whisper, no announcer, no BGM. Speak only the inner line, then hold."
        : "",
    ...negativeShotLines(),
    input.frameLocked
      ? `--resolution ${input.preset.resolution} --dur ${input.durationSec} --watermark false`
      : `--resolution ${input.preset.resolution} --ratio 9:16 --dur ${input.durationSec} --watermark false`,
  ];
  return lines.filter(Boolean).join("\n");
}

function shotsOrFallback(input: {
  shots: VideoShot[];
  hook: string;
  voiceover: string;
  onScreen: string;
  durationSec: number;
  preset: ArkVideoPreset;
}): VideoShot[] {
  if (input.shots.length > 0) {
    return [...input.shots]
      .sort((a, b) => a.index - b.index)
      .map((shot, i) => ({
        ...shot,
        index: shot.index > 0 ? shot.index : i + 1,
        seconds: clampDuration(shot.seconds, input.preset),
      }));
  }
  const total = Math.min(90, Math.max(input.preset.minSec, input.durationSec || 90));
  const chunk = Math.min(input.preset.maxSec, 8);
  const count = Math.min(12, Math.max(1, Math.ceil(total / chunk)));
  const words = input.voiceover.replace(/\s+/g, " ").trim();
  const piece = Math.ceil(words.length / count) || 1;
  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    seconds: i === count - 1 ? clampDuration(total - chunk * (count - 1), input.preset) : chunk,
    visual:
      i === 0
        ? `前 3 秒抓住人：${input.hook || "对着镜头说话"}`
        : "讲解者面对镜头，手势自然，背景干净",
    onScreen: input.onScreen,
    voiceover: words.slice(i * piece, (i + 1) * piece),
    imagePrompt: "",
  }));
}

async function publicHttpUrl(raw?: string): Promise<string | undefined> {
  const src = raw?.trim();
  if (!src) return undefined;
  const published = await publishLocalCoverPath(src);
  if (
    published &&
    /^https?:\/\//i.test(published) &&
    !/127\.0\.0\.1|localhost/i.test(published)
  ) {
    return published;
  }
  if (/^https?:\/\//i.test(src) && !/127\.0\.0\.1|localhost/i.test(src)) {
    return src;
  }
  return undefined;
}

export async function generateArkEpisodeVideo(
  input: {
    seriesTitle: string;
    episodeNo: number;
    title: string;
    hook: string;
    voiceover: string;
    onScreen: string;
    durationSec: number;
    shots: VideoShot[];
    characterName?: string;
    characterAngles?: { id: string; label: string; url: string }[];
    presetId?: string;
    speakMode?: VideoSpeakMode;
    voiceId?: string;
    cast?: Array<{ id: string; name: string; voice_id?: string }>;
    stanceNotes?: string;
    force?: boolean;
    onlyIndexes?: number[];
    composeOnly?: boolean;
    voicePath?: "native" | "tts" | "lipsync";
    innerVoice?: "off" | "low" | "mid" | "high";
    lookStyle?: string | null;
    hookStyle?: string | null;
    director?: import("@/lib/ai/director-lock").ShotAgentLock | null;
    bedMusic?: boolean;
    bedSongUrl?: string;
  },
  onProgress?: (event: VideoGenProgress) => void | Promise<void>,
): Promise<{
  url: string | null;
  sourceUrl?: string | null;
  subtitleUrl?: string | null;
  captionCues?: { captions: { start: number; end: number; line: string }[]; flowers: { start: number; end: number; line: string }[] };
  model: string;
  shots: VideoShot[];
  composed: boolean;
}> {
  const speakMode = normalizeSpeakMode(input.speakMode);
  const talk = !isShowStyle(input.hookStyle);
  const voicePath = input.voicePath
    ? resolveVoicePath(input.voicePath)
    : defaultRenderVoicePath(input.hookStyle);
  const seriesInner = resolveInnerVoice(input.innerVoice);
  const lockedShots = lockEpisodeVoices(input.shots, {
    speakMode,
    narratorVoiceId: input.voiceId,
    cast: input.cast,
  });
  let preset = resolveArkVideoPreset(input.presetId);
  if (speakMode === "dialogue" && !preset.generateAudio) {
    const parsed = parseArkPresetId(preset.id);
    preset = resolveArkVideoPreset(composeArkPresetId(parsed.modelId, parsed.resolution));
  }
  const config = resolveArkVideoConfig();
  if (isCloudflareVideoModel(preset.model)) {
    if (!hasCloudflareAiReady()) {
      throw new Error("还没配 Cloudflare AI。请设置 CLOUDFLARE_AI_TOKEN");
    }
  } else if (!config) {
    throw new Error(
      "还没配方舟。在查排名页填入火山方舟 API Key，或在 .env.local 设置 ARK_API_KEY",
    );
  }
  const useLipSync = preset.generateAudio;
  const keepClipAudio = useLipSync;
  const stanceCards = parseStanceCards(input.stanceNotes || "");
  const shots = lockedShots.length
    ? [...lockedShots]
        .sort((a, b) => a.index - b.index)
        .map((shot, i) => ({
          ...shot,
          index: shot.index > 0 ? shot.index : i + 1,
          seconds: clampDuration(shot.seconds, preset),
        }))
    : shotsOrFallback({ ...input, preset });
  const only = (input.onlyIndexes || [])
    .map((n) => Math.round(Number(n)))
    .filter((n) => Number.isFinite(n) && n > 0);
  const targets = only.length > 0 ? new Set(only) : null;
  if (targets) {
    const missing = [...targets].filter(
      (index) => !shots.some((shot) => shot.index === index),
    );
    if (missing.length > 0) {
      throw new Error(`没有第 ${missing.join("、")} 镜，无法出片`);
    }
  }
  const pending = input.composeOnly
    ? []
    : shots
        .filter((shot) => {
          if (targets && !targets.has(shot.index)) return false;
          if (voicePath === "lipsync") {
            return shotCanLipSync(shot);
          }
          return Boolean(targets) || input.force || !shot.clipUrl?.trim();
        })
        .sort((a, b) => a.index - b.index);
  if (voicePath === "lipsync" && pending.length === 0 && !input.composeOnly) {
    throw new Error("先出片再对口型。内心独白不用对口型");
  }
  const missingScenes = pending
    .filter((shot) => !shotHasKeyframes(shot))
    .map((shot) => shot.index);
  if (missingScenes.length > 0) {
    throw new Error(
      `第 ${missingScenes.join("、")} 镜还没有头尾关键帧，先出图再出片`,
    );
  }
  if (!input.composeOnly && voicePath !== "lipsync") {
    const missingOk = pending
      .filter((shot) => !shot.framesOk)
      .map((shot) => shot.index);
    if (missingOk.length > 0) {
      throw new Error(
        `第 ${missingOk.join("、")} 镜静帧还没过片，点过片后再出片`,
      );
    }
    const missingSpeech = pending
      .filter((shot) => shotNeedsLockedSpeech(shot) && !shot.speechUrl?.trim())
      .map((shot) => shot.index);
    if (missingSpeech.length > 0) {
      throw new Error(
        `第 ${missingSpeech.join("、")} 镜还没锁声，先按对白出声再出片`,
      );
    }
  }
  if (input.composeOnly && shots.some((shot) => !shot.clipUrl?.trim())) {
    throw new Error("还有分镜没有出片，先按镜出完再合成");
  }
  if (!shots.length) {
    throw new Error("这集还没有分镜");
  }

  const total = pending.length || shots.length;
  const nextShots = shots.map((shot) => ({ ...shot }));
  const report = async (
    index: number,
    done: number,
    message: string,
    shot?: VideoShot,
  ) => {
    await onProgress?.({ index, total, done, message, shot });
  };
  await report(
    pending[0]?.index || 0,
    0,
    input.composeOnly
      ? `正在把第 ${input.episodeNo} 集 ${shots.length} 镜合成成片…`
      : voicePath === "lipsync"
        ? targets
          ? `准备对第 ${[...targets].join("、")} 镜口型…`
          : `准备按成片声音对口型，共 ${pending.length} 镜…`
        : targets
          ? `准备重出第 ${[...targets].join("、")} 镜…`
          : `准备按分镜出第 ${input.episodeNo} 集，待出 ${pending.length}/${shots.length} 镜…`,
  );

  for (const [i, shot] of pending.entries()) {
    const start = await publicHttpUrl(shotStartUrl(shot));
    const end = await publicHttpUrl(shotEndUrl(shot));
    if (!start || !end || !isSeedanceImageUrl(start) || !isSeedanceImageUrl(end)) {
      throw new Error(
        `第 ${shot.index} 镜头尾还没有方舟能拉的公网 https 地址。确认已配置图床，或重出这一镜头尾。`,
      );
    }
    const turns = splitShotDialogue(shot);
    const pieces =
      turns.length > 0
        ? turns.map((turn) => ({
            ...shot,
            speaker: turn.speaker || shot.speaker,
            voiceover: turn.voiceover,
            speakerId:
              !turn.speaker || turn.speaker === shot.speaker
                ? shot.speakerId
                : undefined,
            voiceId:
              !turn.speaker || turn.speaker === shot.speaker
                ? shot.voiceId
                : undefined,
            delivery: turn.delivery || shot.delivery,
          }))
        : [shot];
    const clipBufs: Buffer[] = [];
    let lastSpeechUrl: string | undefined;
    for (const [ti, piece] of pieces.entries()) {
      const label =
        pieces.length > 1
          ? `第 ${shot.index} 镜第 ${ti + 1}/${pieces.length} 句`
          : `第 ${shot.index} 镜`;
      const spoken = spokenLineOf(piece.voiceover);
      const role = inferSoundRole(piece);
      const speak = role === "speak" || (role === "inner" && Boolean(spoken));
      let speech: SpeechClip | null = null;
      let duration = clampDuration(
        pieces.length > 1
          ? Math.max(preset.minSec, Math.round(piece.seconds / pieces.length))
          : piece.seconds,
        preset,
      );
      const prevShot = nextShots.find((row) => row.index === shot.index - 1);
      const following = nextShots.find((row) => row.index === shot.index + 1);
      const join = inferShotJoin(piece, prevShot);
      const cutsAway = join === "away" || sceneCutsAway(shot);
      const continueSame = Boolean(prevShot && join === "continue");
      const inner = role === "inner" || shotIsInner(piece);
      const innerLevel = inner ? shotInnerLevel(piece, seriesInner) : "";
      const fromClip = voicePath === "lipsync" && !inner;
      const nativeVoice = !fromClip && (voicePath === "native" || inner);
      const taskPreset = {
        ...preset,
        generateAudio: nativeVoice ? true : keepClipAudio,
      };
      const promptBase = {
        seriesTitle: input.seriesTitle,
        episodeTitle: input.title,
        hook: input.hook,
        shot: piece,
        prevShot,
        nextShot: following,
        characterName: input.characterName,
        preset,
        speakMode,
        fromPrevFrame: continueSame,
        cutsAway,
        inner,
        innerLevel,
        lookStyle: input.lookStyle,
        director: input.director,
        talk,
      };
      const runClip = async (content: ContentPart[], waitLabel: string) => {
        await report(shot.index, i, `${label}${waitLabel}生成中…`);
        const remote = await runProviderClip(
          config,
          taskPreset,
          content,
          duration,
          async ({ status }) => {
            await report(
              shot.index,
              i,
              `${label}${waitLabel}${arkWaitLabel(status)}…`,
            );
          },
        );
        await report(shot.index, i, `${label}${waitLabel}保存中…`);
        return downloadVideo(remote);
      };
      if (fromClip && speak) {
        await report(shot.index, i, `${label}抽成片声音…`);
        const extracted = await extractSpeechFromClip(
          shotRawClipUrl(piece) || shotRawClipUrl(shot),
        );
        const audioSec = await audioDurationSec(extracted.buffer);
        duration = clampDuration(audioSec, preset);
        speech = extracted;
        lastSpeechUrl = extracted.url;
      } else if ((useLipSync || inner) && speak && !nativeVoice) {
        const lockedUrl = piece.speechUrl?.trim() || shot.speechUrl?.trim() || "";
        if (lockedUrl) {
          await report(shot.index, i, `${label}用已锁配音…`);
          const buffer = await loadSpeechBuffer(lockedUrl);
          const audioSec = await audioDurationSec(buffer);
          duration = clampDuration(
            inner ? Math.max(audioSec, 4) : audioSec,
            preset,
          );
          speech = { buffer, url: lockedUrl };
          lastSpeechUrl = lockedUrl;
        } else {
        const acting = inner || speakMode === "dialogue";
        const card = stanceCards.find((row) => row.name === piece.speaker);
        await report(
          shot.index,
          i,
          inner ? `${label}内心出声…` : acting ? `${label}写演法…` : `${label}配音中…`,
        );
        const tone = inner
          ? innerSpeechTone(innerLevel)
          : acting
            ? await directSpeechPerformance({
                beat: piece.beat,
                voiceover: piece.voiceover,
                speaker: piece.speaker,
                role: card?.role,
                stance: card?.stance,
                delivery: piece.delivery,
                talk,
              })
            : speechToneLine({
                beat: piece.beat,
                voiceover: piece.voiceover,
                talk,
              });
        if (acting && !inner) await report(shot.index, i, `${label}按演法出声…`);
        const voiceForShot = acting
          ? actingVoiceId(
              resolveShotVoiceId(piece, {
                speakMode,
                narratorVoiceId: input.voiceId,
                cast: input.cast,
              }),
            )
          : resolveShotVoiceId(piece, {
              speakMode,
              narratorVoiceId: input.voiceId,
              cast: input.cast,
            });
        const spokenText = acting
          ? actingSpeechText({ beat: piece.beat, voiceover: piece.voiceover })
          : spoken;
        const paceSec = Math.max(
          2.2,
          spokenText.replace(/\s+/g, "").length / SPEECH_CHARS_PER_SEC + 0.2,
        );
        let speed = inner
          ? innerSpeechSpeed(innerLevel)
          : acting
            ? speechActSpeed(piece.beat, piece.voiceover)
            : speechToneSpeed(piece.beat);
        let raw = await synthesizeSpeechOrThrow(spokenText, voiceForShot, {
          requirePublicUrl: true,
          tone,
          speed,
          acting,
        });
        let audioSec = await audioDurationSec(raw.buffer);
        if (!inner && audioSec > paceSec * 1.4) {
          await report(shot.index, i, `${label}配音太拖，按抖音语速重出…`);
          raw = await synthesizeSpeechOrThrow(spokenText, voiceForShot, {
            requirePublicUrl: true,
            tone: `${tone}语速快，像抖音口播和短剧对口，不要拖腔，不要念稿。`,
            speed: Math.max(speed, 1.3),
            acting,
          });
          audioSec = await audioDurationSec(raw.buffer);
        }
        duration = clampDuration(inner ? Math.max(audioSec, 4) : audioSec, preset);
        speech =
          inner || Math.abs(audioSec - duration) <= 0.2
            ? raw
            : await fitSpeechToDuration(raw, duration);
        if (!speech.url) {
          throw new Error(`${label}配音没有公网地址，2.0 对不上口型`);
        }
        lastSpeechUrl = speech.url;
        }
      }
      const lockLips = Boolean(speech?.url) && !inner && !nativeVoice;
      const content: ContentPart[] = [
        {
          type: "text",
          text: shotPrompt({
            ...promptBase,
            durationSec: duration,
            refFrames: lockLips,
            nativeVoice,
            inner,
            frameLocked: !lockLips,
          }),
        },
      ];
      if (lockLips && speech?.url) {
        content.push({
          type: "image_url",
          image_url: { url: start },
          role: "reference_image",
        });
        content.push({
          type: "image_url",
          image_url: { url: end },
          role: "reference_image",
        });
        content.push({
          type: "audio_url",
          audio_url: { url: speech.url },
          role: "reference_audio",
        });
      } else {
        content.push({
          type: "image_url",
          image_url: { url: start },
          role: "first_frame",
        });
        content.push({
          type: "image_url",
          image_url: { url: end },
          role: "last_frame",
        });
      }
      let clip: Buffer;
      try {
        clip = await runClip(
          content,
          inner ? "内心" : lockLips ? "对口型" : nativeVoice ? "出声" : "视频",
        );
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const arkRaw =
          err instanceof Error && "arkRaw" in err && typeof err.arkRaw === "string"
            ? err.arkRaw
            : raw;
        if (
          (err instanceof Error && err.name === "RealPersonBlock") ||
          isRealPersonBlock(arkRaw)
        ) {
          const wrapped = new Error(
            explainRealPersonBlock(arkRaw, {
              shot: shot.index,
              start,
              end,
            }),
          );
          wrapped.name = "RealPersonBlock";
          throw wrapped;
        }
        throw err;
      }
      if (inner && speech?.buffer) {
        clip = await muxAudio(clip, speech.buffer);
      }
      clipBufs.push(clip);
    }
    const clipUrl =
      clipBufs.length === 1
        ? await persistMp4(clipBufs[0])
        : await persistMp4((await stitchMp4(clipBufs, keepClipAudio)).buffer);
    let clipAltUrl = "";
    if (voicePath !== "lipsync" && !(talk && voicePath === "tts")) {
      try {
        await report(shot.index, i, `第 ${shot.index} 镜出第二条…`);
        const altBufs: Buffer[] = [];
        for (const [ti, piece] of pieces.entries()) {
          const label =
            pieces.length > 1
              ? `第 ${shot.index} 镜第 ${ti + 1}/${pieces.length} 句`
              : `第 ${shot.index} 镜`;
          const role = inferSoundRole(piece);
          const duration = clampDuration(
            pieces.length > 1
              ? Math.max(preset.minSec, Math.round(piece.seconds / pieces.length))
              : piece.seconds,
            preset,
          );
          const prevShot = nextShots.find((row) => row.index === shot.index - 1);
          const following = nextShots.find((row) => row.index === shot.index + 1);
          const join = inferShotJoin(piece, prevShot);
          const cutsAway = join === "away" || sceneCutsAway(shot);
          const continueSame = Boolean(prevShot && join === "continue");
          const inner = role === "inner" || shotIsInner(piece);
          const innerLevel = inner ? shotInnerLevel(piece, seriesInner) : "";
          const nativeVoice = voicePath === "native" || inner;
          const taskPreset = {
            ...preset,
            generateAudio: nativeVoice ? true : keepClipAudio,
          };
          const promptBase = {
            seriesTitle: input.seriesTitle,
            episodeTitle: input.title,
            hook: input.hook,
            shot: piece,
            prevShot,
            nextShot: following,
            characterName: input.characterName,
            preset,
            speakMode,
            fromPrevFrame: continueSame,
            cutsAway,
            inner,
            innerLevel,
            lookStyle: input.lookStyle,
            director: input.director,
            talk,
          };
          const runClip = async (content: ContentPart[], waitLabel: string) => {
            await report(shot.index, i, `${label}第二条${waitLabel}生成中…`);
            const remote = await runProviderClip(
              config,
              taskPreset,
              content,
              duration,
              async ({ status }) => {
                await report(
                  shot.index,
                  i,
                  `${label}第二条${waitLabel}${arkWaitLabel(status)}…`,
                );
              },
            );
            await report(shot.index, i, `${label}第二条${waitLabel}保存中…`);
            return downloadVideo(remote);
          };
          const content: ContentPart[] = [
            {
              type: "text",
              text: shotPrompt({
                ...promptBase,
                durationSec: duration,
                nativeVoice,
                inner,
                frameLocked: true,
              }),
            },
            {
              type: "image_url",
              image_url: { url: start },
              role: "first_frame",
            },
            {
              type: "image_url",
              image_url: { url: end },
              role: "last_frame",
            },
          ];
          let clip = await runClip(content, nativeVoice ? "出声" : "视频");
          if (inner && lastSpeechUrl) {
            try {
              clip = await muxAudio(clip, await loadSpeechBuffer(lastSpeechUrl));
            } catch {
              // keep dry
            }
          }
          altBufs.push(clip);
        }
        clipAltUrl =
          altBufs.length === 1
            ? await persistMp4(altBufs[0])
            : await persistMp4((await stitchMp4(altBufs, keepClipAudio)).buffer);
      } catch {
        clipAltUrl = "";
      }
    }
    const lastFrameUrl = await lastFramePublicUrl(clipUrl);
    const onset = await probeClipOnsetSec(clipUrl);
    const saved: VideoShot = {
      ...shot,
      clipUrl,
      rawClipUrl: clipUrl,
      ...(clipAltUrl ? { clipAltUrl } : {}),
      ...(lastSpeechUrl ? { speechUrl: lastSpeechUrl } : {}),
      ...(lastFrameUrl ? { lastFrameUrl } : {}),
      ...(onset != null ? { speechOnsetSec: onset } : {}),
    };
    const pos = nextShots.findIndex((row) => row.index === shot.index);
    if (pos >= 0) nextShots[pos] = saved;
    await report(
      shot.index,
      i + 1,
      clipAltUrl
        ? `第 ${shot.index} 镜两条都好了，先看第一条`
        : `第 ${shot.index} 镜视频已就绪`,
      saved,
    );
  }

  const ready = nextShots.every((shot) => Boolean(shot.clipUrl?.trim()));
  const model = `${preset.model} ${preset.resolution}${
    voicePath === "lipsync"
      ? " 对口型"
      : voicePath === "native"
        ? " 模型出声"
        : useLipSync
          ? speakMode === "dialogue"
            ? " 按演法对口型"
            : " 对口型"
          : " 旁白"
  }`;
  if (!input.composeOnly) {
    if (!ready) {
      const left = nextShots.filter((shot) => !shot.clipUrl?.trim()).length;
      await report(
        pending[pending.length - 1]?.index || 0,
        pending.length,
        `分镜视频已保存，还差 ${left} 镜`,
      );
      return { url: null, model, shots: nextShots, composed: false };
    }
    await report(
      pending[pending.length - 1]?.index || 0,
      pending.length,
      "分镜已出齐，先按镜预览，没问题再手动合成",
    );
    return { url: null, model, shots: nextShots, composed: false };
  }
  if (!ready) {
    throw new Error("还有分镜没有出片，先按镜出完再合成");
  }

  const frozenClips = nextShots.map((shot) => ({
    clipUrl: shot.clipUrl,
    rawClipUrl: shot.rawClipUrl || shot.clipUrl,
  }));
  await report(0, total, "正在拼接各镜视频…");
  const clips: Buffer[] = [];
  const speechCaps: Array<number | undefined> = [];
  for (const shot of nextShots) {
    clips.push(await loadVideoBuffer(shotRawClipUrl(shot)));
    speechCaps.push(await speechCapForShot(shot));
  }
  const stitched = await stitchMp4(clips, keepClipAudio, speechCaps);
  let video = stitched.buffer;
  try {
    video = await mixComposeAudio({
      video,
      shots: nextShots,
      durations: stitched.durations,
      bed: input.bedMusic === true,
      songUrl: input.bedSongUrl,
      feel: input.director?.feel,
      close: input.director?.close,
    });
  } catch {
    // 没有音效文件或混音失败时仍交出干对白成片
  }
  if (!keepClipAudio) {
    await report(0, total, "正在叠整集旁白…");
    const episodeSpeech = await synthesizeSpeechOrThrow(
      input.voiceover || nextShots.map((s) => s.voiceover).join(""),
      input.voiceId,
    );
    video = await muxAudio(video, episodeSpeech.buffer);
  }
  await report(0, total, "正在保存无字幕底片…");
  const sourceUrl = await persistMp4(video);
  await report(0, total, "正在从成片对字幕…");
  const burned = await burnShotCaptions(video, nextShots, stitched.durations, {
    title: input.seriesTitle,
  });
  await report(0, total, "正在保存成片…");
  const url = await persistMp4(burned.buffer);
  const kept = nextShots.map((shot, i) => ({
    ...shot,
    clipUrl: frozenClips[i]?.clipUrl || shot.clipUrl,
    rawClipUrl: frozenClips[i]?.rawClipUrl || shot.rawClipUrl || shot.clipUrl,
  }));
  return {
    url,
    sourceUrl,
    subtitleUrl: null,
    captionCues: { captions: burned.cues, flowers: burned.flowers },
    model,
    shots: kept,
    composed: true,
  };
}

export async function dubExistingEpisodeVideo(
  input: {
    videoUrl: string;
    voiceover: string;
    voiceId?: string;
  },
  onProgress?: (event: VideoGenProgress) => void | Promise<void>,
): Promise<{ url: string; model: string }> {
  const spoken = input.voiceover.replace(/\s+/g, " ").trim();
  if (!spoken) throw new Error("没有可朗读的口播，先把旁白写上");
  const report = async (done: number, message: string) => {
    await onProgress?.({ index: 0, total: 3, done, message });
  };
  await report(0, "正在配旁白…");
  const speech = await synthesizeSpeechOrThrow(spoken, input.voiceId);
  await report(1, "正在下载成片…");
  const video = await downloadVideo(input.videoUrl);
  await report(2, "正在叠音轨…");
  const muxed = await muxAudio(video, speech.buffer);
  await report(3, "正在保存…");
  const url = await persistMp4(muxed);
  return { url, model: "旁白配音" };
}
