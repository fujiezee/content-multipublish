import type { AiModelInput, AiModelUse, AiModality } from "@/lib/ai/model-catalog/types";
import { shouldSkipSyncImport } from "@/lib/ai/model-catalog/discontinued";

/**
 * openai-proxy.org（OPENAI_BASE_URL）上的精选模型。
 * slug = 代理原名；provider 固定 gemini = 本站「代理站」通道。
 * 带日期后缀的旧版不写进精选，由「同步代理」按需补入。
 */
type ProxySeed = {
  id: string;
  label: string;
  hint: string;
  modality?: AiModality;
  uses?: AiModelUse[];
  costHint?: string;
  sortOrder: number;
  enabled?: boolean;
  fallbackSlug?: string;
  config?: AiModelInput["config"];
};

const PROXY_TEXT: ProxySeed[] = [
  // Claude
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    hint: "对白和节奏稳，写剧本首选",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 100,
    fallbackSlug: "claude-sonnet-4-6",
  },
  {
    id: "claude-opus-5",
    label: "Claude Opus 5",
    hint: "理解更深，复杂剧情更稳",
    uses: ["script", "shot"],
    costHint: "较贵",
    sortOrder: 105,
    fallbackSlug: "claude-sonnet-5",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    hint: "改稿不容易跑偏",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 110,
    fallbackSlug: "claude-sonnet-5",
  },
  {
    id: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    hint: "长剧情和人物关系更准",
    uses: ["script", "shot"],
    costHint: "较贵",
    sortOrder: 115,
    fallbackSlug: "claude-sonnet-4-6",
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    hint: "改得快，适合改一镜",
    uses: ["shot", "copywriting"],
    costHint: "便宜",
    sortOrder: 120,
    fallbackSlug: "gpt-4.1-mini",
  },
  {
    id: "claude-fable-5",
    label: "Claude Fable 5",
    hint: "叙事感强，适合讲故事",
    uses: ["script", "copywriting"],
    sortOrder: 125,
  },
  // GPT
  {
    id: "gpt-5.6",
    label: "GPT-5.6",
    hint: "综合强，写稿分镜都能打",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 200,
    fallbackSlug: "gpt-5.6-luna",
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    hint: "便宜，质量够用",
    uses: ["script", "shot", "copywriting"],
    costHint: "便宜",
    sortOrder: 205,
    fallbackSlug: "gpt-5.4-mini",
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    hint: "推理更足",
    uses: ["script", "shot"],
    sortOrder: 208,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    hint: "落地执行稳",
    uses: ["script", "shot"],
    sortOrder: 209,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    hint: "均衡，日常写稿够用",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 210,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-5.5-pro",
    label: "GPT-5.5 Pro",
    hint: "难任务更准",
    uses: ["script", "shot"],
    costHint: "较贵",
    sortOrder: 212,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    hint: "写稿分镜稳",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 215,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    hint: "轻量快改",
    uses: ["shot", "copywriting"],
    costHint: "便宜",
    sortOrder: 218,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-5.4-pro",
    label: "GPT-5.4 Pro",
    hint: "难任务更准",
    uses: ["script", "shot"],
    costHint: "较贵",
    sortOrder: 220,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-5.2",
    label: "GPT-5.2",
    hint: "写稿分镜都能打",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 225,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-5.2-pro",
    label: "GPT-5.2 Pro",
    hint: "高档，难任务更准",
    uses: ["script", "shot"],
    costHint: "较贵",
    sortOrder: 228,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-5.1",
    label: "GPT-5.1",
    hint: "写稿分镜都能打",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 230,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-5",
    label: "GPT-5",
    hint: "写稿分镜都能打",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 235,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-5-mini",
    label: "GPT-5 Mini",
    hint: "快，适合小改",
    uses: ["shot", "copywriting"],
    costHint: "便宜",
    sortOrder: 238,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-5-nano",
    label: "GPT-5 Nano",
    hint: "极轻，适合试跑",
    uses: ["shot"],
    costHint: "便宜",
    sortOrder: 240,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-5-pro",
    label: "GPT-5 Pro",
    hint: "高档，难任务更准",
    uses: ["script", "shot"],
    costHint: "较贵",
    sortOrder: 242,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    hint: "写代码强",
    uses: ["shot"],
    sortOrder: 245,
    enabled: false,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    hint: "指令跟得紧，写稿稳",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 250,
    fallbackSlug: "gpt-4o",
  },
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 Mini",
    hint: "便宜稳",
    uses: ["shot", "copywriting"],
    costHint: "便宜",
    sortOrder: 252,
  },
  {
    id: "gpt-4.1-nano",
    label: "GPT-4.1 Nano",
    hint: "极轻，适合试跑",
    uses: ["shot"],
    costHint: "便宜",
    sortOrder: 254,
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    hint: "能看图，写稿分镜稳",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 260,
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o Mini",
    hint: "便宜快",
    uses: ["shot", "copywriting"],
    costHint: "便宜",
    sortOrder: 262,
  },
  // o 系列
  {
    id: "o3",
    label: "o3",
    hint: "强推理，适合想清楚再写",
    uses: ["script", "shot"],
    costHint: "较贵",
    sortOrder: 280,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "o3-mini",
    label: "o3 Mini",
    hint: "轻推理，想一步再写",
    uses: ["shot"],
    sortOrder: 282,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "o3-pro",
    label: "o3 Pro",
    hint: "最强推理",
    uses: ["script"],
    costHint: "较贵",
    sortOrder: 284,
    enabled: false,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "o4-mini",
    label: "o4 Mini",
    hint: "推理快",
    uses: ["shot"],
    sortOrder: 286,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  {
    id: "o1",
    label: "o1",
    hint: "会先想再写，旧版推理",
    uses: ["script"],
    costHint: "较贵",
    sortOrder: 288,
    enabled: false,
    config: { tokenField: "max_completion_tokens", omitTemperature: true },
  },
  // Gemini text
  {
    id: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    hint: "快，适合改稿",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 300,
  },
  {
    id: "gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    hint: "快且更稳",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 302,
  },
  {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    hint: "又快，适合改稿",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 304,
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    hint: "长文理解好",
    uses: ["script", "copywriting"],
    sortOrder: 310,
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    hint: "长文更稳",
    uses: ["script", "copywriting"],
    sortOrder: 315,
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    hint: "快改",
    uses: ["shot", "copywriting"],
    costHint: "便宜",
    sortOrder: 318,
  },
  // 国产 / 其他经代理
  {
    id: "glm-5.2",
    label: "GLM-5.2",
    hint: "中文对白自然",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 400,
    fallbackSlug: "glm-5.1",
  },
  {
    id: "glm-5.1",
    label: "GLM-5.1",
    hint: "中文对白自然",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 402,
  },
  {
    id: "glm-5",
    label: "GLM-5",
    hint: "中文对白自然",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 404,
  },
  {
    id: "qwen3.8-max",
    label: "Qwen 3.8 Max",
    hint: "中文理解强",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 410,
  },
  {
    id: "qwen3.7-plus",
    label: "Qwen 3.7 Plus",
    hint: "质量够稳，适合日常写稿",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 412,
  },
  {
    id: "qwen3.7-max",
    label: "Qwen 3.7 Max",
    hint: "中文旗舰",
    uses: ["script", "copywriting"],
    sortOrder: 414,
  },
  {
    id: "qwen3.6-plus",
    label: "Qwen 3.6 Plus",
    hint: "中文快改",
    uses: ["shot", "copywriting"],
    sortOrder: 416,
  },
  {
    id: "qwen3.5-plus",
    label: "Qwen 3.5 Plus",
    hint: "轻量写稿",
    uses: ["copywriting"],
    sortOrder: 418,
  },
  {
    id: "kimi-k3",
    label: "Kimi K3",
    hint: "长文记忆好",
    uses: ["script", "copywriting"],
    sortOrder: 430,
  },
  {
    id: "kimi-k2.6",
    label: "Kimi K2.6",
    hint: "超长上下文，适合长稿",
    uses: ["script", "copywriting"],
    sortOrder: 432,
  },
  {
    id: "kimi-k2.5",
    label: "Kimi K2.5",
    hint: "超长上下文，适合长稿",
    uses: ["copywriting"],
    sortOrder: 434,
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    hint: "思考更深",
    uses: ["script", "shot", "copywriting"],
    sortOrder: 440,
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    hint: "更快更便宜",
    uses: ["shot", "copywriting"],
    costHint: "便宜",
    sortOrder: 442,
  },
  {
    id: "deepseek-v3.2",
    label: "DeepSeek V3.2",
    hint: "便宜稳",
    uses: ["script", "copywriting"],
    sortOrder: 444,
  },
  {
    id: "MiniMax-M2.5",
    label: "MiniMax M2.5",
    hint: "中文口语感",
    uses: ["script", "copywriting"],
    sortOrder: 450,
  },
];

const PROXY_IMAGE: ProxySeed[] = [
  {
    id: "gemini-flash",
    label: "Gemini 出图",
    hint: "排版清楚，适合信息图和封面",
    modality: "image",
    uses: ["infographic", "cover"],
    sortOrder: 39,
  },
  {
    id: "gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash 出图",
    hint: "排版清楚，适合信息图",
    modality: "image",
    uses: ["infographic", "cover"],
    sortOrder: 40,
  },
  {
    id: "gemini-3.1-flash-image-preview",
    label: "Gemini 3.1 Flash 出图 Preview",
    hint: "出图快，适合试构图",
    modality: "image",
    uses: ["infographic", "cover"],
    sortOrder: 41,
    enabled: false,
  },
  {
    id: "gemini-3.1-flash-lite-image",
    label: "Gemini 3.1 Flash Lite 出图",
    hint: "出图快，适合批量",
    costHint: "便宜",
    modality: "image",
    uses: ["infographic", "cover"],
    sortOrder: 42,
  },
  {
    id: "gemini-3-pro-image",
    label: "Gemini 3 Pro 出图",
    hint: "构图更稳，适合角色图",
    modality: "image",
    uses: ["infographic", "cover", "character"],
    sortOrder: 50,
  },
  {
    id: "gemini-3-pro-image-preview",
    label: "Gemini 3 Pro 出图 Preview",
    hint: "构图更稳，适合成品",
    modality: "image",
    uses: ["infographic", "cover", "character"],
    sortOrder: 51,
    enabled: false,
  },
  {
    id: "gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash 出图",
    hint: "出图快，人物比较稳",
    modality: "image",
    uses: ["infographic", "cover"],
    sortOrder: 55,
  },
];

const PROXY_AUDIO: ProxySeed[] = [
  {
    id: "gpt-audio-1.5",
    label: "GPT Audio 1.5",
    hint: "配音自然",
    modality: "audio",
    uses: ["tts"],
    sortOrder: 50,
    enabled: false,
  },
  {
    id: "gpt-audio-mini",
    label: "GPT Audio Mini",
    hint: "配音快，适合试听",
    modality: "audio",
    uses: ["tts"],
    sortOrder: 52,
    enabled: false,
  },
];

function toInput(row: ProxySeed): AiModelInput {
  const modality = row.modality || "text";
  const uses =
    row.uses ||
    (modality === "image"
      ? (["infographic", "cover"] as AiModelUse[])
      : modality === "audio"
        ? (["tts"] as AiModelUse[])
        : (["script", "shot", "copywriting", "review"] as AiModelUse[]));
  return {
    slug: row.id,
    label: row.label,
    hint: row.hint,
    modality,
    uses,
    provider: "gemini",
    providerModel:
      row.id === "gemini-flash" ? "gemini-3.1-flash-image" : row.id,
    costHint: row.costHint || "",
    sortOrder: row.sortOrder,
    enabled: row.enabled !== false,
    fallbackSlug: row.fallbackSlug,
    config: row.config,
  };
}

/** 精选代理模型（写入 seed / 补种） */
export const PROXY_AI_MODEL_SEED: AiModelInput[] = [
  ...PROXY_TEXT,
  ...PROXY_IMAGE,
  ...PROXY_AUDIO,
].map(toInput);

const DATED_SUFFIX = /-\d{8}$/;

export function isDatedProxyModelId(id: string): boolean {
  return DATED_SUFFIX.test(id);
}

function proxyStrengthHint(raw: string, modality: AiModality, dated: boolean): string {
  const n = raw.toLowerCase();
  if (dated) return "旧版快照，适合对照旧稿";
  if (modality === "image") {
    return /pro/.test(n) ? "构图更稳，适合成品" : "出图快，适合信息图和封面";
  }
  if (modality === "audio") return "配音自然";
  if (modality === "video") return "按提示出短视频";
  if (/claude/.test(n) && /opus/.test(n)) return "理解更深，长文不容易跑偏";
  if (/claude/.test(n) && /haiku/.test(n)) return "又快又便宜，适合改稿";
  if (/claude/.test(n)) return "指令跟得紧，写稿分镜稳";
  if (/gemini/.test(n) && /flash/.test(n)) return "又快又能看图";
  if (/gemini/.test(n)) return "能看图，长文理解好";
  if (/qwen/.test(n) && /flash|turbo/.test(n)) return "中文快改";
  if (/qwen/.test(n)) return "中文写稿稳";
  if (/glm/.test(n)) return "中文对白自然";
  if (/kimi/.test(n)) return "超长上下文，适合长稿";
  if (/deepseek/.test(n) && /pro|reasoner/.test(n)) return "推理更深，适合难稿";
  if (/deepseek/.test(n)) return "又快又便宜，适合改稿";
  if (/gpt/.test(n) && /mini|nano/.test(n)) return "又快又便宜，适合改稿";
  if (/gpt/.test(n)) return "写稿分镜都能打";
  return "适合写稿和改稿";
}

/** 从代理 /models 列表生成目录项（跳过已有精选；日期版默认停用） */
export function proxyModelIdToInput(id: string): AiModelInput | null {
  const raw = id.trim();
  if (!raw) return null;
  if (/embedding|whisper|dall-e|tts-1|moderation|realtime/i.test(raw)) {
    return null;
  }
  if (shouldSkipSyncImport(raw, "proxy")) return null;

  const known = PROXY_AI_MODEL_SEED.find((m) => m.slug === raw);
  if (known) return known;

  let modality: AiModality = "text";
  let uses: AiModelUse[] = ["script", "shot", "copywriting", "review"];
  if (/image/i.test(raw)) {
    modality = "image";
    uses = /pro/i.test(raw)
      ? ["infographic", "cover", "character"]
      : ["infographic", "cover"];
  } else if (/audio|tts/i.test(raw)) {
    modality = "audio";
    uses = ["tts"];
  } else if (/seedance|video/i.test(raw)) {
    modality = "video";
    uses = ["video"];
  }

  const dated = isDatedProxyModelId(raw);
  const label = raw
    .replace(DATED_SUFFIX, "")
    .replace(/^claude-/i, "Claude ")
    .replace(/^gpt-/i, "GPT-")
    .replace(/^gemini-/i, "Gemini ")
    .replace(/^qwen/i, "Qwen ")
    .replace(/^glm-/i, "GLM-")
    .replace(/^kimi-/i, "Kimi ")
    .replace(/^deepseek-/i, "DeepSeek ")
    .replace(/^o(\d)/i, "o$1");

  return {
    slug: raw,
    label: dated ? `${label} (${raw.slice(-8)})` : label,
    hint: proxyStrengthHint(raw, modality, dated),
    modality,
    uses,
    provider: "gemini",
    providerModel: raw,
    costHint: "",
    sortOrder: dated ? 900 : 500,
    enabled: !dated && modality !== "audio",
    config:
      /gpt-5|\bo[1-4](?:-|$)|luna|sol|terra/i.test(raw)
        ? { tokenField: "max_completion_tokens", omitTemperature: true }
        : undefined,
  };
}

export function resolveProxyOpenAiBase(): string {
  let base =
    process.env.OPENAI_BASE_URL?.trim() || "https://api.openai-proxy.org/v1";
  base = base.replace(/\/$/, "");
  if (!base.endsWith("/v1")) base = `${base}/v1`;
  return base;
}

export async function fetchProxyModelIds(): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("未配置 OPENAI_API_KEY，无法拉取代理模型列表");
  const base = resolveProxyOpenAiBase();
  const res = await fetch(`${base}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`拉取代理模型失败 ${res.status}: ${raw.slice(0, 200)}`);
  }
  let json: { data?: Array<{ id?: string }> } = {};
  try {
    json = JSON.parse(raw) as typeof json;
  } catch {
    throw new Error("代理 /models 返回不是 JSON");
  }
  return (json.data || [])
    .map((row) => String(row.id || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}
