/** 模态：前台与网关按此严格分类 */
export type AiModality = "text" | "image" | "video" | "audio" | "music";

/** 上游通道（密钥仍在 env / Worker secrets，不进库） */
export type AiProviderChannel =
  | "deepseek"
  | "openrouter"
  | "ark"
  | "gemini"
  | "anthropic"
  | "doubao"
  | "qwen"
  | "suno"
  | "cloudflare"
  | "cursor";

/** 业务用途：一条模型可勾选多个，决定出现在哪些前台下拉 */
export type AiModelUse =
  | "copywriting"
  | "script"
  | "shot"
  | "review"
  | "infographic"
  | "cover"
  | "character"
  | "video"
  | "tts"
  | "asr"
  | "music";

export type AiModelRecord = {
  id: string;
  slug: string;
  label: string;
  hint: string;
  modality: AiModality;
  /** JSON string: AiModelUse[] */
  uses_json: string;
  provider: AiProviderChannel;
  /** 发给上游 API 的 model 名 */
  provider_model: string;
  /** JSON：temperature、max_tokens、分辨率、fallback 等扩展 */
  config_json: string;
  enabled: number;
  sort_order: number;
  cost_hint: string;
  fallback_slug: string;
  created_at: string;
  updated_at: string;
};

export type AiBillUnit = "1m_tokens" | "image" | "video_sec" | "request";

/** 写入 config_json 的官方刊例（单位：分 / billUnit；token 为每百万） */
export type AiModelPricingConfig = {
  billUnit: AiBillUnit;
  officialInputFen?: number;
  officialOutputFen?: number;
  /** 图 / 视频秒 / 次 等单计量官方成本（分） */
  officialFen?: number;
  currency: "CNY";
  source: "ark_list" | "manual" | "cloudflare";
  syncedAt?: string;
};

/** 按调用方套餐算好的展示价 */
export type AiModelPricingView = {
  billUnit: AiBillUnit;
  currency: "CNY";
  markup: number;
  planId: string;
  official: {
    inputFen?: number;
    outputFen?: number;
    fen?: number;
  };
  sell: {
    inputFen?: number;
    outputFen?: number;
    fen?: number;
  };
};

/** 前台弹层推荐标记（存 config_json.badges） */
export type AiModelBadge = "recommended" | "hot" | "new";

export const AI_MODEL_BADGES: { id: AiModelBadge; label: string; hint: string }[] =
  [
    { id: "recommended", label: "推荐", hint: "弹层置顶推荐" },
    { id: "hot", label: "最热", hint: "用户常选" },
    { id: "new", label: "最新", hint: "新上架" },
  ];

export type AiModelConfig = {
  temperature?: number;
  maxTokens?: number;
  resolutions?: string[];
  maxSec?: number;
  generateAudio?: boolean;
  tokenField?: "max_tokens" | "max_completion_tokens";
  omitTemperature?: boolean;
  pricing?: AiModelPricingConfig;
  /** 前台选择器推荐标记 */
  badges?: AiModelBadge[];
};

export type AiModelView = {
  id: string;
  slug: string;
  label: string;
  hint: string;
  modality: AiModality;
  uses: AiModelUse[];
  provider: AiProviderChannel;
  providerModel: string;
  config: AiModelConfig;
  enabled: boolean;
  sortOrder: number;
  costHint: string;
  fallbackSlug: string;
  /** 通道密钥已配且 enabled */
  ready: boolean;
  createdAt: string;
  updatedAt: string;
  /** 按调用方 plan 计算；列表 API 注入 */
  pricing?: AiModelPricingView | null;
  badges: AiModelBadge[];
};

export type AiModelInput = {
  slug: string;
  label: string;
  hint?: string;
  modality: AiModality;
  uses: AiModelUse[];
  provider: AiProviderChannel;
  providerModel: string;
  config?: AiModelConfig;
  enabled?: boolean;
  sortOrder?: number;
  costHint?: string;
  fallbackSlug?: string;
  badges?: AiModelBadge[];
};

export type ListAiModelsQuery = {
  modality?: AiModality;
  use?: AiModelUse;
  enabledOnly?: boolean;
};

export const AI_MODALITIES: { id: AiModality; label: string }[] = [
  { id: "text", label: "文本" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "audio", label: "语音" },
  { id: "music", label: "音乐" },
];

export const AI_MODEL_USES: { id: AiModelUse; label: string; modality: AiModality }[] = [
  { id: "copywriting", label: "AI 写稿", modality: "text" },
  { id: "script", label: "短视频剧本", modality: "text" },
  { id: "shot", label: "单镜改写", modality: "text" },
  { id: "review", label: "人话审核", modality: "text" },
  { id: "infographic", label: "信息图", modality: "image" },
  { id: "cover", label: "文章封面", modality: "image" },
  { id: "character", label: "角色 / 分镜出图", modality: "image" },
  { id: "video", label: "短视频出片", modality: "video" },
  { id: "tts", label: "配音 TTS", modality: "audio" },
  { id: "asr", label: "语音识别", modality: "audio" },
  { id: "music", label: "音乐生成", modality: "music" },
];

export const AI_PROVIDER_CHANNELS: { id: AiProviderChannel; label: string }[] = [
  { id: "deepseek", label: "DeepSeek" },
  { id: "doubao", label: "豆包 / 火山方舟" },
  { id: "qwen", label: "通义千问 (百炼 MaaS)" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "ark", label: "火山方舟（Ark）" },
  { id: "gemini", label: "代理站 (openai-proxy)" },
  { id: "anthropic", label: "Claude（代理站）" },
  { id: "suno", label: "Suno (sunoapi.org)" },
  { id: "cloudflare", label: "Cloudflare AI" },
  { id: "cursor", label: "Cursor API" },
];
