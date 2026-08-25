import {
  captionSource,
  expandRevealCues,
  wrapCaption,
  type CaptionCue,
} from "@/lib/ai/caption-reveal";
import type { VideoShot } from "@/lib/types";

export const FILM_FONT_IDS = ["heiti", "songti", "kaiti", "pingfang"] as const;
export type FilmFontId = (typeof FILM_FONT_IDS)[number];

export type FilmLayerId = "title" | "caption" | "flower";

export type FilmLayerStyle = {
  text: string;
  font: FilmFontId;
  size: number;
  color: string;
  stroke: string;
  x: number;
  y: number;
  on: boolean;
};

export type FilmCaptionStyle = {
  title: FilmLayerStyle;
  caption: FilmLayerStyle;
  flower: FilmLayerStyle;
};

export type FilmCaptionCues = {
  captions: CaptionCue[];
  flowers: CaptionCue[];
};

export const FILM_FONT_OPTIONS: Array<{
  id: FilmFontId;
  label: string;
  ass: string;
  css: string;
}> = [
  { id: "heiti", label: "黑体", ass: "Heiti SC", css: '"Heiti SC", "PingFang SC", sans-serif' },
  { id: "songti", label: "宋体", ass: "Songti SC", css: '"Songti SC", "STSong", serif' },
  { id: "kaiti", label: "楷体", ass: "Kaiti SC", css: '"Kaiti SC", "STKaiti", "Songti SC", serif' },
  { id: "pingfang", label: "苹方", ass: "PingFang SC", css: '"PingFang SC", "Heiti SC", sans-serif' },
];

export const FILM_COLOR_PRESETS = [
  { id: "white", label: "白", value: "#FFFFFF" },
  { id: "warm", label: "暖白", value: "#F8F4EC" },
  { id: "gold", label: "金", value: "#F5D76E" },
  { id: "red", label: "红", value: "#FF4D4F" },
];

const LAYER_LIMITS: Record<
  FilmLayerId,
  { size: [number, number]; x: [number, number]; y: [number, number] }
> = {
  title: { size: [32, 64], x: [8, 92], y: [4, 94] },
  caption: { size: [44, 80], x: [8, 92], y: [4, 94] },
  flower: { size: [36, 72], x: [8, 92], y: [4, 94] },
};

export function formatFilmTitle(name: string): string {
  const raw = String(name || "")
    .replace(/[《》]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!raw) return "";
  return `《${raw.slice(0, 16)}》`;
}

export function defaultFilmCaptionStyle(title = ""): FilmCaptionStyle {
  return {
    title: {
      text: title.replace(/[《》]/g, "").trim().slice(0, 16),
      font: "songti",
      size: 46,
      color: "#F8F4EC",
      stroke: "#222222",
      x: 50,
      y: 6,
      on: true,
    },
    caption: {
      text: "",
      font: "heiti",
      size: 64,
      color: "#FFFFFF",
      stroke: "#111111",
      x: 50,
      y: 86,
      on: true,
    },
    flower: {
      text: "",
      font: "kaiti",
      size: 52,
      color: "#F5D76E",
      stroke: "#2A1A00",
      x: 50,
      y: 28,
      on: true,
    },
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function asHex(raw: unknown, fallback: string): string {
  const text = String(raw || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toUpperCase() : fallback;
}

function asFont(raw: unknown, fallback: FilmFontId): FilmFontId {
  return FILM_FONT_IDS.includes(raw as FilmFontId)
    ? (raw as FilmFontId)
    : fallback;
}

function parseLayer(
  raw: unknown,
  fallback: FilmLayerStyle,
  id: FilmLayerId,
): FilmLayerStyle {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const limits = LAYER_LIMITS[id];
  return {
    text: String(row.text ?? fallback.text).trim().slice(0, 24),
    font: asFont(row.font, fallback.font),
    size: clamp(Number(row.size) || fallback.size, limits.size[0], limits.size[1]),
    color: asHex(row.color, fallback.color),
    stroke: asHex(row.stroke, fallback.stroke),
    x: clamp(
      Number.isFinite(Number(row.x)) ? Number(row.x) : fallback.x,
      limits.x[0],
      limits.x[1],
    ),
    y: clamp(
      Number.isFinite(Number(row.y)) ? Number(row.y) : fallback.y,
      limits.y[0],
      limits.y[1],
    ),
    on: row.on === undefined ? fallback.on : row.on !== false,
  };
}

export function parseFilmCaptionStyle(
  raw: string | null | undefined,
  title = "",
): FilmCaptionStyle {
  const fallback = defaultFilmCaptionStyle(title);
  if (!raw?.trim()) return fallback;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      title: parseLayer(parsed.title, fallback.title, "title"),
      caption: parseLayer(parsed.caption, fallback.caption, "caption"),
      flower: parseLayer(parsed.flower, fallback.flower, "flower"),
    };
  } catch {
    return fallback;
  }
}

export function filmCaptionStyleToJson(style: FilmCaptionStyle): string {
  return JSON.stringify(style);
}

function parseCue(raw: unknown): CaptionCue | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const line = String(row.line || "").trim();
  const start = Number(row.start);
  const end = Number(row.end);
  if (!line || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return {
    start,
    end,
    line: line.slice(0, 40),
    ...(typeof row.punch === "string" && row.punch.trim()
      ? { punch: row.punch.trim().slice(0, 24) }
      : {}),
  };
}

export function parseFilmCaptionCues(
  raw: string | null | undefined,
): FilmCaptionCues {
  if (!raw?.trim()) return { captions: [], flowers: [] };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return {
        captions: parsed.map(parseCue).filter((row): row is CaptionCue => Boolean(row)),
        flowers: [],
      };
    }
    const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const captions = Array.isArray(obj.captions) ? obj.captions : [];
    const flowers = Array.isArray(obj.flowers) ? obj.flowers : [];
    return {
      captions: captions.map(parseCue).filter((row): row is CaptionCue => Boolean(row)),
      flowers: flowers.map(parseCue).filter((row): row is CaptionCue => Boolean(row)),
    };
  } catch {
    return { captions: [], flowers: [] };
  }
}

export function filmCaptionCuesToJson(cues: FilmCaptionCues): string {
  return JSON.stringify({
    captions: cues.captions,
    flowers: cues.flowers,
  });
}

export function filmFontMeta(id: FilmFontId) {
  return FILM_FONT_OPTIONS.find((row) => row.id === id) || FILM_FONT_OPTIONS[0];
}

function normCueLine(text: string): string {
  return String(text || "")
    .replace(/\s+/g, "")
    .replace(/[《》「」""]/g, "")
    .trim();
}

function cueOverlap(a: CaptionCue, b: CaptionCue): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

export function dedupeCues(cues: CaptionCue[]): CaptionCue[] {
  const sorted = [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: CaptionCue[] = [];
  for (const cue of sorted) {
    const line = normCueLine(cue.line);
    if (!line) continue;
    const prev = out[out.length - 1];
    if (prev && normCueLine(prev.line) === line && cue.start <= prev.end + 0.12) {
      prev.end = Math.max(prev.end, cue.end);
      continue;
    }
    if (
      out.some(
        (row) =>
          normCueLine(row.line) === line && cueOverlap(row, cue) > 0.16,
      )
    ) {
      continue;
    }
    out.push({ ...cue, line: cue.line.trim() });
  }
  return out;
}

export function dropRepeatedFlowers(
  flowers: CaptionCue[],
  captions: CaptionCue[],
): CaptionCue[] {
  return flowers.filter((flower) => {
    const line = normCueLine(flower.line);
    if (!line) return false;
    return !captions.some((caption) => {
      if (cueOverlap(flower, caption) < 0.2) return false;
      const spoken = normCueLine(caption.line);
      return spoken === line || spoken.includes(line) || line.includes(spoken);
    });
  });
}

export function cueAtTime(cues: CaptionCue[], time: number): CaptionCue | null {
  const hits = cues.filter((cue) => time >= cue.start && time < cue.end);
  if (!hits.length) return null;
  return hits.sort((a, b) => a.end - a.start - (b.end - b.start))[0] || null;
}

export function layerLimits(id: FilmLayerId) {
  return LAYER_LIMITS[id];
}

export function clampLayerPos(id: FilmLayerId, x: number, y: number) {
  const limits = LAYER_LIMITS[id];
  return {
    x: clamp(x, limits.x[0], limits.x[1]),
    y: clamp(y, limits.y[0], limits.y[1]),
  };
}

export function estimateFilmCues(
  shots: VideoShot[],
  durations?: number[],
): FilmCaptionCues {
  let t = 0;
  const raw: CaptionCue[] = [];
  const flowers: CaptionCue[] = [];
  for (const [i, shot] of shots.entries()) {
    const dur = Math.max(
      0.4,
      Number(durations?.[i]) || Number(shot.seconds) || 8,
    );
    const spoken = captionSource(shot);
    if (spoken) raw.push({ start: t, end: t + dur, line: spoken });
    const flower = String(shot.onScreen || "").replace(/\s+/g, "").trim();
    if (flower && !/特写|慢镜|镜头|近景|全景|俯拍|侧拍/.test(flower)) {
      flowers.push({ start: t, end: t + dur, line: wrapCaption(flower, 8) });
    }
    t += dur;
  }
  const captions = dedupeCues(expandRevealCues(raw));
  return {
    captions,
    flowers: dropRepeatedFlowers(dedupeCues(flowers), captions),
  };
}
