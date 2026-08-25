import {
  ARTICLE_STILL_IMAGE_GEN_MODEL,
  COVER_IMAGE_GEN_MODEL,
  DEFAULT_IMAGE_GEN_MODEL,
  IMAGE_GEN_MODELS_FALLBACK,
  MAX_IMAGE_REFS_ARK,
  type ImageGenModelOption,
  geminiImageRefCap,
} from "@/lib/ai/image-gen-models-shared";
import {
  defaultCatalogSlug,
  findCatalogImageBySlug,
  listCatalogImageModels,
} from "@/lib/ai/model-catalog/legacy";

export type { ImageGenModelOption, ImageGenProvider } from "@/lib/ai/image-gen-models-shared";
export {
  ARTICLE_STILL_IMAGE_GEN_MODEL,
  COVER_IMAGE_GEN_MODEL,
  DEFAULT_IMAGE_GEN_MODEL,
  IMAGE_GEN_MODELS,
  IMAGE_GEN_MODELS_FALLBACK,
  INFOGRAPHIC_IMAGE_GEN_MODEL,
  IMAGE_MODEL_STORAGE_KEY,
  MAX_IMAGE_REFS_ARK,
  MAX_IMAGE_REFS_GEMINI,
  MAX_IMAGE_REFS_GEMINI_FLASH_25,
  geminiImageRefCap,
  readStoredImageModel,
  writeStoredImageModel,
} from "@/lib/ai/image-gen-models-shared";

export function listImageGenModels(use?: "character" | "infographic" | "cover"): ImageGenModelOption[] {
  const fromCatalog = listCatalogImageModels(use);
  if (fromCatalog.length) return fromCatalog;
  if (use === "infographic" || use === "cover") {
    return IMAGE_GEN_MODELS_FALLBACK.filter((m) => m.id === "gemini-flash");
  }
  if (use === "character") {
    return IMAGE_GEN_MODELS_FALLBACK.filter((m) => m.provider === "ark");
  }
  return [...IMAGE_GEN_MODELS_FALLBACK];
}

export function resolveImageGenModel(id?: string | null): ImageGenModelOption {
  const raw = String(id || "").trim();
  if (raw) {
    const fromCatalog = findCatalogImageBySlug(raw);
    if (fromCatalog) return fromCatalog;
  }
  const pool = listImageGenModels("character");
  return (
    pool.find((row) => row.id === raw) ||
    pool.find((row) => row.id === DEFAULT_IMAGE_GEN_MODEL) ||
    pool[0] ||
    IMAGE_GEN_MODELS_FALLBACK[0]
  );
}

export function resolveInfographicImageModelId(): string {
  return defaultCatalogSlug("image", "infographic", ARTICLE_STILL_IMAGE_GEN_MODEL);
}

export function resolveCoverImageModelId(): string {
  return defaultCatalogSlug("image", "cover", COVER_IMAGE_GEN_MODEL);
}

export function maxImageRefsForModel(id?: string | null): number {
  const picked = resolveImageGenModel(id);
  if (picked.provider === "ark") return MAX_IMAGE_REFS_ARK;
  if (picked.provider === "cloudflare") return 0;
  return geminiImageRefCap(
    picked.model ||
      (typeof process !== "undefined"
        ? process.env.GEMINI_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL
        : ""),
  );
}
