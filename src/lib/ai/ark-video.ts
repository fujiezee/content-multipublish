import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { randomUUID } from "crypto";
import {
  publishSpeechBuffer,
  synthesizeSpeechOrThrow,
} from "@/lib/ai/ark-tts";
import { MANHUA_VIDEO_STYLE } from "@/lib/ai/manhua-look";
import { resolveShotVoiceId } from "@/lib/ai/tts-voice-ids";
import { normalizeSpeakMode, type VideoSpeakMode } from "@/lib/types";
import { resolveDoubaoEnvConfig } from "@/lib/ai/doubao";
import { getDoubaoStoredSecret } from "@/lib/db";
import { UPLOADS_DIR, ensureDataDirs } from "@/lib/paths";
import {
  publishLocalCoverPath,
  uploadPublicMedia,
} from "@/lib/storage/public-media";
import type { VideoShot } from "@/lib/types";

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
};

export const ARK_VIDEO_MODELS: ArkVideoModelOption[] = [
  {
    id: "seedance-2-mini",
    label: "Doubao-Seedance-2.0-mini",
    model: "doubao-seedance-2-0-mini-260615",
    hint: "先配音再对口型",
    generateAudio: true,
    resolutions: ["480p", "720p"],
  },
  {
    id: "seedance-2-fast",
    label: "Doubao-Seedance-2.0-fast",
    model: "doubao-seedance-2-0-fast-260128",
    hint: "比 mini 更清，须先开通",
    generateAudio: true,
    resolutions: ["480p", "720p"],
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
    maxSec: 15,
    generateAudio: model.generateAudio,
  };
}

export const ARK_VIDEO_PRESETS: ArkVideoPreset[] = ARK_VIDEO_MODELS.flatMap(
  (model) => model.resolutions.map((res) => makePreset(model, res)),
);

export const DEFAULT_ARK_VIDEO_PRESET = "seedance-2-mini-480";

export function listArkVideoModels(): ArkVideoModelOption[] {
  return ARK_VIDEO_MODELS;
}

export function composeArkPresetId(
  modelId: string,
  resolution: ArkVideoResolution,
): string {
  const model =
    ARK_VIDEO_MODELS.find((m) => m.id === modelId) || ARK_VIDEO_MODELS[0];
  const res = model.resolutions.includes(resolution) ? resolution : model.resolutions[0];
  return `${model.id}-${res === "720p" ? "720" : "480"}`;
}

export function parseArkPresetId(id?: string): {
  modelId: string;
  resolution: ArkVideoResolution;
} {
  const raw = (id || DEFAULT_ARK_VIDEO_PRESET).trim();
  const resolution: ArkVideoResolution = /720/.test(raw) ? "720p" : "480p";
  const modelId = /2-fast/.test(raw) ? "seedance-2-fast" : "seedance-2-mini";
  return { modelId, resolution };
}

export function listArkVideoPresets(): Array<
  Pick<ArkVideoPreset, "id" | "label" | "hint" | "resolution" | "generateAudio" | "model">
> {
  return ARK_VIDEO_PRESETS.map((p) => ({
    id: p.id,
    model: p.model,
    label: `${p.label}`,
    hint: p.hint,
    resolution: p.resolution,
    generateAudio: p.generateAudio,
  }));
}

export function resolveArkVideoPreset(id?: string): ArkVideoPreset {
  const { modelId, resolution } = parseArkPresetId(id);
  return (
    ARK_VIDEO_PRESETS.find((p) => p.id === id) ||
    ARK_VIDEO_PRESETS.find((p) => p.id === composeArkPresetId(modelId, resolution)) ||
    ARK_VIDEO_PRESETS[0]
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

function isRealPersonBlock(message: string): boolean {
  return /real person|真实人物|真人|may contain/i.test(message);
}

function explainArkVideoError(message: string): string {
  if (/AccountOverdueError|overdue|欠费/i.test(message)) {
    return "火山引擎账号欠费，视频生成调不通。先到费用中心充值。";
  }
  if (/has not activated|not activated|ModelNotOpen|未开通/i.test(message)) {
    return "这个方舟账号还没开通 Seedance 2.0-mini。到开通管理打开后再出对口型，或先用 1.0 出画面再点「补旁白」。";
  }
  if (isRealPersonBlock(message)) {
    return "2.0 把这张配图判成真人人脸，没有用这张图出片。先重出这一镜图（漫剧插画，不要实拍脸），再出视频。";
  }
  if (/InvalidEndpointOrModel|NotFound|does not exist/i.test(message)) {
    return "方舟找不到这个视频模型。确认已开通 Seedance，或换一个档位再试。";
  }
  return message;
}

type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string };
      role?: "first_frame" | "reference_image";
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
    const err = new Error(explainArkVideoError(raw));
    if (isRealPersonBlock(raw)) err.name = "RealPersonBlock";
    throw err;
  }
  return json;
}

function isV2Preset(preset: ArkVideoPreset): boolean {
  return /2-0|2-5|seedance-2/i.test(preset.model);
}

async function createTask(
  config: ArkVideoConfig,
  preset: ArkVideoPreset,
  content: ContentPart[],
  duration: number,
): Promise<string> {
  const json = await arkJson<{ id?: string }>(
    config,
    "POST",
    "/contents/generations/tasks",
    {
      model: preset.model,
      content,
      resolution: preset.resolution,
      ratio: "9:16",
      duration,
      watermark: false,
      ...(preset.model.includes("2-0")
        ? { generate_audio: preset.generateAudio }
        : { camera_fixed: false }),
    },
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

async function waitForVideo(
  config: ArkVideoConfig,
  taskId: string,
  onTick?: (info: { status: string; elapsedSec: number }) => void | Promise<void>,
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    const json = await arkJson<{
      status?: string;
      content?: { video_url?: string };
      error?: { message?: string };
    }>(config, "GET", `/contents/generations/tasks/${taskId}`);
    const status = (json.status || "").toLowerCase();
    if (status === "succeeded") {
      const url = json.content?.video_url?.trim();
      if (!url) throw new Error("方舟任务成功但没有视频地址");
      return url;
    }
    if (status === "failed" || status === "cancelled") {
      const raw = json.error?.message || "方舟视频任务失败";
      const err = new Error(explainArkVideoError(raw));
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

async function loadVideoBuffer(url: string): Promise<Buffer> {
  const raw = url.trim();
  const match = raw.match(/\/api\/uploads\/([^/?#]+)/i);
  if (match) {
    const name = decodeURIComponent(match[1]);
    if (name && !name.includes("..") && !name.includes("/")) {
      const file = path.join(UPLOADS_DIR, name);
      if (fs.existsSync(file)) return fs.readFileSync(file);
    }
  }
  return downloadVideo(raw);
}

async function persistMp4(buf: Buffer): Promise<string> {
  ensureDataDirs();
  const name = `${randomUUID()}.mp4`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
  const publicUrl = await uploadPublicMedia({
    bytes: buf,
    filename: name,
    contentType: "video/mp4",
  });
  return publicUrl || `/api/uploads/${name}`;
}

async function stitchMp4(clips: Buffer[], keepAudio: boolean): Promise<Buffer> {
  if (clips.length === 1) return clips[0];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-video-"));
  try {
    const parts: string[] = [];
    for (const [i, clip] of clips.entries()) {
      const file = path.join(dir, `${String(i).padStart(2, "0")}.mp4`);
      fs.writeFileSync(file, clip);
      parts.push(file);
    }
    const list = path.join(dir, "list.txt");
    fs.writeFileSync(
      list,
      parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
    );
    const out = path.join(dir, "out.mp4");
    const base = ["-y", "-f", "concat", "-safe", "0", "-i", list];
    const withAudio = [
      ...base,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      out,
    ];
    const silent = [
      ...base,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
      out,
    ];
    try {
      await execFileAsync(resolveFfmpeg(), keepAudio ? withAudio : silent, {
        timeout: 180_000,
      });
    } catch (err) {
      if (!keepAudio) throw err;
      await execFileAsync(resolveFfmpeg(), silent, { timeout: 180_000 });
    }
    return fs.readFileSync(out);
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
        "-c:a",
        "aac",
        "-shortest",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
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

async function audioDurationSec(buf: Buffer): Promise<number> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-aud-"));
  try {
    const file = path.join(dir, "in.mp3");
    fs.writeFileSync(file, buf);
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
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error("读不出配音时长");
    }
    return n;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
    return publishSpeechBuffer(fs.readFileSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function shotPrompt(input: {
  seriesTitle: string;
  episodeTitle: string;
  hook: string;
  shot: VideoShot;
  characterName?: string;
  preset: ArkVideoPreset;
  speakMode: VideoSpeakMode;
  durationSec: number;
}): string {
  const who = input.characterName?.trim();
  const line = input.shot.voiceover.trim();
  const speak = Boolean(line);
  const lines = [
    MANHUA_VIDEO_STYLE,
    `系列：${input.seriesTitle}`,
    `本集：${input.episodeTitle}`,
    input.hook ? `开场钩子：${input.hook}` : "",
    who
      ? `出镜的人是${who.includes("、") ? who : `「${who}」`}，必须和角色参考图是同一些人。`
      : "",
    `画面：${input.shot.visual || "讲解者面对镜头，口型自然"}`,
    speak
      ? `角色面对镜头开口说话，口型必须对上参考音频。他说：「${line.slice(0, 160)}」`
      : "",
    `--resolution ${input.preset.resolution} --ratio 9:16 --dur ${input.durationSec} --watermark false`,
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
    return input.shots.slice(0, 12).map((shot, i) => ({
      ...shot,
      index: i + 1,
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

async function firstFrameUrl(
  angles?: { id: string; label: string; url: string }[],
): Promise<string | undefined> {
  const front =
    angles?.find((a) => a.id === "front") ||
    angles?.find((a) => a.url) ||
    null;
  return publicHttpUrl(front?.url);
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
    force?: boolean;
    onlyIndexes?: number[];
    composeOnly?: boolean;
  },
  onProgress?: (event: VideoGenProgress) => void | Promise<void>,
): Promise<{ url: string | null; model: string; shots: VideoShot[]; composed: boolean }> {
  const config = resolveArkVideoConfig();
  if (!config) {
    throw new Error(
      "还没配方舟。在提及检测页填入火山方舟 API Key，或在 .env.local 设置 ARK_API_KEY",
    );
  }
  const speakMode = normalizeSpeakMode(input.speakMode);
  let preset = resolveArkVideoPreset(input.presetId);
  if (speakMode === "dialogue" && !preset.generateAudio) {
    const parsed = parseArkPresetId(preset.id);
    preset = resolveArkVideoPreset(composeArkPresetId(parsed.modelId, parsed.resolution));
  }
  const useLipSync = Boolean(preset.generateAudio);
  const shots = input.shots.length
    ? input.shots.slice(0, 12).map((shot, i) => ({
        ...shot,
        index: i + 1,
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
    : shots.filter((shot) =>
        targets
          ? targets.has(shot.index)
          : input.force || !shot.clipUrl?.trim(),
      );
  if (pending.some((shot) => !shot.sceneUrl?.trim())) {
    throw new Error("先生成本集每一镜的场景图，再出视频");
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
      : targets
        ? `准备重出第 ${[...targets].join("、")} 镜…`
        : `准备按分镜出第 ${input.episodeNo} 集，待出 ${pending.length}/${shots.length} 镜…`,
  );

  const characterFrame = pending.length
    ? await firstFrameUrl(input.characterAngles)
    : undefined;

  for (const [i, shot] of pending.entries()) {
    const scene = await publicHttpUrl(shot.sceneUrl);
    if (!scene) {
      throw new Error(
        `第 ${shot.index} 镜场景还没有公网地址。确认已配置图床，或重出这一镜场景。`,
      );
    }
    let speech: { buffer: Buffer; url?: string } | null = null;
    let duration = clampDuration(shot.seconds, preset);
    if (useLipSync) {
      await report(shot.index, i, `第 ${shot.index} 镜配音中…`);
      const raw = await synthesizeSpeechOrThrow(
        shot.voiceover,
        resolveShotVoiceId(shot, {
          speakMode,
          narratorVoiceId: input.voiceId,
          cast: input.cast,
        }),
        {
          requirePublicUrl: true,
        },
      );
      const audioSec = await audioDurationSec(raw.buffer);
      duration = clampDuration(audioSec, preset);
      speech =
        Math.abs(audioSec - duration) > 0.2
          ? await fitSpeechToDuration(raw, duration)
          : raw;
      if (!speech.url) {
        throw new Error(
          `第 ${shot.index} 镜配音没有公网地址，2.0 对不上口型`,
        );
      }
      await report(shot.index, i, `第 ${shot.index} 镜配音中…`);
    }
    const text = shotPrompt({
      seriesTitle: input.seriesTitle,
      episodeTitle: input.title,
      hook: input.hook,
      shot,
      characterName: input.characterName,
      preset,
      speakMode,
      durationSec: duration,
    });
    const content: ContentPart[] = [{ type: "text", text }];
    const extraRefs: string[] = [];
    for (const angle of input.characterAngles || []) {
      const url = await publicHttpUrl(angle.url);
      if (url && url !== scene && !extraRefs.includes(url)) extraRefs.push(url);
      if (extraRefs.length >= 3) break;
    }
    if (characterFrame && characterFrame !== scene && !extraRefs.includes(characterFrame)) {
      extraRefs.unshift(characterFrame);
    }
    const refImages = [scene, ...extraRefs.filter((url) => url !== scene)].slice(
      0,
      4,
    );
    if (isV2Preset(preset)) {
      for (const url of refImages) {
        content.push({
          type: "image_url",
          image_url: { url },
          role: "reference_image",
        });
      }
    } else {
      content.push({
        type: "image_url",
        image_url: { url: scene },
        role: "first_frame",
      });
    }
    if (useLipSync && speech?.url) {
      content.push({
        type: "audio_url",
        audio_url: { url: speech.url },
        role: "reference_audio",
      });
    }
    const taskPreset = { ...preset, generateAudio: useLipSync };
    await report(shot.index, i, `第 ${shot.index} 镜视频生成中…`);
    const taskId = await createTask(config, taskPreset, content, duration);
    const remote = await waitForVideo(
      config,
      taskId,
      async ({ status }) => {
        await report(
          shot.index,
          i,
          `第 ${shot.index} 镜视频${arkWaitLabel(status)}…`,
        );
      },
    );
    await report(shot.index, i, `第 ${shot.index} 镜视频保存中…`);
    const clipUrl = await persistMp4(await downloadVideo(remote));
    const saved: VideoShot = { ...shot, clipUrl };
    const pos = nextShots.findIndex((row) => row.index === shot.index);
    if (pos >= 0) nextShots[pos] = saved;
    await report(shot.index, i + 1, `第 ${shot.index} 镜视频已就绪`, saved);
  }

  const ready = nextShots.every((shot) => Boolean(shot.clipUrl?.trim()));
  const model = `${preset.model} ${preset.resolution}${useLipSync ? " 对口型" : " 旁白"}`;
  if (!ready) {
    const left = nextShots.filter((shot) => !shot.clipUrl?.trim()).length;
    await report(
      pending[pending.length - 1]?.index || 0,
      pending.length,
      `分镜视频已保存，还差 ${left} 镜才能合成成片`,
    );
    return { url: null, model, shots: nextShots, composed: false };
  }

  await report(0, total, "正在拼接各镜视频…");
  const clips: Buffer[] = [];
  for (const shot of nextShots) {
    clips.push(await loadVideoBuffer(shot.clipUrl || ""));
  }
  let stitched = await stitchMp4(clips, useLipSync);
  if (!useLipSync) {
    await report(0, total, "正在叠整集旁白…");
    const episodeSpeech = await synthesizeSpeechOrThrow(
      input.voiceover || nextShots.map((s) => s.voiceover).join(""),
      input.voiceId,
    );
    stitched = await muxAudio(stitched, episodeSpeech.buffer);
  }
  await report(0, total, "正在保存成片…");
  const url = await persistMp4(stitched);
  return { url, model, shots: nextShots, composed: true };
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
