import {
  COVER_IMAGE_GEN_MODEL,
  DEFAULT_IMAGE_GEN_MODEL,
} from "@/lib/ai/image-gen-models-shared";
import {
  ARK_IMAGE_COST_YUAN,
  ARK_KEYFRAME_PER_SEC_YUAN,
  ARK_VIDEO_COST_YUAN,
  GEMINI_IMAGE_COST_YUAN,
  MENTION_COST_YUAN,
} from "@/lib/ai/model-catalog/ark-prices";
import { apiMarkup, sellFen, yuanToFen } from "@/lib/billing/markup";
import type { QuotaKind, WorkspacePlanView } from "@/lib/billing/types";

/** 官方成本（分）：配图一张 */
export const IMAGE_OFFICIAL_FEN: Record<string, number> = {
  "seedream-4.0": yuanToFen(ARK_IMAGE_COST_YUAN["seedream-4.0"]),
  "seedream-4.5": yuanToFen(ARK_IMAGE_COST_YUAN["seedream-4.5"]),
  "seedream-5.0": yuanToFen(ARK_IMAGE_COST_YUAN["seedream-5.0"]),
  "gemini-flash": yuanToFen(GEMINI_IMAGE_COST_YUAN),
};

/** 官方成本（分）：视频一秒（含关键帧摊销） */
export const VIDEO_OFFICIAL_FEN: Record<string, number> = Object.fromEntries(
  Object.entries(ARK_VIDEO_COST_YUAN).map(([id, yuan]) => [
    id,
    yuanToFen(yuan + ARK_KEYFRAME_PER_SEC_YUAN),
  ]),
);

export const MENTION_OFFICIAL_FEN = yuanToFen(MENTION_COST_YUAN);

export const DEFAULT_IMAGE_METER = COVER_IMAGE_GEN_MODEL;
export const DEFAULT_VIDEO_METER = "seedance-2-mini-480";

/** 静态展示用：默认档 ×1.5 */
const DEFAULT_MARKUP = apiMarkup(0);

export type MeterRate = {
  id: string;
  label: string;
  fen: number;
  unit: string;
};

function officialImageFen(meter?: string | null): number {
  const id = String(meter || DEFAULT_IMAGE_METER);
  return (
    IMAGE_OFFICIAL_FEN[id] ??
    IMAGE_OFFICIAL_FEN[DEFAULT_IMAGE_GEN_MODEL] ??
    yuanToFen(0.22)
  );
}

function officialVideoFen(meter?: string | null): number {
  const id = String(meter || DEFAULT_VIDEO_METER);
  if (VIDEO_OFFICIAL_FEN[id]) return VIDEO_OFFICIAL_FEN[id];
  const fallback = Object.keys(VIDEO_OFFICIAL_FEN).find((key) =>
    id.startsWith(key.replace(/-\d+$/, "")),
  );
  return VIDEO_OFFICIAL_FEN[fallback || DEFAULT_VIDEO_METER] ?? yuanToFen(0.23);
}

export const IMAGE_METER_FEN: Record<string, number> = Object.fromEntries(
  Object.entries(IMAGE_OFFICIAL_FEN).map(([id, fen]) => [
    id,
    sellFen(fen, DEFAULT_MARKUP),
  ]),
);

export const VIDEO_METER_FEN: Record<string, number> = Object.fromEntries(
  Object.entries(VIDEO_OFFICIAL_FEN).map(([id, fen]) => [
    id,
    sellFen(fen, DEFAULT_MARKUP),
  ]),
);

export const MENTION_METER_FEN = Math.max(
  10,
  sellFen(MENTION_OFFICIAL_FEN, DEFAULT_MARKUP),
);

export const IMAGE_METER_LIST: MeterRate[] = [
  { id: "seedream-4.0", label: "Seedream 4.0", fen: IMAGE_METER_FEN["seedream-4.0"], unit: "张" },
  { id: "seedream-4.5", label: "Seedream 4.5", fen: IMAGE_METER_FEN["seedream-4.5"], unit: "张" },
  { id: "seedream-5.0", label: "Seedream 5.0", fen: IMAGE_METER_FEN["seedream-5.0"], unit: "张" },
  { id: "gemini-flash", label: "Gemini 出图", fen: IMAGE_METER_FEN["gemini-flash"], unit: "张" },
];

export const VIDEO_METER_LIST: MeterRate[] = [
  { id: "seedance-2-mini-480", label: "Mini 480p", fen: VIDEO_METER_FEN["seedance-2-mini-480"], unit: "秒" },
  { id: "seedance-2-mini-720", label: "Mini 720p", fen: VIDEO_METER_FEN["seedance-2-mini-720"], unit: "秒" },
  { id: "seedance-2-fast-480", label: "Fast 480p", fen: VIDEO_METER_FEN["seedance-2-fast-480"], unit: "秒" },
  { id: "seedance-2-fast-720", label: "Fast 720p", fen: VIDEO_METER_FEN["seedance-2-fast-720"], unit: "秒" },
  { id: "seedance-2-0-480", label: "2.0 480p", fen: VIDEO_METER_FEN["seedance-2-0-480"], unit: "秒" },
  { id: "seedance-2-0-720", label: "2.0 720p", fen: VIDEO_METER_FEN["seedance-2-0-720"], unit: "秒" },
  { id: "seedance-2-5-480", label: "2.5 480p", fen: VIDEO_METER_FEN["seedance-2-5-480"], unit: "秒" },
  { id: "seedance-2-5-720", label: "2.5 720p", fen: VIDEO_METER_FEN["seedance-2-5-720"], unit: "秒" },
];

/**
 * @param paidYuan 工作区累计充值（元）；不传则按默认 ×1.5
 */
export function usageFen(
  kind: QuotaKind,
  meter?: string | null,
  paidYuan?: number | null,
): number {
  const markup = apiMarkup(paidYuan ?? 0);
  if (kind === "mentions") {
    return Math.max(10, sellFen(MENTION_OFFICIAL_FEN, markup));
  }
  if (kind === "images") {
    return sellFen(officialImageFen(meter), markup);
  }
  if (kind === "videoSeconds") {
    return sellFen(officialVideoFen(meter), markup);
  }
  return 0;
}

export function remainingWithMeter(
  view: WorkspacePlanView | null | undefined,
  kind: QuotaKind,
  meter?: string | null,
): number | "unlimited" | undefined {
  if (!view) return undefined;
  const snap = view.quotas.find((item) => item.kind === kind);
  if (!snap) return undefined;
  const included =
    snap.includedLeft ??
    (snap.cap === "unlimited"
      ? "unlimited"
      : Math.max(0, Number(snap.cap) - snap.used));
  if (included === "unlimited") return "unlimited";
  if (kind === "videoSeconds" && view.planId === "trial") return 0;
  const unit = usageFen(kind, meter, view.paidRechargeYuan ?? 0);
  const extra = unit <= 0 ? 0 : Math.floor(Math.max(0, view.walletFen) / unit);
  return included + extra;
}
