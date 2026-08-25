import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import {
  captionSource,
  expandRevealCues,
  wrapCaption,
  type CaptionCue,
} from "@/lib/ai/caption-reveal";
import {
  defaultFilmCaptionStyle,
  dedupeCues,
  dropRepeatedFlowers,
  filmFontMeta,
  formatFilmTitle,
  parseFilmCaptionStyle,
  type FilmCaptionStyle,
  type FilmFontId,
  type FilmLayerStyle,
} from "@/lib/ai/film-caption-style";
import { captionCuesFromVideo } from "@/lib/ai/video-asr";
import type { VideoShot } from "@/lib/types";

export type { CaptionCue };

const execFileAsync = promisify(execFile);

export function captionCuesFromShots(
  shots: VideoShot[],
  durations?: number[],
): CaptionCue[] {
  let t = 0;
  const cues: CaptionCue[] = [];
  for (const [i, shot] of shots.entries()) {
    const dur = Math.max(
      0.4,
      Number(durations?.[i]) || Number(shot.seconds) || 8,
    );
    const line = captionSource(shot);
    if (line) {
      cues.push({
        start: t,
        end: t + dur,
        line,
      });
    }
    t += dur;
  }
  return cues;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function srtTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const whole = Math.floor(rest);
  const ms = Math.round((rest - whole) * 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(whole)},${String(ms).padStart(3, "0")}`;
}

function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const whole = Math.floor(rest);
  const cs = Math.round((rest - whole) * 100);
  return `${h}:${pad2(m)}:${pad2(whole)}.${String(cs).padStart(2, "0")}`;
}

export function cuesToSrt(cues: CaptionCue[]): string {
  return cues
    .map((cue, i) => {
      const body = [cue.punch, cue.line].filter(Boolean).join("\n");
      return `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${body}\n`;
    })
    .join("\n");
}

function escapeAss(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n/g, "\\N");
}

function hexToAss(hex: string): string {
  const raw = hex.replace("#", "");
  return `&H00${raw.slice(4, 6)}${raw.slice(2, 4)}${raw.slice(0, 2)}`.toUpperCase();
}

function assStyleLine(name: string, layer: FilmLayerStyle): string {
  const font = filmFontMeta(layer.font).ass;
  return `Style: ${name},${font},${Math.round(layer.size)},${hexToAss(layer.color)},&H000000FF,${hexToAss(layer.stroke)},&H80000000,-1,0,0,0,100,100,${name === "Title" ? 6 : 2},0,1,5,0,5,28,28,0,1`;
}

function assDialogue(
  cue: CaptionCue,
  styleName: string,
  layer: FilmLayerStyle,
): string {
  const body = [cue.punch, cue.line].filter(Boolean).join("\\N");
  const x = Math.round((720 * (layer.x ?? 50)) / 100);
  const y = Math.round((1280 * layer.y) / 100);
  return `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},${styleName},,0,0,0,,{\\pos(${x},${y})}${escapeAss(body)}`;
}

export function flowerCuesFromShots(
  shots: VideoShot[],
  durations?: number[],
): CaptionCue[] {
  let t = 0;
  const cues: CaptionCue[] = [];
  for (const [i, shot] of shots.entries()) {
    const dur = Math.max(
      0.4,
      Number(durations?.[i]) || Number(shot.seconds) || 8,
    );
    const line = String(shot.onScreen || "").replace(/\s+/g, "").trim();
    if (line && !/特写|慢镜|镜头|近景|全景|俯拍|侧拍/.test(line)) {
      cues.push({
        start: t,
        end: t + dur,
        line: wrapCaption(line, 8),
      });
    }
    t += dur;
  }
  return cues;
}

export async function resolveCaptionCues(
  video: Buffer,
  shots: VideoShot[],
  durations?: number[],
): Promise<CaptionCue[]> {
  const estimated = expandRevealCues(captionCuesFromShots(shots, durations));
  const aligned = await captionCuesFromVideo(video, shots, durations);
  return aligned?.length ? aligned : estimated;
}

export function cuesToAss(
  cues: CaptionCue[],
  opts?: {
    title?: string;
    durationSec?: number;
    style?: FilmCaptionStyle;
    flowers?: CaptionCue[];
  },
): string {
  const style = opts?.style || defaultFilmCaptionStyle(opts?.title || "");
  const duration = Math.max(0.4, opts?.durationSec || 0);
  const title = style.title.on
    ? formatFilmTitle(style.title.text || opts?.title || "")
    : "";
  const lines = [
    title
      ? assDialogue(
          { start: 0, end: duration, line: title },
          "Title",
          style.title,
        )
      : "",
    ...(style.caption.on
      ? cues.map((cue) => assDialogue(cue, "Default", style.caption))
      : []),
    ...(style.flower.on
      ? (opts?.flowers || []).map((cue) =>
          assDialogue(cue, "Flower", style.flower),
        )
      : []),
  ].filter(Boolean);
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${assStyleLine("Default", style.caption)}
${assStyleLine("Title", style.title)}
${assStyleLine("Flower", style.flower)}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join("\n")}
`;
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

function resolveMagick(): string | null {
  for (const candidate of [
    "/opt/homebrew/bin/magick",
    "/usr/local/bin/magick",
    "/opt/homebrew/bin/convert",
    "/usr/local/bin/convert",
    "/usr/bin/convert",
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const FONT_FILES: Record<FilmFontId, string[]> = {
  heiti: [
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
  ],
  songti: [
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
  ],
  kaiti: [
    "/System/Library/Fonts/Supplemental/Kaiti.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
  ],
  pingfang: [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
  ],
};

function resolveFontFile(id: FilmFontId): string {
  for (const candidate of [
    ...FONT_FILES[id],
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "Helvetica";
}

function assFontsDir(): string | null {
  const dir = "/System/Library/Fonts/Supplemental";
  return fs.existsSync(path.join(dir, "Songti.ttc")) ? dir : null;
}

async function renderStyledPng(
  text: string,
  dest: string,
  magick: string,
  layer: FilmLayerStyle,
  box: string,
): Promise<void> {
  const bodyFile = `${dest}.txt`;
  fs.writeFileSync(bodyFile, text, "utf8");
  const font = resolveFontFile(layer.font);
  await execFileAsync(
    magick,
    [
      "-size",
      box,
      "xc:none",
      "-colorspace",
      "sRGB",
      "-font",
      font,
      "-pointsize",
      String(Math.round(layer.size)),
      "-gravity",
      "center",
      "-stroke",
      layer.stroke,
      "-strokewidth",
      String(Math.max(6, Math.round(layer.size / 8))),
      "-fill",
      layer.stroke,
      "-annotate",
      "+0+0",
      `@${bodyFile}`,
      "-stroke",
      "none",
      "-fill",
      layer.color,
      "-annotate",
      "+0+0",
      `@${bodyFile}`,
      `PNG32:${dest}`,
    ],
    { timeout: 20_000 },
  );
}

type BurnOpts = {
  title?: string;
  durationSec?: number;
  style?: FilmCaptionStyle;
  flowers?: CaptionCue[];
};

function overlayX(layer: FilmLayerStyle): string {
  return `W*${((layer.x ?? 50) / 100).toFixed(3)}-w/2`;
}

function overlayY(layer: FilmLayerStyle): string {
  return `H*${(layer.y / 100).toFixed(3)}-h/2`;
}

async function burnWithAss(
  dir: string,
  cues: CaptionCue[],
  opts?: BurnOpts,
): Promise<boolean> {
  fs.writeFileSync(path.join(dir, "caps.ass"), cuesToAss(cues, opts), "utf8");
  const fonts = assFontsDir();
  const vf = fonts
    ? `ass=caps.ass:fontsdir=${fonts.replace(/\\/g, "/").replace(/:/g, "\\:")}`
    : "ass=caps.ass";
  try {
    await execFileAsync(
      resolveFfmpeg(),
      [
        "-y",
        "-i",
        "in.mp4",
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "out.mp4",
      ],
      { timeout: 180_000, cwd: dir },
    );
    return fs.existsSync(path.join(dir, "out.mp4"));
  } catch {
    return false;
  }
}

async function burnWithPngOverlay(
  dir: string,
  cues: CaptionCue[],
  opts?: BurnOpts,
): Promise<boolean> {
  const magick = resolveMagick();
  if (!magick) return false;
  const style = opts?.style || defaultFilmCaptionStyle(opts?.title || "");
  const duration = Math.max(0.4, opts?.durationSec || 0);
  type Item = { file: string; start: number; end: number; x: string; y: string };
  const items: Item[] = [];
  const cache = new Map<string, string>();
  const addCue = async (
    cue: CaptionCue,
    layer: FilmLayerStyle,
    prefix: string,
    box: string,
  ) => {
    if (!layer.on || !cue.line.trim()) return;
    const key = `${prefix}:${layer.font}:${layer.size}:${layer.color}:${layer.stroke}:${cue.line}`;
    let file = cache.get(key);
    if (!file) {
      file = path.join(dir, `${prefix}-${String(cache.size).padStart(3, "0")}.png`);
      await renderStyledPng(cue.line, file, magick, layer, box);
      if (!fs.existsSync(file)) return;
      cache.set(key, file);
    }
    items.push({
      file,
      start: cue.start,
      end: cue.end,
      x: overlayX(layer),
      y: overlayY(layer),
    });
  };
  const title = style.title.on
    ? formatFilmTitle(style.title.text || opts?.title || "")
    : "";
  if (title) {
    await addCue(
      { start: 0, end: duration, line: title },
      style.title,
      "title",
      "700x140",
    );
  }
  if (style.caption.on) {
    for (const cue of cues) await addCue(cue, style.caption, "cap", "700x240");
  }
  if (style.flower.on) {
    for (const cue of opts?.flowers || []) {
      await addCue(cue, style.flower, "flower", "680x200");
    }
  }
  if (items.length === 0) return false;
  const unique = [...new Set(items.map((row) => row.file))];
  const inputs = ["-y", "-i", path.join(dir, "in.mp4")];
  for (const file of unique) inputs.push("-i", file);
  const inputIndex = new Map(unique.map((file, i) => [file, i + 1]));
  let last = "0:v";
  const filters: string[] = [];
  for (const [i, item] of items.entries()) {
    const src = inputIndex.get(item.file) || 1;
    const next = i === items.length - 1 ? "vout" : `v${i}`;
    filters.push(
      `[${last}][${src}:v]overlay=x=${item.x}:y=${item.y}:enable='between(t,${item.start.toFixed(3)},${item.end.toFixed(3)})'[${next}]`,
    );
    last = next;
  }
  await execFileAsync(
    resolveFfmpeg(),
    [
      ...inputs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[vout]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      path.join(dir, "out.mp4"),
    ],
    { timeout: 180_000 },
  );
  return fs.existsSync(path.join(dir, "out.mp4"));
}

export type BurnCaptionsResult = {
  buffer: Buffer;
  cues: CaptionCue[];
  flowers: CaptionCue[];
};

/** 把分镜字幕烧进成片。优先按成片开口时间对轴，对不上再按字数估。烧不上才原样返回。 */
export async function burnShotCaptions(
  video: Buffer,
  shots: VideoShot[],
  durations?: number[],
  opts?: {
    title?: string;
    style?: FilmCaptionStyle | string | null;
    cues?: CaptionCue[];
    flowers?: CaptionCue[];
  },
): Promise<BurnCaptionsResult> {
  const style =
    typeof opts?.style === "string" || opts?.style == null
      ? parseFilmCaptionStyle(typeof opts?.style === "string" ? opts.style : "", opts?.title || "")
      : opts.style;
  const cues = dedupeCues(
    opts?.cues?.length
      ? opts.cues
      : await resolveCaptionCues(video, shots, durations),
  );
  const flowers = dropRepeatedFlowers(
    dedupeCues(
      opts?.flowers?.length
        ? opts.flowers
        : flowerCuesFromShots(shots, durations),
    ),
    cues,
  );
  const empty =
    cues.length === 0 &&
    flowers.length === 0 &&
    !formatFilmTitle(style.title.text || opts?.title || "");
  if (empty) return { buffer: video, cues, flowers };
  const durationSec =
    durations?.reduce((sum, n) => sum + Math.max(0, Number(n) || 0), 0) ||
    shots.reduce((sum, shot) => sum + Math.max(0.4, Number(shot.seconds) || 8), 0);
  const burnOpts: BurnOpts = {
    title: opts?.title,
    durationSec,
    style,
    flowers,
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-cap-"));
  try {
    fs.writeFileSync(path.join(dir, "in.mp4"), video);
    const burned =
      (await burnWithPngOverlay(dir, cues, burnOpts)) ||
      (await burnWithAss(dir, cues, burnOpts));
    if (!burned) {
      console.warn("[video-captions] 烧字幕跳过：当前环境没有可用的字幕滤镜");
      return { buffer: video, cues, flowers };
    }
    return { buffer: fs.readFileSync(path.join(dir, "out.mp4")), cues, flowers };
  } catch (err) {
    console.warn(
      "[video-captions] 烧字幕跳过：",
      err instanceof Error ? err.message : err,
    );
    return { buffer: video, cues, flowers };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
