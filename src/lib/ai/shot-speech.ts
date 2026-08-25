import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { synthesizeSpeechOrThrow } from "@/lib/ai/ark-tts";
import {
  actingSpeechText,
  inferSoundRole,
  innerSpeechSpeed,
  innerSpeechTone,
  speechActSpeed,
  speechToneLine,
  speechToneSpeed,
  spokenForPlay,
} from "@/lib/ai/emotion-beat";
import { actingVoiceId, resolveShotVoiceId } from "@/lib/ai/tts-voice-ids";
import { UPLOADS_DIR } from "@/lib/paths";
import {
  normalizeSpeakMode,
  shotInnerLevel,
  shotIsInner,
  shotNeedsLockedSpeech,
  type VideoShot,
  type VideoSpeakMode,
} from "@/lib/types";

const execFileAsync = promisify(execFile);
const SHOT_SEC_MIN = 4;
const SHOT_SEC_MAX = 15;

function resolveFfprobe(): string {
  const probe = "ffprobe";
  for (const file of [
    "/opt/homebrew/bin/ffprobe",
    "/usr/local/bin/ffprobe",
    "/usr/bin/ffprobe",
  ]) {
    if (fs.existsSync(file)) return file;
  }
  return probe;
}

async function loadAudioBuffer(url: string): Promise<Buffer> {
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
  if (!res.ok) throw new Error(`配音文件读不到 ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const MPEG1_LAYER3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG2_LAYER3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

function id3Size(buf: Buffer): number {
  if (buf.length < 10) return 0;
  if (buf.toString("ascii", 0, 3) !== "ID3") return 0;
  return (
    10 +
    (((buf[6] & 0x7f) << 21) |
      ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) |
      (buf[9] & 0x7f))
  );
}

function wavDurationSec(buf: Buffer): number {
  if (buf.length < 44) return 0;
  if (buf.toString("ascii", 0, 4) !== "RIFF") return 0;
  if (buf.toString("ascii", 8, 12) !== "WAVE") return 0;
  let offset = 12;
  let byteRate = 0;
  let dataBytes = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt " && size >= 8 && offset + 16 <= buf.length) {
      byteRate = buf.readUInt32LE(offset + 16);
    }
    if (id === "data") dataBytes = size;
    offset += 8 + size + (size % 2);
  }
  if (byteRate > 0 && dataBytes > 0) return dataBytes / byteRate;
  return 0;
}

/** Worker 上没有 ffprobe，用帧头把 MP3/WAV 时长读出来。 */
export function readAudioDurationSec(buf: Buffer): number {
  const wav = wavDurationSec(buf);
  if (wav > 0.2) return wav;
  let i = id3Size(buf);
  let duration = 0;
  let frames = 0;
  while (i + 4 < buf.length && frames < 30_000) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) {
      i += 1;
      continue;
    }
    const verBits = (buf[i + 1] >> 3) & 3;
    const layer = (buf[i + 1] >> 1) & 3;
    const brIdx = (buf[i + 2] >> 4) & 0xf;
    const srIdx = (buf[i + 2] >> 2) & 3;
    const padded = (buf[i + 2] >> 1) & 1;
    if (layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) {
      i += 1;
      continue;
    }
    const mpeg1 = verBits === 3;
    const bitrate = (mpeg1 ? MPEG1_LAYER3 : MPEG2_LAYER3)[brIdx] * 1000;
    const sampleRate = (mpeg1 ? [44100, 48000, 32000] : [22050, 24000, 16000])[
      srIdx
    ];
    const samples = mpeg1 ? 1152 : 576;
    const frameSize = Math.floor((samples / 8) * bitrate / sampleRate) + padded;
    if (frameSize < 4) {
      i += 1;
      continue;
    }
    duration += samples / sampleRate;
    i += frameSize;
    frames += 1;
  }
  if (duration > 0.2) return duration;
  if (buf.length > 64) return (buf.length * 8) / 128_000;
  return 0;
}

export async function probeAudioDurationSec(buf: Buffer): Promise<number> {
  const parsed = readAudioDurationSec(buf);
  if (parsed > 0.2) return parsed;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-speech-"));
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
      if (Number.isFinite(n) && n > 0) return n;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    /* Worker 没有 child_process / ffprobe */
  }
  throw new Error("读不出配音时长");
}

export function secondsFromAudio(
  audioSec: number,
  bounds?: { minSec?: number; maxSec?: number },
): number {
  const min = Math.max(1, Math.round(Number(bounds?.minSec) || SHOT_SEC_MIN));
  const max = Math.max(min, Math.round(Number(bounds?.maxSec) || SHOT_SEC_MAX));
  return Math.min(max, Math.max(min, Math.ceil(audioSec + 0.25)));
}

export function shotNeedsSpeech(shot: VideoShot): boolean {
  const spoken = spokenForPlay(shot.voiceover);
  if (spoken.length < 2) return false;
  const role = inferSoundRole(shot);
  return role === "speak" || role === "inner" || shotIsInner(shot);
}

export async function lockEpisodeSpeechTiming(input: {
  shots: VideoShot[];
  speakMode?: VideoSpeakMode | string;
  narratorVoiceId?: string;
  cast?: Array<{ id: string; name: string; voice_id?: string }>;
  minSec?: number;
  maxSec?: number;
  onProgress?: (message: string, shot?: VideoShot) => void | Promise<void>;
}): Promise<VideoShot[]> {
  const speakMode = normalizeSpeakMode(input.speakMode);
  const bounds = { minSec: input.minSec, maxSec: input.maxSec };
  const out: VideoShot[] = [];
  const spokenShots = input.shots.filter(shotNeedsSpeech);
  let done = 0;
  for (const shot of input.shots) {
    if (!shotNeedsSpeech(shot)) {
      out.push(shot);
      continue;
    }
    done += 1;
    await input.onProgress?.(
      `第 ${shot.index} 镜按对白出声（${done}/${spokenShots.length}）…`,
      shot,
    );
    try {
      let buffer: Buffer;
      let url = shot.speechUrl?.trim() || "";
      if (url) {
        buffer = await loadAudioBuffer(url);
      } else {
        const inner = inferSoundRole(shot) === "inner" || shotIsInner(shot);
        const acting = inner || speakMode === "dialogue";
        const spoken = spokenForPlay(shot.voiceover);
        const spokenText = acting
          ? actingSpeechText({ beat: shot.beat, voiceover: shot.voiceover })
          : spoken;
        const voiceForShot = acting
          ? actingVoiceId(
              resolveShotVoiceId(shot, {
                speakMode,
                narratorVoiceId: input.narratorVoiceId,
                cast: input.cast,
              }),
            )
          : resolveShotVoiceId(shot, {
              speakMode,
              narratorVoiceId: input.narratorVoiceId,
              cast: input.cast,
            });
        const innerLevel = inner ? shotInnerLevel(shot) : "";
        const tone = inner
          ? innerSpeechTone(innerLevel)
          : acting
            ? speechToneLine({ beat: shot.beat, voiceover: shot.voiceover })
            : speechToneLine({ beat: shot.beat, voiceover: shot.voiceover });
        const speed = inner
          ? innerSpeechSpeed(innerLevel)
          : acting
            ? speechActSpeed(shot.beat, shot.voiceover)
            : speechToneSpeed(shot.beat);
        const clip = await synthesizeSpeechOrThrow(spokenText, voiceForShot, {
          requirePublicUrl: true,
          tone,
          speed,
          acting,
        });
        buffer = clip.buffer;
        url = clip.url || "";
        if (!url) throw new Error("配音没有公网地址");
      }
      const audioSec = await probeAudioDurationSec(buffer);
      const next: VideoShot = {
        ...shot,
        speechUrl: url,
        seconds: secondsFromAudio(audioSec, bounds),
      };
      out.push(next);
      await input.onProgress?.(
        `第 ${shot.index} 镜对白 ${audioSec.toFixed(1)} 秒，按 ${next.seconds} 秒出图`,
        next,
      );
    } catch (err) {
      if (shotNeedsLockedSpeech(shot)) {
        const why = err instanceof Error ? err.message : "锁声失败";
        throw new Error(`第 ${shot.index} 镜锁声失败，不能估秒数出片。${why}`);
      }
      out.push(shot);
      await input.onProgress?.(
        `第 ${shot.index} 镜对白没出成，仍按 ${shot.seconds} 秒估`,
        shot,
      );
    }
  }
  return out;
}
