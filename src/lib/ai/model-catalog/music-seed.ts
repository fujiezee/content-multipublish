import type { AiModelInput } from "@/lib/ai/model-catalog/types";

/**
 * 点悟 music（dianwu.ai / music）已接的 Suno 音乐生成模型。
 * 上游：sunoapi.org（默认）或自托管 gcui；与 dianwu functions/lib/suno-client.ts 对齐。
 */
export const MUSIC_AI_MODEL_SEED: AiModelInput[] = [
  {
    slug: "suno-v5",
    label: "Suno V5",
    hint: "默认 · 完整成曲约 90 秒起（汽水至少 1 分钟）",
    modality: "music",
    uses: ["music"],
    provider: "suno",
    providerModel: "V5",
    costHint: "按次",
    sortOrder: 10,
    enabled: true,
    badges: ["recommended"],
  },
  {
    slug: "suno-v5-5",
    label: "Suno V5.5",
    hint: "可指定时长（约 90 秒）· 汽水上架更稳",
    modality: "music",
    uses: ["music"],
    provider: "suno",
    providerModel: "V5_5",
    costHint: "sunoapi",
    sortOrder: 20,
    enabled: true,
  },
  {
    slug: "suno-v4-5-plus",
    label: "Suno V4.5+",
    hint: "更丰满，最长约 8 分钟",
    modality: "music",
    uses: ["music"],
    provider: "suno",
    providerModel: "V4_5PLUS",
    costHint: "sunoapi",
    sortOrder: 30,
    enabled: false,
  },
  {
    slug: "suno-v4-5",
    label: "Suno V4.5",
    hint: "提示词更聪明，最长约 8 分钟",
    modality: "music",
    uses: ["music"],
    provider: "suno",
    providerModel: "V4_5",
    costHint: "sunoapi",
    sortOrder: 40,
    enabled: false,
  },
  {
    slug: "suno-v4-5-all",
    label: "Suno V4.5 All",
    hint: "结构更稳，最长约 8 分钟",
    modality: "music",
    uses: ["music"],
    provider: "suno",
    providerModel: "V4_5ALL",
    costHint: "sunoapi",
    sortOrder: 50,
    enabled: false,
  },
  {
    slug: "suno-v4",
    label: "Suno V4",
    hint: "音质扎实，最长约 4 分钟",
    modality: "music",
    uses: ["music"],
    provider: "suno",
    providerModel: "V4",
    costHint: "sunoapi",
    sortOrder: 60,
    enabled: false,
  },
];

export function resolveSunoApiKey(): string {
  return process.env.SUNO_API_KEY?.trim() || "";
}

export function resolveSunoApiBase(): string {
  return (
    process.env.SUNO_API_BASE_URL?.trim() || "https://api.sunoapi.org"
  ).replace(/\/$/, "");
}

/** sunoapi 走 Key；gcui 自托管只看 SUNO_API_URL */
export function hasSunoReady(): boolean {
  const provider = (process.env.SUNO_PROVIDER || "sunoapi").toLowerCase();
  if (provider === "gcui") {
    return Boolean(process.env.SUNO_API_URL?.trim());
  }
  return Boolean(resolveSunoApiKey());
}
