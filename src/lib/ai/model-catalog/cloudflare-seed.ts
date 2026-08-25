import type {
  AiModelInput,
  AiModelPricingConfig,
  AiModelUse,
  AiModality,
} from "@/lib/ai/model-catalog/types";
import { costHintFromOfficial } from "@/lib/ai/model-catalog/ark-prices";
import { shouldSkipSyncImport } from "@/lib/ai/model-catalog/discontinued";

/** USD → 人民币分（刊例按 7.2 汇率，取整到分） */
const USD_CNY = 7.2;

export function resolveCloudflareAccountId(): string {
  return (
    process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ||
    process.env.CF_ACCOUNT_ID?.trim() ||
    "4bdb28422653f9ac6aee3868f8ef3962"
  );
}

export function resolveCloudflareAiToken(): string {
  return (
    process.env.CLOUDFLARE_AI_TOKEN?.trim() ||
    process.env.CLOUDFLARE_API_TOKEN?.trim() ||
    ""
  );
}

export function resolveCloudflareAiOpenAiBase(): string {
  const account = resolveCloudflareAccountId();
  if (!account) return "";
  return `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`;
}

export function hasCloudflareAiReady(): boolean {
  return Boolean(resolveCloudflareAiToken() && resolveCloudflareAccountId());
}

function usdToFen(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.max(1, Math.round(usd * USD_CNY * 100));
}

export function cfModelSlug(providerModel: string): string {
  return providerModel
    .trim()
    .replace(/^@(cf|hf)\//i, "")
    .replace(/[/@]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

type CfSeed = {
  id: string;
  label: string;
  hint: string;
  uses?: AiModelUse[];
  sortOrder: number;
  enabled?: boolean;
  fallbackSlug?: string;
  inputUsd: number;
  outputUsd: number;
};

/** 精选 Workers AI 文本模型（有刊例、能走 OpenAI 兼容 chat） */
const CF_TEXT: CfSeed[] = [
  {
    id: "@cf/zai-org/glm-4.7-flash",
    label: "GLM-4.7 Flash",
    hint: "又快又便宜，适合改稿和分镜",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 10,
    fallbackSlug: "cf-zai-org-glm-5.2",
    inputUsd: 0.0605,
    outputUsd: 0.4,
  },
  {
    id: "@cf/zai-org/glm-5.2",
    label: "GLM-5.2",
    hint: "写代码和长任务稳，中文自然",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 20,
    fallbackSlug: "cf-zai-org-glm-4.7-flash",
    inputUsd: 1.4,
    outputUsd: 4.4,
  },
  {
    id: "@cf/qwen/qwen3.8-27b",
    label: "Qwen 3.8 27B",
    hint: "中文理解好，适合写稿",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 30,
    fallbackSlug: "cf-qwen-qwen3-30b-a3b-fp8",
    inputUsd: 0.45,
    outputUsd: 3.2,
  },
  {
    id: "@cf/qwen/qwen3-30b-a3b-fp8",
    label: "Qwen3 30B",
    hint: "便宜够用，适合大批量分镜",
    uses: ["shot", "copywriting"],
    sortOrder: 40,
    inputUsd: 0.0509,
    outputUsd: 0.335,
  },
  {
    id: "@cf/google/gemma-4-26b-a4b-it",
    label: "Gemma 4 26B",
    hint: "多模态，能看图再写",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 50,
    inputUsd: 0.1,
    outputUsd: 0.3,
  },
  {
    id: "@cf/openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    hint: "开源大模型，推理和写作均衡",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 60,
    fallbackSlug: "cf-openai-gpt-oss-20b",
    inputUsd: 0.35,
    outputUsd: 0.75,
  },
  {
    id: "@cf/openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    hint: "更小更快，适合短任务",
    uses: ["shot", "copywriting"],
    sortOrder: 70,
    inputUsd: 0.2,
    outputUsd: 0.3,
  },
  {
    id: "@cf/meta/llama-4-scout-17b-16e-instruct",
    label: "Llama 4 Scout",
    hint: "能看图，适合带参考的分镜",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 80,
    fallbackSlug: "cf-meta-llama-3.3-70b-instruct-fp8-fast",
    inputUsd: 0.27,
    outputUsd: 0.85,
  },
  {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    label: "Llama 3.3 70B",
    hint: "指令跟随稳，适合对白",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 90,
    inputUsd: 0.293,
    outputUsd: 2.253,
  },
  {
    id: "@cf/deepseek-ai/deepseek-v4-flash-0731",
    label: "DeepSeek V4 Flash",
    hint: "又快又便宜，适合改稿和分镜",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 100,
    fallbackSlug: "cf-deepseek-ai-deepseek-v4-pro-0813",
    inputUsd: 0.44,
    outputUsd: 1.32,
  },
  {
    id: "@cf/deepseek-ai/deepseek-v4-pro-0813",
    label: "DeepSeek V4 Pro",
    hint: "推理更深，适合难稿",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 110,
    inputUsd: 1.32,
    outputUsd: 3.96,
  },
  {
    id: "@cf/moonshotai/kimi-k2.6",
    label: "Kimi K2.6",
    hint: "超长上下文，适合长文一次写完",
    uses: ["script", "copywriting"],
    sortOrder: 120,
    inputUsd: 0.95,
    outputUsd: 4,
  },
  {
    id: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    label: "Mistral Small 3.1",
    hint: "又快又稳，适合短对白",
    uses: ["shot", "copywriting"],
    sortOrder: 130,
    inputUsd: 0.351,
    outputUsd: 0.555,
  },
];

type CfImageSeed = {
  id: string;
  label: string;
  hint: string;
  sortOrder: number;
  imageUsd: number;
};

const CF_IMAGE: CfImageSeed[] = [
  {
    id: "@cf/black-forest-labs/flux-1-schnell",
    label: "FLUX.1 Schnell",
    hint: "出图快，适合打草稿和批量",
    sortOrder: 10,
    imageUsd: 0.003,
  },
  {
    id: "@cf/black-forest-labs/flux-2-dev",
    label: "FLUX.2 Dev",
    hint: "画质更好，指令跟得紧",
    sortOrder: 20,
    imageUsd: 0.01,
  },
  {
    id: "@cf/black-forest-labs/flux-2-klein-9b",
    label: "FLUX.2 Klein 9B",
    hint: "画质和速度折中，适合角色图",
    sortOrder: 30,
    imageUsd: 0.006,
  },
  {
    id: "@cf/black-forest-labs/flux-2-klein-4b",
    label: "FLUX.2 Klein 4B",
    hint: "更快更便宜，适合试构图",
    sortOrder: 35,
    imageUsd: 0.004,
  },
  {
    id: "@cf/leonardo/lucid-origin",
    label: "Lucid Origin",
    hint: "人物皮肤和光感更自然",
    sortOrder: 40,
    imageUsd: 0.007,
  },
  {
    id: "@cf/leonardo/phoenix-1.0",
    label: "Phoenix 1.0",
    hint: "色彩浓、适合海报感画面",
    sortOrder: 50,
    imageUsd: 0.00583,
  },
  {
    id: "@cf/bytedance/stable-diffusion-xl-lightning",
    label: "SDXL Lightning",
    hint: "出图快，构图稳",
    sortOrder: 60,
    imageUsd: 0.003,
  },
  {
    id: "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    label: "SDXL Base",
    hint: "泛用出图，风格好控",
    sortOrder: 70,
    imageUsd: 0.003,
  },
  {
    id: "@cf/lykon/dreamshaper-8-lcm",
    label: "Dreamshaper 8",
    hint: "插画和二次元更顺",
    sortOrder: 80,
    imageUsd: 0.003,
  },
];

function pricingFromUsd(
  inputUsd: number,
  outputUsd: number,
): AiModelPricingConfig {
  return {
    billUnit: "1m_tokens",
    currency: "CNY",
    source: "cloudflare",
    officialInputFen: usdToFen(inputUsd),
    officialOutputFen: usdToFen(outputUsd),
    syncedAt: new Date().toISOString(),
  };
}

function toInput(row: CfSeed): AiModelInput {
  const pricing = pricingFromUsd(row.inputUsd, row.outputUsd);
  return {
    slug: `cf-${cfModelSlug(row.id)}`,
    label: row.label,
    hint: row.hint,
    modality: "text",
    uses: row.uses || ["script", "shot", "copywriting"],
    provider: "cloudflare",
    providerModel: row.id,
    config: { pricing },
    costHint: costHintFromOfficial(pricing) || "Workers AI",
    sortOrder: 800 + row.sortOrder,
    enabled: row.enabled !== false,
    fallbackSlug: row.fallbackSlug,
  };
}

function toImageInput(row: CfImageSeed): AiModelInput {
  const pricing: AiModelPricingConfig = {
    billUnit: "image",
    currency: "CNY",
    source: "cloudflare",
    officialFen: usdToFen(row.imageUsd),
    syncedAt: new Date().toISOString(),
  };
  return {
    slug: `cf-${cfModelSlug(row.id)}`,
    label: row.label,
    hint: row.hint,
    modality: "image",
    uses: ["character", "cover", "infographic"],
    provider: "cloudflare",
    providerModel: row.id,
    config: { pricing },
    costHint: costHintFromOfficial(pricing) || "Workers AI",
    sortOrder: 850 + row.sortOrder,
    enabled: true,
  };
}

export const CLOUDFLARE_AI_MODEL_SEED: AiModelInput[] = [
  ...CF_TEXT.map(toInput),
  ...CF_IMAGE.map(toImageInput),
];

type CfListedModel = {
  name: string;
  /** 目录展示名，如 HappyHorse 1.0 T2V */
  label?: string;
  task: string;
  description?: string;
  inputUsd?: number;
  outputUsd?: number;
  imageUsd?: number;
  requestUsd?: number;
};

type CfApiModel = {
  name?: string;
  description?: string;
  task?: { name?: string } | string;
  properties?: Array<{ property_id?: string; value?: unknown }>;
};

function priceUnits(model: CfApiModel): Array<{ unit?: string; price?: number }> {
  const props = Array.isArray(model.properties) ? model.properties : [];
  const price = props.find((p) => p.property_id === "price")?.value;
  return Array.isArray(price)
    ? (price as Array<{ unit?: string; price?: number }>)
    : [];
}

function listedPrices(model: CfApiModel): Omit<CfListedModel, "name" | "task" | "label"> {
  const rows = priceUnits(model);
  const inn = rows.find((r) => /per M input tokens/i.test(String(r.unit || "")));
  const out = rows.find((r) => /per M output tokens/i.test(String(r.unit || "")));
  const tile = rows.find((r) => /512/i.test(String(r.unit || "")));
  const step = rows.find((r) => /per step/i.test(String(r.unit || "")));
  const audioMin = rows.find((r) => /audio minute/i.test(String(r.unit || "")));
  const per1k = rows.find((r) => /1k character/i.test(String(r.unit || "")));
  const inputUsd = Number(inn?.price);
  const outputUsd = Number(out?.price);
  const imageUsd = Number(tile?.price) > 0
    ? Number(tile?.price)
    : Number(step?.price) > 0
      ? Number(step?.price) * 8
      : undefined;
  const requestUsd = Number(audioMin?.price) > 0
    ? Number(audioMin?.price)
    : Number(per1k?.price) > 0
      ? Number(per1k?.price)
      : undefined;
  return {
    inputUsd: inputUsd > 0 ? inputUsd : undefined,
    outputUsd: outputUsd > 0 ? outputUsd : undefined,
    imageUsd: imageUsd && imageUsd > 0 ? imageUsd : undefined,
    requestUsd: requestUsd && requestUsd > 0 ? requestUsd : undefined,
  };
}

function catalogNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function pickCatalogUsd(
  pricing: Record<string, unknown>,
  tests: RegExp[],
): number | undefined {
  const entries = Object.entries(pricing);
  for (const re of tests) {
    const hit = entries.find(([key, value]) => re.test(key) && catalogNum(value) > 0);
    if (hit) return catalogNum(hit[1]);
  }
  return undefined;
}

function listedPricesFromCatalog(
  pricing: unknown,
): Omit<CfListedModel, "name" | "task" | "label"> {
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) {
    return {};
  }
  const rec = pricing as Record<string, unknown>;
  return {
    inputUsd: pickCatalogUsd(rec, [
      /input tokens \(per 1m\)/i,
      /^input <=200k/i,
      /^input <200k/i,
      /^input <=512k/i,
      /input text tokens/i,
    ]),
    outputUsd: pickCatalogUsd(rec, [
      /output tokens \(per 1m\)/i,
      /^output <=200k/i,
      /^output <200k/i,
      /^output <=512k/i,
      /output text tokens/i,
    ]),
    imageUsd: pickCatalogUsd(rec, [
      /^per image$/i,
      /^per image \(1-4/i,
      /output_size_1k/i,
      /first output megapixel/i,
    ]),
    requestUsd: pickCatalogUsd(rec, [
      /default \(per second\)/i,
      /per second/i,
      /per audio minute/i,
      /output_audio_seconds/i,
      /^per character$/i,
      /^per track$/i,
      /^per lyrics generation/i,
      /^hd$/i,
      /6s @768p/i,
    ]),
  };
}

type CfJson = {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: unknown;
};

async function cfGetJson(url: string, token: string): Promise<CfJson> {
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(45_000),
  });
  const data = (await res.json().catch(() => ({}))) as CfJson;
  if (!res.ok || data.success === false) {
    const msg = data.errors?.[0]?.message || `HTTP ${res.status}`;
    throw new Error(`Cloudflare 模型列表失败：${msg}`);
  }
  return data;
}

function pushUnique(
  out: CfListedModel[],
  seen: Set<string>,
  row: CfListedModel,
) {
  const name = row.name.trim();
  if (!name || seen.has(name)) return;
  seen.add(name);
  out.push({ ...row, name });
}

/** 仪表盘「We found N models」走统一目录，不是 Workers AI 的 /models/search */
async function fetchUnifiedCatalog(
  account: string,
  token: string,
  out: CfListedModel[],
  seen: Set<string>,
) {
  for (let page = 1; page <= 8; page += 1) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/catalog/models?page=${page}&per_page=100`;
    const data = await cfGetJson(url, token);
    const rows = Array.isArray(data.result) ? data.result : [];
    if (!rows.length) break;
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const rec = raw as {
        model_id?: string;
        name?: string;
        description?: string;
        task?: string;
        pricing?: unknown;
        private?: boolean;
      };
      if (rec.private) continue;
      const id = String(rec.model_id || "").trim();
      if (!id) continue;
      pushUnique(out, seen, {
        name: id,
        label: String(rec.name || "").trim() || undefined,
        task: String(rec.task || "").trim(),
        description: String(rec.description || "").trim() || undefined,
        ...listedPricesFromCatalog(rec.pricing),
      });
    }
    if (rows.length < 100) break;
  }
}

/** Workers AI 托管的 @cf / @hf，search 分页会截断，按任务再扫一遍 */
async function fetchHostedWorkersAi(
  account: string,
  token: string,
  out: CfListedModel[],
  seen: Set<string>,
) {
  const queries = [
    "",
    "include_deprecated=true",
    "task=Text-to-Image",
    "task=Text%20Generation",
    "task=Text-to-Speech",
    "task=Automatic%20Speech%20Recognition",
    "task=Text%20Embeddings",
  ];
  for (const extra of queries) {
    for (let page = 1; page <= 8; page += 1) {
      const qs = [`per_page=50`, `page=${page}`, extra].filter(Boolean).join("&");
      const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/models/search?${qs}`;
      const data = await cfGetJson(url, token);
      const rows = Array.isArray(data.result) ? data.result : [];
      if (!rows.length) break;
      let added = 0;
      for (const row of rows as CfApiModel[]) {
        const name = String(row.name || "").trim();
        if (!name || seen.has(name)) continue;
        const task =
          typeof row.task === "string"
            ? row.task
            : String(row.task?.name || "").trim();
        added += 1;
        const descProp = Array.isArray(row.properties)
          ? row.properties.find((p) => p.property_id === "description")
          : undefined;
        const fromProp =
          typeof descProp?.value === "string" ? descProp.value.trim() : "";
        pushUnique(out, seen, {
          name,
          task,
          description: String(row.description || "").trim() || fromProp || undefined,
          ...listedPrices(row),
        });
      }
      if (added === 0) break;
    }
  }
}

export async function fetchCloudflareAiModels(): Promise<CfListedModel[]> {
  const token = resolveCloudflareAiToken();
  const account = resolveCloudflareAccountId();
  if (!token) throw new Error("未配置 CLOUDFLARE_AI_TOKEN / CLOUDFLARE_API_TOKEN");
  if (!account) throw new Error("未配置 CLOUDFLARE_ACCOUNT_ID");

  const out: CfListedModel[] = [];
  const seen = new Set<string>();
  await fetchUnifiedCatalog(account, token, out, seen);
  await fetchHostedWorkersAi(account, token, out, seen);
  return out;
}

function joinHint(parts: string[], max = 36): string {
  const out: string[] = [];
  for (const part of parts) {
    const t = part.replace(/\s+/g, "").trim();
    if (!t || out.some((x) => x === t || t.includes(x) || x.includes(t))) continue;
    const next = [...out, t].join("，");
    if (next.length > max) {
      if (!out.length) return t.slice(0, max);
      break;
    }
    out.push(t);
  }
  return out.join("，");
}

type CfKind =
  | "image"
  | "video"
  | "music"
  | "tts"
  | "asr"
  | "text"
  | "embed"
  | "other";

function inferCfKind(task: string, name: string): CfKind {
  const t = task.toLowerCase();
  const n = name.toLowerCase();
  if (/embedding|feature extraction|vector/.test(t) || /embedding|bge-|e5-/.test(n)) {
    return "embed";
  }
  if (/text-to-speech|tts/.test(t) || /aura-|melotts/.test(n)) return "tts";
  if (
    /speech recognition|asr|transcription/.test(t) ||
    /whisper|deepgram/.test(n) ||
    (/nova-[23]|nova-sonic/.test(n) && !/canvas|reel/.test(n))
  ) {
    return "asr";
  }
  if (
    /music|text-to-music|audio generation/.test(t) ||
    /musicgen|stable-audio|suno/.test(n)
  ) {
    return "music";
  }
  if (
    /text-to-video|image-to-video/.test(t) ||
    (/\bvideo\b/.test(t) && !/audio/.test(t)) ||
    /seedance|kling|wan-video|wan2.+video|ltx|hh1|happyhorse|hailuo|veo-|pixverse|runway|vidu\/|sora|nova-reel|pika|hunyuan-video|cogvideo|mochi|luma|ray-|dream-machine|magi-|step-video|grok-video/.test(
      n,
    )
  ) {
    return "video";
  }
  if (
    /text-to-image|image-to-image|inpainting/.test(t) ||
    t === "image" ||
    /flux|stable-diffusion|dreamshaper|lucid|phoenix|seedream|imagen|nano-banana|qwen-image|ideogram|recraft|kolors|nova-canvas|hidream|wan.+image|grok-imagine|gpt-image|dall-e|hunyuan-image|midjourney/.test(
      n,
    )
  ) {
    return "image";
  }
  if (/elevenlabs|cartesia|playht|aura-|melotts/.test(n)) return "tts";
  if (t === "text" || /text generation|image-to-text|chat/.test(t)) return "text";
  if (/guard|moderation|rerank|classif|translation|object detection|summarization|websocket/.test(t + n)) {
    return "other";
  }
  return "other";
}

function curatedCfHint(kind: CfKind, name: string): string {
  const n = name.toLowerCase();
  if (kind === "image") {
    if (/qwen[-/]?image/.test(n)) return "中文小字和排版清楚";
    if (/seedream/.test(n)) return "画质细，适合成品";
    if (/nano-banana.+pro|nanobanana.+pro|nano-banana-2/.test(n)) {
      return "人物不换脸，小字也清楚";
    }
    if (/nano-banana|nanobanana/.test(n)) return "出图快，人物比较稳";
    if (/imagen/.test(n)) return "更像实拍，适合照片感";
    if (/ideogram/.test(n)) return "海报小字清楚";
    if (/recraft/.test(n)) return "设计感和矢量更稳";
    if (/kolors/.test(n)) return "中文出图稳";
    if (/nova-canvas/.test(n)) return "能按参考改图";
    if (/hidream/.test(n)) return "画质细，适合成品";
    if (/grok-imagine/.test(n)) return "出图有想法，适合概念图";
    if (/gpt-image|dall-e/.test(n)) return "指令跟得紧，适合海报和小字";
    if (/hunyuan-image/.test(n)) return "中文出图稳";
    if (/midjourney/.test(n)) return "画风好，适合氛围图";
    if (/flux-1-schnell/.test(n) || (/schnell/.test(n) && /flux/.test(n))) {
      return "出图快，适合打草稿和批量";
    }
    if (/kontext/.test(n)) return "能按参考改图，人物不换脸";
    if (/flux-2-klein-4b/.test(n)) return "更快更便宜，适合试构图";
    if (/flux-2-klein/.test(n)) return "画质和速度折中，适合角色图";
    if (/flux-2-(pro|max)/.test(n)) return "画质更好，细节更稳";
    if (/flux-2/.test(n)) return "画质更好，指令跟得紧";
    if (/lucid/.test(n)) return "人物皮肤和光感更自然";
    if (/phoenix/.test(n)) return "色彩浓，适合海报";
    if (/dreamshaper/.test(n)) return "插画和二次元更顺";
    if (/lightning/.test(n)) return "出图快，构图稳";
    if (/stable-diffusion-3|sd3/.test(n)) return "构图稳，适合概念图";
    if (/stable-diffusion|sdxl/.test(n)) return "泛用出图，风格好控";
    if (/inpaint|image-to-image/.test(n)) return "能按参考改图";
    return "";
  }
  if (kind === "video") {
    if (/seedance/.test(n) && /mini|lite|fast/.test(n)) {
      return "出片快，能直接出声";
    }
    if (/seedance/.test(n)) return "动作自然，能跟参考，可带声音";
    if (/kling/.test(n)) return "运镜稳，人物不容易花";
    if (/wan/.test(n)) return "中文提示更听话";
    if (/hh1|happyhorse/.test(n)) return "出片快，适合短视频";
    if (/hailuo|minimax/.test(n)) return "镜头感强";
    if (/veo/.test(n)) return "画质接近实拍，镜头连贯";
    if (/pixverse/.test(n)) return "特效和运镜花";
    if (/runway/.test(n)) return "成片更像广告片";
    if (/vidu/.test(n)) return "参考图跟得住";
    if (/ltx/.test(n)) return "出片快";
    if (/sora/.test(n)) return "镜头连贯，更像电影";
    if (/nova-reel/.test(n)) return "能跟参考图动起来";
    if (/pika/.test(n)) return "玩法和特效多";
    if (/hunyuan/.test(n)) return "中文提示稳";
    if (/cogvideo/.test(n)) return "开源出片，动作还行";
    if (/mochi/.test(n)) return "出片快，适合试镜头";
    if (/luma|ray-|dream-machine/.test(n)) return "镜头连贯，更像实拍";
    if (/magi/.test(n)) return "一句话出视频";
    if (/grok-video/.test(n)) return "出片有想法";
    return "";
  }
  if (kind === "text") {
    if (/claude/.test(n) && /opus/.test(n)) return "理解更深，长文不容易跑偏";
    if (/claude/.test(n) && /haiku/.test(n)) return "又快又便宜，适合改稿";
    if (/claude/.test(n)) return "指令跟得紧，写稿分镜稳";
    if (/gpt-oss-120/.test(n)) return "开源大模型，写作均衡";
    if (/gpt-oss-20/.test(n)) return "更小更快，适合短任务";
    if (/gpt-5|o3|o4/.test(n)) return "推理深，难任务更准";
    if (/gemini/.test(n) && /flash/.test(n)) return "又快又能看图";
    if (/gemini/.test(n) && /pro/.test(n)) return "能看图，长文理解好";
    if (/gemini/.test(n)) return "能看图，上下文长";
    if (/deepseek/.test(n) && /pro|reasoner|r1/.test(n)) {
      return "推理更深，适合难稿";
    }
    if (/deepseek/.test(n) && /flash|chat/.test(n)) {
      return "又快又便宜，适合改稿和分镜";
    }
    if (/deepseek/.test(n)) return "会先想再写";
    if (/kimi|moonshot/.test(n)) return "超长上下文，适合长稿一次写完";
    if (/glm-5/.test(n)) return "写代码和长任务稳，中文自然";
    if (/glm/.test(n) && /flash/.test(n)) return "又快又便宜，适合改稿";
    if (/qwen/.test(n) && /coder/.test(n)) return "写代码强";
    if (/qwen/.test(n) && /vl|qvq|ocr|vision/.test(n)) return "能看图再写";
    if (/qwen/.test(n) && /flash|turbo/.test(n)) return "中文快改";
    if (/qwen/.test(n) && /max/.test(n)) return "中文最稳，适合难稿";
    if (/qwen/.test(n)) return "中文写稿稳";
    if (/llama-4/.test(n)) return "能看图，适合带参考的分镜";
    if (/llama/.test(n)) return "指令跟随稳";
    if (/mistral/.test(n) && /small-3|pixtral|vision/.test(n)) {
      return "能看图，又快又稳";
    }
    if (/mistral/.test(n)) return "又快又稳，适合短对白";
    if (/gemma/.test(n)) return "能看图再写";
    if (/command-r|command-a/.test(n)) return "检索和长文稳";
    if (/hermes/.test(n)) return "指令跟随稳，适合工具调用";
    if (/llama-guard|guard/.test(n)) return "适合安全检查";
    if (/grok/.test(n)) return "回答直接，适合改稿";
    if (/nova-micro|nova-lite/.test(n)) return "又快又便宜，适合短任务";
    if (/nova-pro/.test(n)) return "能看图，写稿够用";
    return "";
  }
  if (kind === "tts") {
    if (/elevenlabs/.test(n)) return "配音自然，情绪稳";
    if (/cartesia/.test(n)) return "配音快，适合试听";
    return "配音自然";
  }
  if (kind === "asr") return "转写更准";
  if (kind === "music") return "能出短曲子";
  if (kind === "embed") return "适合检索和相似度";
  if (/guard|moderation/.test(n)) return "适合安全检查";
  if (/rerank/.test(n)) return "适合检索重排序";
  if (/websocket/.test(n)) return "实时语音";
  if (/classif/.test(n)) return "适合分类";
  if (/translation/.test(n)) return "适合翻译";
  if (/summarization/.test(n)) return "适合摘要";
  if (/object detection/.test(n)) return "适合识别画面物体";
  return "";
}

/** 前台说明写优势，按任务类型写，不串台、不写通道名 */
export function cfStrengthHint(row: {
  description?: string;
  task?: string;
  name: string;
}): string {
  const desc = String(row.description || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const t = String(row.task || "").toLowerCase();
  const n = String(row.name || "").toLowerCase();
  const kind = inferCfKind(t, n);
  const curated = curatedCfHint(kind, n);
  const bits: string[] = [];
  if (curated) bits.push(curated);

  if (kind === "image") {
    if (
      /typograph|small text|text rendering|layout|font/.test(desc) &&
      !/小字/.test(curated)
    ) {
      bits.push("小字清楚");
    }
    if (/photoreal|realistic/.test(desc)) bits.push("更像实拍");
    if (/inpaint|image-to-image|edit|reference/.test(desc + t) && !/人物不换脸|按参考/.test(curated)) {
      bits.push("能按参考改图");
    }
  } else if (kind === "video") {
    if (/audio|speech|soundtrack|lip.?sync/.test(desc) && !/出声|声音/.test(curated)) {
      bits.push("能带同步声音");
    }
    if (/image-to-video|i2v|reference/.test(desc + t) && !/参考/.test(curated)) {
      bits.push("能跟参考图动起来");
    }
  } else if (kind === "text") {
    if (/long context|1m token|128k|200k|million token/.test(desc) && !/超长/.test(curated)) {
      bits.push("超长上下文");
    }
    if (/image-to-text|vision|multimodal/.test(desc + t) && !/看图/.test(curated)) {
      bits.push("能看图再写");
    }
  }

  const joined = joinHint(bits);
  if (joined) return joined;

  if (desc) {
    const fromDesc = hintFromOfficialDesc(desc, kind);
    if (fromDesc) return fromDesc;
  }

  if (kind === "image") return "按提示出图，画风好控";
  if (kind === "video") return "按提示出短视频";
  if (kind === "music") return "能出短曲子";
  if (kind === "tts") return "配音自然";
  if (kind === "asr") return "转写更准";
  if (kind === "embed") return "适合检索和相似度";
  if (kind === "text") return "适合写稿和改稿";
  if (/websocket/.test(t)) return "实时语音";
  if (/translation/.test(t)) return "适合翻译";
  if (/summarization/.test(t)) return "适合摘要";
  if (/classif/.test(t)) return "适合分类";
  if (/object detection/.test(t)) return "适合识别画面物体";
  return "适合写稿和改稿";
}

function hintFromOfficialDesc(desc: string, kind: CfKind): string {
  if (/[\u4e00-\u9fff]/.test(desc)) {
    return desc.replace(/\s+/g, "").slice(0, 36);
  }
  const hits: string[] = [];
  if (/typograph|text rendering|small text/.test(desc)) hits.push("小字和排版清楚");
  if (/character consistency|consistent character/.test(desc)) hits.push("人物不换脸");
  if (/photoreal|photograph/.test(desc)) hits.push("更像实拍");
  if (/image.to.video|animat/.test(desc)) hits.push("参考图能动起来");
  if (/text.to.video|generates video/.test(desc)) hits.push("一句话出视频");
  if (/lip.?sync|synchronized audio|native audio/.test(desc)) hits.push("能带同步声音");
  if (/speech recognition|transcri/.test(desc)) hits.push("转写更准");
  if (/text.to.speech|\btts\b|voice clone/.test(desc)) hits.push("配音自然");
  if (/music|soundtrack/.test(desc) && kind !== "video") hits.push("能出短曲子");
  if (/embedding|retrieval|vector/.test(desc)) hits.push("适合检索和相似度");
  if (/coding|code generation/.test(desc)) hits.push("写代码强");
  if (/reasoning|thinking/.test(desc)) hits.push("会先想再写");
  if (/long context/.test(desc)) hits.push("超长上下文");
  if (/multimodal|vision|image understanding/.test(desc)) hits.push("能看图再写");
  if (/fast|low.latency|real.?time/.test(desc)) {
    hits.push(kind === "image" ? "出图快" : kind === "video" ? "出片快" : "生成快");
  }
  return joinHint(hits);
}

function mapCfTask(
  task: string,
  name: string,
): { modality: AiModality; uses: AiModelUse[]; sortOrder: number; hint: string } {
  const t = task.toLowerCase();
  const n = name.toLowerCase();
  if (
    /text-to-image|image-to-image|inpainting/i.test(task) ||
    /flux|stable-diffusion|dreamshaper|lucid|phoenix|seedream|imagen|nano-banana|qwen-image|wan-2.+image/i.test(n)
  ) {
    return {
      modality: "image",
      uses: ["character", "cover", "infographic"],
      sortOrder: 860,
      hint: "按提示出图，画风好控",
    };
  }
  if (
    /text-to-video|image-to-video/i.test(t) ||
    (/video/i.test(t) && !/audio/i.test(t)) ||
    /seedance|kling|wan-video|ltx|hh1|hailuo|veo-|pixverse|runwayml\/|vidu\//i.test(n)
  ) {
    return {
      modality: "video",
      uses: ["video"],
      sortOrder: 870,
      hint: "按提示出短视频",
    };
  }
  if (/music|audio generation|text-to-music/i.test(t) || /musicgen|stable-audio|music-v2|music-2/i.test(n)) {
    return {
      modality: "music",
      uses: ["music"],
      sortOrder: 880,
      hint: "能出短曲子",
    };
  }
  if (/text-to-speech|tts/i.test(t) || /aura|melotts|tts/i.test(n)) {
    return {
      modality: "audio",
      uses: ["tts"],
      sortOrder: 890,
      hint: "配音自然",
    };
  }
  if (/speech recognition|asr/i.test(t) || /whisper|nova-|deepgram\/flux|universal-3/i.test(n)) {
    return {
      modality: "audio",
      uses: ["asr"],
      sortOrder: 900,
      hint: "转写更准",
    };
  }
  if (/websocket/i.test(t)) {
    return {
      modality: "audio",
      uses: [],
      sortOrder: 970,
      hint: "实时语音",
    };
  }
  if (/embedding|feature extraction/i.test(t) || /embedding|bge-/i.test(n)) {
    return {
      modality: "text",
      uses: [],
      sortOrder: 950,
      hint: "适合检索和相似度",
    };
  }
  if (/classif|translation|dumb pipe|object detection|summarization/i.test(t)) {
    return {
      modality: "text",
      uses: [],
      sortOrder: 960,
      hint: "适合分类和摘要",
    };
  }
  if (/text generation|image-to-text/i.test(t)) {
    return {
      modality: "text",
      uses: /lora|guard/i.test(n)
        ? ["shot"]
        : ["script", "shot", "copywriting"],
      sortOrder: 810,
      hint: /image-to-text/i.test(t) ? "能看图再写" : "适合写稿和改稿",
    };
  }
  return {
    modality: "text",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 980,
    hint: "适合写稿和改稿",
  };
}

function pricingFromListed(row: CfListedModel): AiModelPricingConfig {
  const mapped = mapCfTask(row.task, row.name);
  if (row.inputUsd && row.outputUsd) {
    return pricingFromUsd(row.inputUsd, row.outputUsd);
  }
  if (mapped.modality === "image") {
    return {
      billUnit: "image",
      currency: "CNY",
      source: "cloudflare",
      officialFen: usdToFen(row.imageUsd || 0.003),
      syncedAt: new Date().toISOString(),
    };
  }
  if (mapped.modality === "video") {
    return {
      billUnit: "video_sec",
      currency: "CNY",
      source: "cloudflare",
      officialFen: usdToFen(row.requestUsd || 0.05),
      syncedAt: new Date().toISOString(),
    };
  }
  if (row.inputUsd) {
    return pricingFromUsd(row.inputUsd, row.inputUsd);
  }
  return {
    billUnit: "request",
    currency: "CNY",
    source: "cloudflare",
    officialFen: usdToFen(row.requestUsd || row.imageUsd || 0.001),
    syncedAt: new Date().toISOString(),
  };
}

function prettyLabel(name: string): string {
  const tail = name.split("/").pop() || name;
  return tail.replace(/[-_]/g, " ");
}

export function cloudflareModelToInput(row: CfListedModel): AiModelInput | null {
  const raw = row.name.trim();
  if (!raw) return null;
  if (shouldSkipSyncImport(raw, "cloudflare")) return null;

  const mapped = mapCfTask(row.task, raw);
  const hint = cfStrengthHint(row) || mapped.hint;
  const pricing = pricingFromListed(row);
  const known = CLOUDFLARE_AI_MODEL_SEED.find((m) => m.providerModel === raw);
  if (known) {
    return {
      ...known,
      hint,
      config: { ...known.config, pricing },
      costHint: costHintFromOfficial(pricing) || known.costHint,
    };
  }

  return {
    slug: `cf-${cfModelSlug(raw)}`,
    label: row.label?.trim() || prettyLabel(raw),
    hint,
    modality: mapped.modality,
    uses: mapped.uses,
    provider: "cloudflare",
    providerModel: raw,
    config: { pricing },
    costHint: costHintFromOfficial(pricing) || mapped.hint,
    sortOrder: mapped.sortOrder,
    enabled: true,
    badges: raw.startsWith("@") ? undefined : ["new"],
  };
}

