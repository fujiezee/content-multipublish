import type { AiModelInput, AiModelUse, AiModality } from "@/lib/ai/model-catalog/types";
import { shouldSkipSyncImport } from "@/lib/ai/model-catalog/discontinued";

/**
 * 阿里云百炼 / MaaS OpenAI 兼容（QWEN_BASE_URL + DASHSCOPE_API_KEY）。
 * 与 openai-proxy 的「代理站」通道分开；slug 用上游原名。
 */
type QwenSeed = {
  id: string;
  label: string;
  hint: string;
  modality?: AiModality;
  uses?: AiModelUse[];
  costHint?: string;
  sortOrder: number;
  enabled?: boolean;
  fallbackSlug?: string;
};

const QWEN_TEXT: QwenSeed[] = [
  {
    id: "qwen3.8-max",
    label: "Qwen 3.8 Max",
    hint: "最强档，适合难稿和长剧本",
    uses: ["script", "shot", "copywriting"],
    costHint: "国内",
    sortOrder: 10,
    fallbackSlug: "qwen3.7-max",
  },
  {
    id: "qwen3.7-max",
    label: "Qwen 3.7 Max",
    hint: "理解更深，写稿不容易跑偏",
    uses: ["script", "shot", "copywriting"],
    costHint: "国内",
    sortOrder: 15,
    fallbackSlug: "qwen3.7-plus",
  },
  {
    id: "qwen3.7-plus",
    label: "Qwen 3.7 Plus",
    hint: "质量够稳，适合日常写稿",
    uses: ["script", "shot", "copywriting"],
    costHint: "国内",
    sortOrder: 20,
    fallbackSlug: "qwen3.6-plus",
  },
  {
    id: "qwen3.7-flash",
    label: "Qwen 3.7 Flash",
    hint: "又快又便宜，适合改稿",
    uses: ["shot", "copywriting"],
    costHint: "国内便宜",
    sortOrder: 22,
  },
  {
    id: "qwen3.6-plus",
    label: "Qwen 3.6 Plus",
    hint: "中文写稿稳",
    uses: ["script", "shot", "copywriting"],
    costHint: "国内",
    sortOrder: 25,
  },
  {
    id: "qwen3.6-flash",
    label: "Qwen 3.6 Flash",
    hint: "又快又便宜，适合改稿",
    uses: ["shot", "copywriting"],
    costHint: "国内便宜",
    sortOrder: 28,
  },
  {
    id: "qwen3.5-plus",
    label: "Qwen 3.5 Plus",
    hint: "中文写稿稳",
    uses: ["script", "shot", "copywriting"],
    costHint: "国内",
    sortOrder: 30,
  },
  {
    id: "qwen3.5-flash",
    label: "Qwen 3.5 Flash",
    hint: "又快又便宜，适合改稿",
    uses: ["shot", "copywriting"],
    costHint: "国内便宜",
    sortOrder: 32,
  },
  {
    id: "qwen3-max",
    label: "Qwen3 Max",
    hint: "中文旗舰，适合难稿",
    uses: ["script", "shot", "copywriting"],
    costHint: "国内",
    sortOrder: 40,
    fallbackSlug: "qwen-max",
  },
  {
    id: "qwen-max",
    label: "Qwen Max",
    hint: "中文旗舰，写稿不容易跑偏",
    uses: ["script", "shot", "copywriting"],
    costHint: "国内",
    sortOrder: 45,
    fallbackSlug: "qwen-plus",
  },
  {
    id: "qwen-plus",
    label: "Qwen Plus",
    hint: "中文写稿常用，质量够稳",
    uses: ["script", "shot", "copywriting"],
    costHint: "国内",
    sortOrder: 50,
    fallbackSlug: "qwen-flash",
  },
  {
    id: "qwen-flash",
    label: "Qwen Flash",
    hint: "又快又便宜，适合改稿",
    uses: ["shot", "copywriting"],
    costHint: "国内便宜",
    sortOrder: 55,
  },
  {
    id: "qwen-turbo",
    label: "Qwen Turbo",
    hint: "更快更便宜，适合试跑",
    uses: ["shot", "copywriting"],
    costHint: "国内便宜",
    sortOrder: 58,
  },
  {
    id: "qwen-long",
    label: "Qwen Long",
    hint: "超长上下文，适合长文一次写完",
    uses: ["copywriting", "script"],
    costHint: "国内",
    sortOrder: 60,
  },
  {
    id: "qwq-plus",
    label: "QwQ Plus",
    hint: "会先想再写，适合复杂剧情",
    uses: ["script", "shot"],
    costHint: "国内",
    sortOrder: 70,
  },
  {
    id: "qvq-max",
    label: "QVQ Max",
    hint: "能看图再写，适合分镜",
    uses: ["shot"],
    costHint: "国内",
    sortOrder: 75,
    enabled: false,
  },
  {
    id: "qwen3-coder-plus",
    label: "Qwen3 Coder Plus",
    hint: "写代码强",
    uses: ["shot"],
    costHint: "国内",
    sortOrder: 80,
    enabled: false,
  },
];

const QWEN_IMAGE: QwenSeed[] = [
  {
    id: "qwen-image-3.0",
    label: "Qwen Image 3.0",
    hint: "中文小字和排版清楚",
    modality: "image",
    uses: ["infographic", "cover", "character"],
    costHint: "国内",
    sortOrder: 100,
  },
  {
    id: "qwen-image-3.0-pro",
    label: "Qwen Image 3.0 Pro",
    hint: "小字和排版更清楚，适合成品",
    modality: "image",
    uses: ["infographic", "cover", "character"],
    costHint: "国内",
    sortOrder: 105,
  },
  {
    id: "qwen-image-2.0-pro",
    label: "Qwen Image 2.0 Pro",
    hint: "中文小字清楚，适合成品图",
    modality: "image",
    uses: ["infographic", "cover"],
    costHint: "国内",
    sortOrder: 110,
    enabled: false,
  },
];

const QWEN_AUDIO: QwenSeed[] = [
  {
    id: "qwen3-tts-flash",
    label: "Qwen3 TTS Flash",
    hint: "配音快，适合试听",
    modality: "audio",
    uses: ["tts"],
    costHint: "国内",
    sortOrder: 200,
    enabled: false,
  },
];

function toInput(row: QwenSeed): AiModelInput {
  const modality = row.modality || "text";
  const uses =
    row.uses ||
    (modality === "image"
      ? (["infographic", "cover"] as AiModelUse[])
      : modality === "audio"
        ? (["tts"] as AiModelUse[])
        : (["script", "shot", "copywriting"] as AiModelUse[]));
  return {
    slug: `aliyun-${row.id}`,
    label: row.label,
    hint: row.hint,
    modality,
    uses,
    provider: "qwen",
    providerModel: row.id,
    costHint: row.costHint || "国内",
    sortOrder: 600 + row.sortOrder,
    enabled: row.enabled !== false,
    fallbackSlug: row.fallbackSlug ? `aliyun-${row.fallbackSlug}` : undefined,
  };
}

/** 精选千问 MaaS 模型（slug 加 aliyun- 前缀，避免和代理站撞名） */
export const QWEN_AI_MODEL_SEED: AiModelInput[] = [
  ...QWEN_TEXT,
  ...QWEN_IMAGE,
  ...QWEN_AUDIO,
].map(toInput);

const DATED_SUFFIX = /-\d{4}-\d{2}-\d{2}$|-\d{8}$|-\d{4}$/;

export function resolveQwenOpenAiBase(): string {
  let base =
    process.env.QWEN_BASE_URL?.trim() ||
    process.env.DASHSCOPE_BASE_URL?.trim() ||
    "";
  if (!base) return "";
  base = base.replace(/\/$/, "");
  if (!/\/v1$/i.test(base) && !/compatible-mode/i.test(base)) {
    // 用户若只给了 host，默认走 OpenAI 兼容路径
    if (!base.includes("/")) {
      base = `https://${base}/compatible-mode/v1`;
    }
  }
  if (!base.endsWith("/v1")) base = `${base}/v1`;
  return base;
}

export function resolveQwenApiKey(): string {
  return (
    process.env.DASHSCOPE_API_KEY?.trim() ||
    process.env.QWEN_API_KEY?.trim() ||
    ""
  );
}

function qwenStrengthHint(raw: string, modality: AiModality, dated: boolean): string {
  const n = raw.toLowerCase();
  if (dated) return "带日期档，适合对照旧稿";
  if (modality === "image") {
    return /pro/.test(n) ? "小字和排版更清楚，适合成品" : "中文小字和排版清楚";
  }
  if (modality === "audio") {
    return /asr/.test(n) ? "转写更准" : "配音快，适合试听";
  }
  if (/coder/.test(n)) return "写代码强";
  if (/qwq|thinking|reason/.test(n)) return "会先想再写";
  if (/qvq|vl-|ocr/.test(n)) return "能看图再写";
  if (/long/.test(n)) return "超长上下文，适合长文一次写完";
  if (/flash|turbo/.test(n)) return "又快又便宜，适合改稿";
  if (/max/.test(n)) return "中文最稳，适合难稿";
  if (/plus/.test(n)) return "中文写稿常用，质量够稳";
  return "中文写稿稳";
}

export function qwenModelIdToInput(id: string): AiModelInput | null {
  const raw = id.trim();
  if (!raw) return null;
  if (/embedding|moderation|text-embedding/i.test(raw)) return null;
  if (shouldSkipSyncImport(raw, "qwen")) return null;

  const known = QWEN_AI_MODEL_SEED.find((m) => m.providerModel === raw);
  if (known) return known;

  let modality: AiModality = "text";
  let uses: AiModelUse[] = ["script", "shot", "copywriting"];
  if (/image|vl-|ocr|qvq/i.test(raw)) {
    modality = /vl-|ocr|qvq/i.test(raw) ? "text" : "image";
    uses =
      modality === "image"
        ? ["infographic", "cover", "character"]
        : ["shot"];
  } else if (/tts|asr|audio|speech|s2s|livetranslate/i.test(raw)) {
    modality = "audio";
    uses = /asr/i.test(raw) ? ["asr"] : ["tts"];
  }

  const dated = DATED_SUFFIX.test(raw);
  const slug = `aliyun-${raw}`.slice(0, 120);
  return {
    slug,
    label: raw.replace(/^qwen/i, "Qwen "),
    hint: qwenStrengthHint(raw, modality, dated),
    modality,
    uses,
    provider: "qwen",
    providerModel: raw,
    costHint: "国内",
    sortOrder: dated ? 980 : 700,
    enabled: !dated && modality === "text",
  };
}

export async function fetchQwenModelIds(): Promise<string[]> {
  const apiKey = resolveQwenApiKey();
  const base = resolveQwenOpenAiBase();
  if (!apiKey) throw new Error("未配置 DASHSCOPE_API_KEY / QWEN_API_KEY");
  if (!base) {
    throw new Error(
      "未配置 QWEN_BASE_URL（OpenAI 兼容地址，如 …/compatible-mode/v1）",
    );
  }
  const res = await fetch(`${base}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`拉取千问模型失败 ${res.status}: ${raw.slice(0, 220)}`);
  }
  let json: { data?: Array<{ id?: string }> } = {};
  try {
    json = JSON.parse(raw) as typeof json;
  } catch {
    throw new Error("千问 /models 返回不是 JSON");
  }
  return (json.data || [])
    .map((row) => String(row.id || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}
