import type { AiModelPricingConfig } from "@/lib/ai/model-catalog/types";
import { fenToYuan, yuanToFen } from "@/lib/billing/markup";

/**
 * 官方刊例（不含限时折扣）。单位：元。
 * 文本：每百万 token（缓存未命中 / 高峰原价）；图：每张；视频：每秒；音乐：每次。
 * 纯数据，可被客户端费用页引用，勿在此 import db。
 */
type OfficialRow = {
  keys: string[];
  billUnit: AiModelPricingConfig["billUnit"];
  inputYuan?: number;
  outputYuan?: number;
  yuan?: number;
};

const OFFICIAL_ROWS: OfficialRow[] = [
  // —— 火山方舟 / 豆包 ——
  {
    keys: ["doubao-seed-2-0-pro", "doubao-seed-2-0-pro-260215"],
    billUnit: "1m_tokens",
    inputYuan: 3.2,
    outputYuan: 9.6,
  },
  {
    keys: ["doubao-seed-2-0-lite", "doubao-seed-2-0-lite-260428", "doubao-seed"],
    billUnit: "1m_tokens",
    inputYuan: 0.8,
    outputYuan: 2.0,
  },
  {
    keys: ["doubao-seed-2-0-mini", "doubao-seed-2-0-mini-260428"],
    billUnit: "1m_tokens",
    inputYuan: 0.4,
    outputYuan: 1.0,
  },
  {
    keys: ["doubao-seed-1-6", "doubao-seed-1-6-251015", "doubao-seed-1-6-250615"],
    billUnit: "1m_tokens",
    inputYuan: 0.8,
    outputYuan: 2.0,
  },
  {
    keys: [
      "doubao-1-5-pro-32k",
      "doubao-1-5-pro-32k-250115",
      "doubao-pro-32k",
      "doubao-pro-32k-241215",
    ],
    billUnit: "1m_tokens",
    inputYuan: 0.8,
    outputYuan: 2.0,
  },
  {
    keys: ["seedream-5.0", "doubao-seedream-5-0", "doubao-seedream-5-0-260128"],
    billUnit: "image",
    yuan: 0.22,
  },
  {
    keys: ["seedream-4.5", "doubao-seedream-4-5", "doubao-seedream-4-5-251128"],
    billUnit: "image",
    yuan: 0.25,
  },
  {
    keys: ["seedream-4.0", "doubao-seedream-4-0", "doubao-seedream-4-0-250828"],
    billUnit: "image",
    yuan: 0.2,
  },
  {
    keys: [
      "seedance-2-mini",
      "seedance-2-mini-480",
      "doubao-seedance-2-0-mini",
    ],
    billUnit: "video_sec",
    yuan: 0.23,
  },
  { keys: ["seedance-2-mini-720"], billUnit: "video_sec", yuan: 0.5 },
  {
    keys: [
      "seedance-2-fast",
      "seedance-2-fast-480",
      "doubao-seedance-2-0-fast",
    ],
    billUnit: "video_sec",
    yuan: 0.37,
  },
  { keys: ["seedance-2-fast-720"], billUnit: "video_sec", yuan: 0.8 },
  {
    keys: ["seedance-2-0", "seedance-2-0-480", "doubao-seedance-2-0-260128"],
    billUnit: "video_sec",
    yuan: 0.46,
  },
  { keys: ["seedance-2-0-720"], billUnit: "video_sec", yuan: 0.99 },
  {
    keys: ["seedance-2-5", "seedance-2-5-480", "doubao-seedance-2-5"],
    billUnit: "video_sec",
    yuan: 0.67,
  },
  { keys: ["seedance-2-5-720"], billUnit: "video_sec", yuan: 1.51 },
  { keys: ["ark-tts-default", "default"], billUnit: "request", yuan: 0.02 },

  // —— DeepSeek 官网（高峰 · 缓存未命中）——
  {
    keys: [
      "deepseek-chat",
      "deepseek-v4-flash",
      "deepseek-v4-flash-0731",
      "deepseek-v3.2",
      "deepseek-v4-flash",
    ],
    billUnit: "1m_tokens",
    inputYuan: 3.0,
    outputYuan: 9.0,
  },
  {
    keys: [
      "deepseek-reasoner",
      "deepseek-v4-pro",
      "deepseek-v4-pro-0813",
      "deepseek-v4-pro",
    ],
    billUnit: "1m_tokens",
    inputYuan: 9.0,
    outputYuan: 27.0,
  },
  {
    keys: ["qvq-max", "aliyun-qvq-max"],
    billUnit: "1m_tokens",
    inputYuan: 8,
    outputYuan: 32,
  },
  {
    keys: ["qwen3-coder-plus", "aliyun-qwen3-coder-plus"],
    billUnit: "1m_tokens",
    inputYuan: 2,
    outputYuan: 8,
  },

  // —— 阿里云百炼（内地档 · 非思考 / 最低阶梯）——
  {
    keys: ["qwen3.8-max", "aliyun-qwen3.8-max"],
    billUnit: "1m_tokens",
    inputYuan: 12,
    outputYuan: 36,
  },
  {
    keys: ["qwen3.7-max", "aliyun-qwen3.7-max"],
    billUnit: "1m_tokens",
    inputYuan: 12,
    outputYuan: 36,
  },
  {
    keys: ["qwen3.7-plus", "aliyun-qwen3.7-plus"],
    billUnit: "1m_tokens",
    inputYuan: 2,
    outputYuan: 8,
  },
  {
    keys: ["qwen3.7-flash", "aliyun-qwen3.7-flash"],
    billUnit: "1m_tokens",
    inputYuan: 0.2,
    outputYuan: 0.8,
  },
  {
    keys: ["qwen3.6-plus", "aliyun-qwen3.6-plus"],
    billUnit: "1m_tokens",
    inputYuan: 2,
    outputYuan: 12,
  },
  {
    keys: ["qwen3.6-flash", "aliyun-qwen3.6-flash"],
    billUnit: "1m_tokens",
    inputYuan: 1.2,
    outputYuan: 7.2,
  },
  {
    keys: ["qwen3.5-plus", "aliyun-qwen3.5-plus"],
    billUnit: "1m_tokens",
    inputYuan: 0.8,
    outputYuan: 2,
  },
  {
    keys: ["qwen3.5-flash", "aliyun-qwen3.5-flash"],
    billUnit: "1m_tokens",
    inputYuan: 0.15,
    outputYuan: 1.5,
  },
  {
    keys: ["qwen3-max", "aliyun-qwen3-max"],
    billUnit: "1m_tokens",
    inputYuan: 2.5,
    outputYuan: 10,
  },
  {
    keys: ["qwen-max", "aliyun-qwen-max"],
    billUnit: "1m_tokens",
    inputYuan: 2.4,
    outputYuan: 9.6,
  },
  {
    keys: ["qwen-plus", "aliyun-qwen-plus"],
    billUnit: "1m_tokens",
    inputYuan: 0.8,
    outputYuan: 2,
  },
  {
    keys: ["qwen-flash", "aliyun-qwen-flash"],
    billUnit: "1m_tokens",
    inputYuan: 0.15,
    outputYuan: 1.5,
  },
  {
    keys: ["qwen-turbo", "aliyun-qwen-turbo"],
    billUnit: "1m_tokens",
    inputYuan: 0.3,
    outputYuan: 0.6,
  },
  {
    keys: ["qwen-long", "aliyun-qwen-long"],
    billUnit: "1m_tokens",
    inputYuan: 0.5,
    outputYuan: 2,
  },
  {
    keys: ["qwq-plus", "aliyun-qwq-plus"],
    billUnit: "1m_tokens",
    inputYuan: 1.6,
    outputYuan: 4,
  },
  {
    keys: ["qwen-image-3.0-pro", "aliyun-qwen-image-3.0-pro"],
    billUnit: "image",
    yuan: 0.4,
  },
  {
    keys: ["qwen-image-3.0", "aliyun-qwen-image-3.0", "qwen-image"],
    billUnit: "image",
    yuan: 0.25,
  },
  {
    keys: ["qwen-image-2.0-pro", "aliyun-qwen-image-2.0-pro"],
    billUnit: "image",
    yuan: 0.2,
  },
  {
    keys: ["qwen3-tts-flash", "aliyun-qwen3-tts-flash"],
    billUnit: "request",
    yuan: 0.02,
  },

  // —— 代理站：按厂商公开刊例（美元×7.2 约合人民币）——
  {
    keys: ["claude-opus-5", "claude-opus-4-6", "claude-opus"],
    billUnit: "1m_tokens",
    inputYuan: 108,
    outputYuan: 540,
  },
  {
    keys: ["claude-sonnet-5", "claude-sonnet-4-6", "claude-fable-5", "claude-sonnet"],
    billUnit: "1m_tokens",
    inputYuan: 21.6,
    outputYuan: 108,
  },
  {
    keys: ["claude-haiku-4-5", "claude-haiku"],
    billUnit: "1m_tokens",
    inputYuan: 5.76,
    outputYuan: 28.8,
  },
  {
    keys: ["gpt-5.5-pro", "gpt-5.4-pro", "gpt-5.2-pro", "gpt-5-pro", "o3-pro", "o1"],
    billUnit: "1m_tokens",
    inputYuan: 108,
    outputYuan: 432,
  },
  {
    keys: [
      "gpt-5.6",
      "gpt-5.6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.2",
      "gpt-5.1",
      "gpt-5",
      "gpt-5.3-codex",
      "o3",
      "o4-mini",
    ],
    billUnit: "1m_tokens",
    inputYuan: 18,
    outputYuan: 72,
  },
  {
    keys: ["gpt-5-mini", "gpt-5-nano", "gpt-5.4-mini", "o3-mini"],
    billUnit: "1m_tokens",
    inputYuan: 2.9,
    outputYuan: 11.5,
  },
  {
    keys: ["gpt-4.1", "gpt-4o"],
    billUnit: "1m_tokens",
    inputYuan: 18,
    outputYuan: 72,
  },
  {
    keys: ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1-nano"],
    billUnit: "1m_tokens",
    inputYuan: 1.08,
    outputYuan: 4.32,
  },
  {
    keys: [
      "gemini-3.1-pro-preview",
      "gemini-2.5-pro",
      "gemini-3.6-flash",
      "gemini-3.7-flash",
      "gemini-3.5-flash",
      "gemini-2.5-flash",
    ],
    billUnit: "1m_tokens",
    inputYuan: 2.5,
    outputYuan: 10,
  },
  {
    keys: ["glm-5.2", "glm-5.1", "glm-5"],
    billUnit: "1m_tokens",
    inputYuan: 2,
    outputYuan: 8,
  },
  {
    keys: ["kimi-k3", "kimi-k2.6", "kimi-k2.5"],
    billUnit: "1m_tokens",
    inputYuan: 2.4,
    outputYuan: 9.6,
  },
  {
    keys: ["MiniMax-M2.5", "minimax-m2.5"],
    billUnit: "1m_tokens",
    inputYuan: 2,
    outputYuan: 8,
  },
  {
    keys: [
      "gemini-flash",
      "gemini-3.1-flash-image",
      "gemini-3.1-flash-image-preview",
      "gemini-3.1-flash-lite-image",
      "gemini-2.5-flash-image",
    ],
    billUnit: "image",
    yuan: 0.8,
  },
  {
    keys: ["gemini-3-pro-image", "gemini-3-pro-image-preview"],
    billUnit: "image",
    yuan: 1.2,
  },
  {
    keys: ["gpt-audio-1.5", "gpt-audio-mini"],
    billUnit: "request",
    yuan: 0.05,
  },

  // —— Suno ——
  {
    keys: [
      "suno-v5",
      "suno-v5-5",
      "suno-v4-5-plus",
      "suno-v4-5",
      "suno-v4-5-all",
      "suno-v4",
    ],
    billUnit: "request",
    yuan: 1.5,
  },
];

/** 出片前每镜约两张 Seedream 关键帧，按 4 秒一镜摊进每秒（元） */
export const ARK_KEYFRAME_PER_SEC_YUAN = (0.22 * 2) / 4;

export const ARK_IMAGE_COST_YUAN: Record<string, number> = {
  "seedream-4.0": 0.2,
  "seedream-4.5": 0.25,
  "seedream-5.0": 0.22,
};

export const ARK_VIDEO_COST_YUAN: Record<string, number> = {
  "seedance-2-mini-480": 0.23,
  "seedance-2-mini-720": 0.5,
  "seedance-2-fast-480": 0.37,
  "seedance-2-fast-720": 0.8,
  "seedance-2-0-480": 0.46,
  "seedance-2-0-720": 0.99,
  "seedance-2-5-480": 0.67,
  "seedance-2-5-720": 1.51,
};

export const GEMINI_IMAGE_COST_YUAN = 0.8;
export const MENTION_COST_YUAN = 0.2;

function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/^aliyun-/, "");
}

function stripDateSuffix(key: string): string {
  return key
    .replace(/-\d{4}-\d{2}-\d{2}$/, "")
    .replace(/-\d{6}$/, "")
    .replace(/-\d{8}$/, "");
}

function expandCandidates(
  candidates: Array<string | null | undefined>,
): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    if (!c) continue;
    const n = normalizeKey(c);
    if (!n) continue;
    out.push(n);
    const stripped = stripDateSuffix(n);
    if (stripped && stripped !== n) out.push(stripped);
    if (n.startsWith("aliyun-")) out.push(n.slice("aliyun-".length));
  }
  return [...new Set(out)];
}

function rowToPricing(hit: OfficialRow): AiModelPricingConfig {
  const pricing: AiModelPricingConfig = {
    billUnit: hit.billUnit,
    currency: "CNY",
    source: "ark_list",
  };
  if (hit.inputYuan != null) pricing.officialInputFen = yuanToFen(hit.inputYuan);
  if (hit.outputYuan != null) pricing.officialOutputFen = yuanToFen(hit.outputYuan);
  if (hit.yuan != null) pricing.officialFen = yuanToFen(hit.yuan);
  return pricing;
}

/** 未精确命中时按家族估官方刊例，避免同步进来的变体显示「—」 */
function familyPricing(key: string): OfficialRow | null {
  const k = stripDateSuffix(key);
  if (/seedream|seededit/.test(k)) {
    return { keys: [], billUnit: "image", yuan: 0.22 };
  }
  if (/seedance/.test(k)) {
    return {
      keys: [],
      billUnit: "video_sec",
      yuan: /720/.test(k) ? 0.99 : 0.46,
    };
  }
  if (/suno/.test(k)) {
    return { keys: [], billUnit: "request", yuan: 1.5 };
  }
  if (/(image|imagen|dall-e|flux)/.test(k) && !/vl-|qvq/.test(k)) {
    if (/pro/.test(k)) return { keys: [], billUnit: "image", yuan: 1.2 };
    return { keys: [], billUnit: "image", yuan: 0.8 };
  }
  if (/tts|audio|speech|whisper/.test(k)) {
    return { keys: [], billUnit: "request", yuan: 0.05 };
  }
  if (/claude.*opus/.test(k)) {
    return { keys: [], billUnit: "1m_tokens", inputYuan: 108, outputYuan: 540 };
  }
  if (/claude.*haiku/.test(k)) {
    return { keys: [], billUnit: "1m_tokens", inputYuan: 5.76, outputYuan: 28.8 };
  }
  if (/claude/.test(k)) {
    return { keys: [], billUnit: "1m_tokens", inputYuan: 21.6, outputYuan: 108 };
  }
  if (/gpt-4o-mini|gpt-4\.1-mini|gpt-4\.1-nano|gpt-5-mini|gpt-5-nano|o3-mini|o4-mini/.test(k)) {
    return { keys: [], billUnit: "1m_tokens", inputYuan: 1.08, outputYuan: 4.32 };
  }
  if (/gpt-5.*pro|o3-pro|o1\b|o1-pro/.test(k)) {
    return { keys: [], billUnit: "1m_tokens", inputYuan: 108, outputYuan: 432 };
  }
  if (/^gpt-|^o[1-4]\b/.test(k)) {
    return { keys: [], billUnit: "1m_tokens", inputYuan: 18, outputYuan: 72 };
  }
  if (/gemini.*pro.*image|imagen/.test(k)) {
    return { keys: [], billUnit: "image", yuan: 1.2 };
  }
  if (/gemini.*image/.test(k)) {
    return { keys: [], billUnit: "image", yuan: 0.8 };
  }
  if (/gemini/.test(k)) {
    return { keys: [], billUnit: "1m_tokens", inputYuan: 2.5, outputYuan: 10 };
  }
  if (/deepseek.*(pro|reasoner)/.test(k)) {
    return { keys: [], billUnit: "1m_tokens", inputYuan: 9, outputYuan: 27 };
  }
  if (/deepseek/.test(k)) {
    return { keys: [], billUnit: "1m_tokens", inputYuan: 3, outputYuan: 9 };
  }
  if (/qwen.*flash|qwen-turbo|qwen3\.7-flash|qwen3\.5-flash|qwen3\.6-flash/.test(k)) {
    return { keys: [], billUnit: "1m_tokens", inputYuan: 0.2, outputYuan: 0.8 };
  }
  if (/qwen.*(max|3\.8)|qwen3-max/.test(k)) {
    return { keys: [], billUnit: "1m_tokens", inputYuan: 12, outputYuan: 36 };
  }
  if (/qwen|qwq|qvq|aliyun-qwen/.test(k)) {
    return { keys: [], billUnit: "1m_tokens", inputYuan: 0.8, outputYuan: 2 };
  }
  if (/glm|chatglm/.test(k)) {
    return { keys: [], billUnit: "1m_tokens", inputYuan: 2, outputYuan: 8 };
  }
  if (/kimi|moonshot/.test(k)) {
    return { keys: [], billUnit: "1m_tokens", inputYuan: 2.4, outputYuan: 9.6 };
  }
  if (/minimax/.test(k)) {
    return { keys: [], billUnit: "1m_tokens", inputYuan: 2, outputYuan: 8 };
  }
  if (/doubao|seed-2|seed-1/.test(k)) {
    return { keys: [], billUnit: "1m_tokens", inputYuan: 0.8, outputYuan: 2 };
  }
  return null;
}

export function lookupArkOfficialPricing(
  ...candidates: Array<string | null | undefined>
): AiModelPricingConfig | null {
  const keys = expandCandidates(candidates);
  if (!keys.length) return null;

  // 更长 key 优先，避免 seedance-2-0 误吃 seedance-2-0-mini
  const scored: Array<{ row: OfficialRow; score: number }> = [];
  for (const row of OFFICIAL_ROWS) {
    const rowKeys = row.keys.map(normalizeKey);
    let best = 0;
    for (const k of keys) {
      for (const rk of rowKeys) {
        if (k === rk || stripDateSuffix(k) === rk) {
          best = Math.max(best, rk.length + 100);
        } else if (k.startsWith(`${rk}-`) || rk.startsWith(`${stripDateSuffix(k)}-`) || rk === stripDateSuffix(k)) {
          best = Math.max(best, Math.min(k.length, rk.length));
        }
      }
    }
    if (best > 0) scored.push({ row, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  const hit = scored[0]?.row;
  if (hit) return rowToPricing(hit);

  for (const k of keys) {
    const fam = familyPricing(k);
    if (fam) return rowToPricing(fam);
  }
  return null;
}

/** 全渠道刊例查找（与 lookupArkOfficialPricing 同一表） */
export const lookupOfficialPricing = lookupArkOfficialPricing;

export function costHintFromOfficial(
  pricing: AiModelPricingConfig | null | undefined,
): string {
  if (!pricing) return "";
  if (pricing.billUnit === "1m_tokens") {
    const inn =
      pricing.officialInputFen != null ? fenToYuan(pricing.officialInputFen) : null;
    const out =
      pricing.officialOutputFen != null ? fenToYuan(pricing.officialOutputFen) : null;
    if (inn != null && out != null) {
      return `官方 ¥${inn}/百万入 · ¥${out}/百万出`;
    }
  }
  if (pricing.officialFen != null) {
    const y = fenToYuan(pricing.officialFen);
    if (pricing.billUnit === "image") return `官方 ¥${y}/张`;
    if (pricing.billUnit === "video_sec") return `官方 ¥${y}/秒`;
    if (pricing.billUnit === "request") return `官方 ¥${y}/次`;
  }
  return "";
}
