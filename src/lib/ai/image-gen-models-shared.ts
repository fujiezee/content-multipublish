import type { AiModelBadge } from "@/lib/ai/model-catalog/types";

export type ImageGenProvider = "gemini" | "ark" | "cloudflare";

export type ImageGenModelOption = {
  id: string;
  label: string;
  hint: string;
  provider: ImageGenProvider;
  model?: string;
  ready?: boolean;
  cost?: string;
  badges?: AiModelBadge[];
};

/** 硬编码兜底（目录为空或 DB 未就绪） */
export const IMAGE_GEN_MODELS_FALLBACK: ImageGenModelOption[] = [
  {
    id: "seedream-5.0",
    label: "Seedream-5.0",
    hint: "角色图 / 分镜默认",
    provider: "ark",
    model: "doubao-seedream-5-0-260128",
  },
  {
    id: "seedream-4.5",
    label: "Seedream-4.5",
    hint: "更跟指令，须先开通",
    provider: "ark",
    model: "doubao-seedream-4-5-251128",
  },
  {
    id: "seedream-4.0",
    label: "Seedream-4.0",
    hint: "方舟文生图，须先开通",
    provider: "ark",
    model: "doubao-seedream-4-0-250828",
  },
  {
    id: "gemini-flash",
    label: "Gemini 出图",
    hint: "信息图仍用这个",
    provider: "gemini",
  },
];

/** @deprecated 使用 listImageGenModels() */
export const IMAGE_GEN_MODELS = IMAGE_GEN_MODELS_FALLBACK;

export const DEFAULT_IMAGE_GEN_MODEL = "seedream-5.0";
export const ARTICLE_STILL_IMAGE_GEN_MODEL = "gemini-flash";
export const COVER_IMAGE_GEN_MODEL = ARTICLE_STILL_IMAGE_GEN_MODEL;
export const INFOGRAPHIC_IMAGE_GEN_MODEL = ARTICLE_STILL_IMAGE_GEN_MODEL;
export const IMAGE_MODEL_STORAGE_KEY = "dwgeo-image-model-v2";

export const MAX_IMAGE_REFS_ARK = 10;
export const MAX_IMAGE_REFS_GEMINI = 10;
export const MAX_IMAGE_REFS_GEMINI_FLASH_25 = 3;

export function geminiImageRefCap(model?: string | null): number {
  const id = String(model || "").toLowerCase();
  if (id.includes("2.5-flash-image") || id.includes("2.0-flash-image")) {
    return MAX_IMAGE_REFS_GEMINI_FLASH_25;
  }
  return MAX_IMAGE_REFS_GEMINI;
}

function resolveFallbackImageModel(id?: string | null): ImageGenModelOption {
  const raw = String(id || "").trim();
  return (
    IMAGE_GEN_MODELS_FALLBACK.find((row) => row.id === raw) ||
    IMAGE_GEN_MODELS_FALLBACK.find((row) => row.id === DEFAULT_IMAGE_GEN_MODEL) ||
    IMAGE_GEN_MODELS_FALLBACK[0]
  );
}

export function readStoredImageModel(): string {
  if (typeof window === "undefined") return DEFAULT_IMAGE_GEN_MODEL;
  try {
    return resolveFallbackImageModel(
      localStorage.getItem(IMAGE_MODEL_STORAGE_KEY),
    ).id;
  } catch {
    return DEFAULT_IMAGE_GEN_MODEL;
  }
}

export function writeStoredImageModel(id: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      IMAGE_MODEL_STORAGE_KEY,
      resolveFallbackImageModel(id).id,
    );
  } catch {
    // ignore quota / private mode
  }
}
