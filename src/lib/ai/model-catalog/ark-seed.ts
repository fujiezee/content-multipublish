import type {
  AiModelInput,
  AiModelUse,
  AiModality,
  AiProviderChannel,
} from "@/lib/ai/model-catalog/types";
import {
  costHintFromOfficial,
  lookupArkOfficialPricing,
} from "@/lib/ai/model-catalog/ark-prices";
import { shouldSkipSyncImport } from "@/lib/ai/model-catalog/discontinued";
import { resolveDoubaoConfig } from "@/lib/ai/doubao";

export {
  ARK_IMAGE_COST_YUAN,
  ARK_KEYFRAME_PER_SEC_YUAN,
  ARK_VIDEO_COST_YUAN,
  GEMINI_IMAGE_COST_YUAN,
  MENTION_COST_YUAN,
  costHintFromOfficial,
  lookupArkOfficialPricing,
} from "@/lib/ai/model-catalog/ark-prices";

function inferArkModality(id: string): AiModality {
  if (/seedream|seededit|image/i.test(id)) return "image";
  if (/seedance|video/i.test(id)) return "video";
  if (/tts|speech|voice/i.test(id)) return "audio";
  return "text";
}

function inferArkUses(modality: AiModality): AiModelUse[] {
  if (modality === "image") return ["character", "cover", "infographic"];
  if (modality === "video") return ["video"];
  if (modality === "audio") return ["tts"];
  return ["copywriting", "script", "shot"];
}

function inferProvider(id: string): AiProviderChannel {
  if (/seedream|seedance|tts/i.test(id)) return "ark";
  return "doubao";
}

function arkStrengthHint(id: string, modality: AiModality): string {
  const n = id.toLowerCase();
  if (modality === "image") {
    if (/seedream/.test(n)) return "画质细，适合成品角色图";
    return "按提示出图，画风好控";
  }
  if (modality === "video") {
    if (/seedance/.test(n) && /mini/.test(n)) return "能直接出声，适合短片试看";
    if (/seedance/.test(n)) return "动作自然，能跟参考";
    return "按提示出短视频";
  }
  if (modality === "audio") return "配音自然";
  if (/seed/.test(n)) return "国内延迟低，适合写稿";
  return "中文对白自然";
}

function prettyLabel(id: string): string {
  return id
    .replace(/^doubao-/i, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** 同步拉到的模型 → 目录输入；已知刊例则带上 pricing */
export function arkModelIdToInput(rawId: string): AiModelInput | null {
  const id = rawId.trim();
  if (!id) return null;
  if (/embedding|moderation|rerank/i.test(id)) return null;
  if (shouldSkipSyncImport(id, "ark")) return null;

  const modality = inferArkModality(id);
  const pricing = lookupArkOfficialPricing(id);
  if (!pricing) return null;

  return {
    slug: id,
    label: prettyLabel(id),
    hint: arkStrengthHint(id, modality),
    modality,
    uses: inferArkUses(modality),
    provider: inferProvider(id),
    providerModel: id,
    config: pricing
      ? { pricing: { ...pricing, syncedAt: new Date().toISOString() } }
      : undefined,
    costHint: costHintFromOfficial(pricing) || "方舟",
    sortOrder: 200,
    enabled: Boolean(pricing) && modality !== "text" ? true : false,
  };
}

export async function fetchArkModelIds(): Promise<string[]> {
  let stored: { apiKey?: string; model?: string } | undefined;
  try {
    const { getDoubaoStoredSecret } = await import("@/lib/db");
    stored = getDoubaoStoredSecret();
  } catch {
    stored = undefined;
  }
  const config = resolveDoubaoConfig(stored);
  if (!config?.apiKey) {
    throw new Error("未配置 ARK_API_KEY / 查排名页方舟 Key");
  }
  const res = await fetch(`${config.baseUrl}/models`, {
    headers: { authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`方舟 /models 失败 (${res.status})`);
  }
  const json = (await res.json()) as {
    data?: Array<{ id?: string; status?: string }>;
  };
  const ids: string[] = [];
  for (const row of json.data ?? []) {
    const id = row.id?.trim() || "";
    if (!id) continue;
    const status = (row.status || "").toLowerCase();
    if (status === "shutdown") continue;
    ids.push(id);
  }
  return [...new Set(ids)];
}
