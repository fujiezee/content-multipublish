import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import {
  captionPhrases,
  captionSource,
  expandRevealCues,
  wrapCaption,
  type CaptionCue,
} from "@/lib/ai/caption-reveal";
import type { VideoShot } from "@/lib/types";

const execFileAsync = promisify(execFile);

export type AsrSegment = {
  start: number;
  end: number;
  text: string;
};

function resolveOpenAiAsrConfig(): { apiKey: string; baseUrl: string } | null {
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

function normText(text: string): string {
  return String(text || "")
    .replace(/[，。！？、：:；;…—,.!?'"“”‘’（）()【】《》<>·[\]]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function shotDuration(shot: VideoShot, durations: number[] | undefined, i: number): number {
  return Math.max(0.4, Number(durations?.[i]) || Number(shot.seconds) || 8);
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

type TimedChar = { ch: string; t0: number; t1: number };

function flattenSpoken(rows: AsrSegment[]): TimedChar[] {
  const out: TimedChar[] = [];
  const sorted = [...rows].sort((a, b) => a.start - b.start);
  for (const row of sorted) {
    const text = normText(row.text);
    if (!text) continue;
    const span = Math.max(0.04, row.end - row.start);
    for (let i = 0; i < text.length; i += 1) {
      out.push({
        ch: text[i] || "",
        t0: row.start + (span * i) / text.length,
        t1: row.start + (span * (i + 1)) / text.length,
      });
    }
  }
  return out;
}

function findPhraseSpan(
  phrase: string,
  chars: TimedChar[],
  from: number,
  tMin: number,
  tMax: number,
): { start: number; end: number; next: number } | null {
  const n = normText(phrase);
  if (!n) return null;
  const lo = tMin - 0.12;
  const hi = tMax + 0.12;
  let best: { start: number; end: number; next: number; score: number } | null =
    null;
  for (let i = Math.max(from, 0); i < chars.length; i += 1) {
    const ch = chars[i];
    if (!ch || ch.t0 < lo) continue;
    if (ch.t0 > hi) break;
    if (n.length > 1 && ch.ch !== n[0]) continue;
    let hit = 0;
    let k = i;
    let start = ch.t0;
    let end = ch.t1;
    while (k < chars.length && hit < n.length && (chars[k]?.t0 ?? 0) <= hi) {
      const cur = chars[k];
      if (cur && cur.ch === n[hit]) {
        if (hit === 0) start = cur.t0;
        end = cur.t1;
        hit += 1;
      }
      k += 1;
    }
    const score = hit / n.length;
    const consumed = k - i;
    if (score >= 0.78 && consumed <= n.length * 3) {
      return { start, end: Math.max(start + 0.16, end), next: k };
    }
    if (score >= 0.68 && consumed <= n.length * 4) {
      if (!best || score > best.score) {
        best = { start, end: Math.max(start + 0.16, end), next: k, score };
      }
    }
  }
  return best
    ? { start: best.start, end: best.end, next: best.next }
    : null;
}

function packPhraseTimes(
  phrases: string[],
  hits: Array<{ start: number; end: number } | null>,
  t0: number,
  t1: number,
): CaptionCue[] {
  const endAt = Math.max(t0 + 0.2, t1);
  const weights = phrases.map((row) => Math.max(2, normText(row).length));
  const times: { start: number; end: number }[] = phrases.map(() => ({
    start: t0,
    end: t0,
  }));
  let i = 0;
  let cursor = t0;
  while (i < phrases.length) {
    const hit = hits[i];
    if (hit) {
      const start = Math.min(endAt - 0.12, Math.max(cursor, hit.start));
      const end = Math.min(endAt, Math.max(start + 0.16, hit.end));
      times[i] = { start, end };
      cursor = end;
      i += 1;
      continue;
    }
    let runEnd = i;
    let weight = weights[i] || 2;
    let nextHit = endAt;
    for (let j = i + 1; j < phrases.length; j += 1) {
      const later = hits[j];
      if (later) {
        nextHit = Math.max(cursor, later.start);
        break;
      }
      runEnd = j;
      weight += weights[j] || 2;
    }
    const gap = Math.max(0.16 * (runEnd - i + 1), nextHit - cursor);
    let t = cursor;
    for (let j = i; j <= runEnd; j += 1) {
      const dur = gap * ((weights[j] || 2) / Math.max(1, weight));
      const start = t;
      const end = j === runEnd ? cursor + gap : t + dur;
      times[j] = { start, end: Math.max(start + 0.12, end) };
      t = times[j]?.end ?? t;
    }
    cursor = times[runEnd]?.end ?? cursor;
    i = runEnd + 1;
  }
  return phrases.map((line, idx) => ({
    start: times[idx]?.start ?? t0,
    end: Math.max(times[idx]?.end ?? t0 + 0.16, (times[idx]?.start ?? t0) + 0.12),
    line: wrapCaption(line, 10),
  }));
}

/** 用转写时间轴对准稿：字幕永远用准稿，转写只用来卡开口时间。 */
export function alignCaptionCuesFromAsr(
  shots: VideoShot[],
  durations: number[] | undefined,
  segments: AsrSegment[],
  words?: AsrSegment[],
): CaptionCue[] | null {
  const segs = segments
    .map((row) => ({
      start: Number(row.start) || 0,
      end: Math.max(Number(row.start) || 0, Number(row.end) || 0),
      text: String(row.text || "").trim(),
    }))
    .filter((row) => row.end > row.start && normText(row.text));
  if (!segs.length) return null;
  const spokenRows = (words || [])
    .map((row) => ({
      start: Number(row.start) || 0,
      end: Math.max(Number(row.start) || 0, Number(row.end) || 0),
      text: String(row.text || "").trim(),
    }))
    .filter((row) => row.end > row.start && normText(row.text));
  const chars = flattenSpoken(spokenRows.length ? spokenRows : segs);
  if (!chars.length) return null;

  const cues: CaptionCue[] = [];
  let t = 0;
  let cursor = 0;
  for (const [i, shot] of shots.entries()) {
    const dur = shotDuration(shot, durations, i);
    const shotStart = t;
    const shotEnd = t + dur;
    t += dur;
    const phrases = captionPhrases(captionSource(shot));
    if (!phrases.length) continue;

    const window = segs.filter(
      (row) => overlap(row.start, row.end, shotStart, shotEnd) > 0.08,
    );
    if (!window.length) {
      cues.push(
        ...expandRevealCues([
          { start: shotStart, end: shotEnd, line: captionSource(shot) },
        ]),
      );
      continue;
    }

    const hits: Array<{ start: number; end: number } | null> = [];
    for (const phrase of phrases) {
      const found = findPhraseSpan(
        phrase,
        chars,
        cursor,
        shotStart,
        shotEnd,
      );
      if (found) {
        hits.push({
          start: Math.max(shotStart, found.start),
          end: Math.min(shotEnd, found.end),
        });
        cursor = found.next;
      } else {
        hits.push(null);
      }
    }
    cues.push(...packPhraseTimes(phrases, hits, shotStart, shotEnd));
  }
  return cues.length ? cues : null;
}

async function extractSpeechMp3(video: Buffer): Promise<Buffer | null> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-asr-"));
  try {
    const input = path.join(dir, "in.mp4");
    const output = path.join(dir, "speech.mp3");
    fs.writeFileSync(input, video);
    await execFileAsync(
      resolveFfmpeg(),
      [
        "-y",
        "-i",
        input,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "libmp3lame",
        "-q:a",
        "4",
        output,
      ],
      { timeout: 60_000 },
    );
    if (!fs.existsSync(output)) return null;
    const buf = fs.readFileSync(output);
    return buf.length > 256 ? buf : null;
  } catch (err) {
    console.warn(
      "[video-asr] 抽音频失败：",
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function parseTimedRows(raw: unknown, textKey: string): AsrSegment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const item =
        row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      return {
        start: Number(item.start) || 0,
        end: Number(item.end) || 0,
        text: String(item[textKey] || item.text || ""),
      };
    })
    .filter((row) => row.end > row.start && normText(row.text));
}

function parseTranscript(payload: unknown): {
  segments: AsrSegment[];
  words: AsrSegment[];
} {
  if (!payload || typeof payload !== "object") {
    return { segments: [], words: [] };
  }
  const obj = payload as { segments?: unknown; words?: unknown };
  return {
    segments: parseTimedRows(obj.segments, "text"),
    words: parseTimedRows(obj.words, "word"),
  };
}

function scriptHint(shots: VideoShot[]): string {
  return shots
    .map((shot) => captionSource(shot))
    .filter(Boolean)
    .join("。")
    .slice(0, 220);
}

async function transcribeSpeech(
  mp3: Buffer,
  hint: string,
): Promise<{ segments: AsrSegment[]; words: AsrSegment[] }> {
  const config = resolveOpenAiAsrConfig();
  if (!config) return { segments: [], words: [] };
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(mp3)], { type: "audio/mpeg" }),
    "speech.mp3",
  );
  form.append("model", "whisper-1");
  form.append("language", "zh");
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  if (hint) form.append("prompt", hint);
  const res = await fetch(`${config.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) {
    console.warn("[video-asr] 转写失败：", res.status, text.slice(0, 240));
    return { segments: [], words: [] };
  }
  try {
    return parseTranscript(JSON.parse(text) as unknown);
  } catch {
    console.warn("[video-asr] 转写结果不是分段时间轴");
    return { segments: [], words: [] };
  }
}

/** 从成片音频抽出开口时间，再对准稿。转写失败返回 null，调用方回退字数估算。 */
export async function captionCuesFromVideo(
  video: Buffer,
  shots: VideoShot[],
  durations?: number[],
): Promise<CaptionCue[] | null> {
  if (!resolveOpenAiAsrConfig()) return null;
  const mp3 = await extractSpeechMp3(video);
  if (!mp3) return null;
  const { segments, words } = await transcribeSpeech(mp3, scriptHint(shots));
  if (!segments.length) return null;
  return alignCaptionCuesFromAsr(shots, durations, segments, words);
}
