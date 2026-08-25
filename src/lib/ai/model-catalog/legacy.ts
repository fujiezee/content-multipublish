import type { AiModelBadge, AiModelConfig, AiModelView } from "@/lib/ai/model-catalog/types";
import { modelHasBillablePrice } from "@/lib/ai/model-catalog/pricing";
import { listAiModels } from "@/lib/db";

export type LegacyImageModel = {
  id: string;
  label: string;
  hint: string;
  provider: "gemini" | "ark" | "cloudflare";
  model?: string;
  ready?: boolean;
  cost?: string;
  badges?: AiModelBadge[];
};

export type LegacyVideoModel = {
  id: string;
  label: string;
  model: string;
  hint: string;
  generateAudio: boolean;
  resolutions: ("480p" | "720p")[];
  maxSec: number;
  badges?: AiModelBadge[];
};

function imageProvider(channel: AiModelView["provider"]): "gemini" | "ark" | "cloudflare" {
  if (channel === "ark" || channel === "doubao") return "ark";
  if (channel === "cloudflare") return "cloudflare";
  return "gemini";
}

function videoResolutions(config: AiModelConfig): ("480p" | "720p")[] {
  const raw = config.resolutions || ["480p", "720p"];
  return raw.filter((r): r is "480p" | "720p" => r === "480p" || r === "720p");
}

export function catalogToImageOption(model: AiModelView): LegacyImageModel {
  return {
    id: model.slug,
    label: model.label,
    hint: model.hint,
    provider: imageProvider(model.provider),
    badges: model.badges,
    model: model.providerModel,
    ready: model.ready,
    cost: model.costHint,
  };
}

export function catalogToArkVideoOption(model: AiModelView): LegacyVideoModel {
  const resolutions = videoResolutions(model.config);
  return {
    id: model.slug,
    label: model.label,
    model: model.providerModel,
    hint: model.hint,
    generateAudio: model.config.generateAudio !== false,
    resolutions: resolutions.length ? resolutions : ["480p", "720p"],
    maxSec: model.config.maxSec ?? 15,
    badges: model.badges,
  };
}

export function listCatalogImageModels(
  use?: "character" | "infographic" | "cover",
): LegacyImageModel[] {
  try {
    const priced = (rows: ReturnType<typeof listAiModels>) =>
      rows.filter(modelHasBillablePrice);
    const matched = priced(
      listAiModels({
        modality: "image",
        use,
        enabledOnly: true,
      }),
    );
    if (matched.length) return matched.map(catalogToImageOption);
    // 目录里有图但没勾对应用途时，出图下拉仍展示，避免同步进来却看不见
    const all = priced(
      listAiModels({
        modality: "image",
        enabledOnly: true,
      }),
    );
    if (all.length) return all.map(catalogToImageOption);
  } catch {
    // build / edge
  }
  return [];
}

export function listCatalogVideoModels(): LegacyVideoModel[] {
  try {
    const rows = listAiModels({
      modality: "video",
      use: "video",
      enabledOnly: true,
    }).filter(modelHasBillablePrice);
    if (rows.length) return rows.map(catalogToArkVideoOption);
  } catch {
    // build / edge
  }
  return [];
}

export function listCatalogCopywritingModels(): AiModelView[] {
  try {
    return listAiModels({
      modality: "text",
      use: "copywriting",
      enabledOnly: true,
    }).filter(modelHasBillablePrice);
  } catch {
    return [];
  }
}

export function defaultCatalogSlug(
  modality: "text" | "image" | "video",
  use: string,
  fallback: string,
): string {
  try {
    const row = listAiModels({
      modality,
      use: use as never,
      enabledOnly: true,
    }).find((m) => m.ready && modelHasBillablePrice(m));
    if (row) return row.slug;
  } catch {
    // ignore
  }
  return fallback;
}

export function findCatalogImageBySlug(slug: string): LegacyImageModel | undefined {
  try {
    const row = listAiModels({ modality: "image", enabledOnly: false }).find(
      (m) => m.slug === slug,
    );
    return row ? catalogToImageOption(row) : undefined;
  } catch {
    return undefined;
  }
}

export function findCatalogVideoBySlug(slug: string): LegacyVideoModel | undefined {
  try {
    const row = listAiModels({ modality: "video", enabledOnly: false }).find(
      (m) => m.slug === slug || slug.startsWith(`${m.slug}-`),
    );
    return row ? catalogToArkVideoOption(row) : undefined;
  } catch {
    return undefined;
  }
}
