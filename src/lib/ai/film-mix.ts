import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { inferSoundRole, spokenForPlay } from "@/lib/ai/emotion-beat";
import type { VideoShot } from "@/lib/types";

const execFileAsync = promisify(execFile);

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

function sfxPath(name: string): string {
  return path.join(process.cwd(), "public", "sfx", name);
}

export function isHitShot(
  shot: Pick<VideoShot, "beat" | "soundRole" | "voiceover" | "visual">,
): boolean {
  const role = inferSoundRole(shot);
  if (role === "hit") return true;
  const beat = String(shot.beat || "");
  return (beat === "打" || beat === "钩") && spokenForPlay(shot.voiceover).length < 2;
}

export function pickBedFile(feel?: string, close?: string): string {
  if (feel === "爽" || close === "爽") return sfxPath("bed-bright.wav");
  return sfxPath("bed-dark.wav");
}

export async function mixComposeAudio(input: {
  video: Buffer;
  shots: VideoShot[];
  durations: number[];
  bed?: boolean;
  songUrl?: string;
  feel?: string;
  close?: string;
}): Promise<Buffer> {
  const hits = input.shots
    .map((shot, i) => ({
      shot,
      at: input.durations.slice(0, i).reduce((sum, n) => sum + n, 0),
    }))
    .filter((row) => isHitShot(row.shot));
  const hitFile = sfxPath("hit.wav");
  const duration = input.durations.reduce((sum, n) => sum + n, 0) || 1;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-mix-"));
  let bedFile = "";
  let bedVolume = 0.08;
  try {
    const songUrl = String(input.songUrl || "").trim();
    if (songUrl) {
      try {
        const dest = path.join(dir, "song.bin");
        const res = await fetch(songUrl, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`配乐下载失败 ${res.status}`);
        fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
        bedFile = dest;
        bedVolume = 0.22;
      } catch {
        bedFile = "";
      }
    } else if (input.bed) {
      const local = pickBedFile(input.feel, input.close);
      if (fs.existsSync(local)) {
        bedFile = local;
        bedVolume = 0.08;
      }
    }
    const useHit = hits.length > 0 && fs.existsSync(hitFile);
    const useBed = Boolean(bedFile && fs.existsSync(bedFile));
    if (!useHit && !useBed) return input.video;

    const src = path.join(dir, "in.mp4");
    const out = path.join(dir, "out.mp4");
    fs.writeFileSync(src, input.video);
    const args = ["-y", "-i", src];
    const filters: string[] = [];
    let next = 1;
    const mixInputs = ["[0:a]"];
    if (useBed) {
      args.push("-stream_loop", "-1", "-i", bedFile);
      const bedIdx = next;
      next += 1;
      filters.push(
        `[${bedIdx}:a]atrim=0:${duration.toFixed(2)},asetpts=PTS-STARTPTS,volume=${bedVolume}[bed]`,
      );
      mixInputs.push("[bed]");
    }
    if (useHit) {
      args.push("-i", hitFile);
      const hitIdx = next;
      hits.forEach((row, i) => {
        const ms = Math.max(0, Math.round(row.at * 1000));
        const label = `hit${i}`;
        filters.push(
          `[${hitIdx}:a]adelay=${ms}|${ms},volume=1.1[${label}]`,
        );
        mixInputs.push(`[${label}]`);
      });
    }
    const mix = `${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0.08:normalize=0[a]`;
    filters.push(mix);
    args.push(
      "-filter_complex",
      filters.join(";"),
      "-map",
      "0:v",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      out,
    );
    await execFileAsync(resolveFfmpeg(), args, { timeout: 120_000 });
    return fs.readFileSync(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`成片混音失败：${message.slice(0, 160)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
