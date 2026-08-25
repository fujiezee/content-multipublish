/**
 * 点物统一模型网关 — 前台与未来 OpenAPI 都只调这一层。
 * Admin 维护 ai_models 表；此处按 modality 路由到各 provider 适配器。
 */
import type { StreamChunk } from "@/lib/ai/deepseek";
import type { ImageInlineRef } from "@/lib/ai/openai-image";
import {
  completeScriptLlm,
  streamScriptLlm,
} from "@/lib/ai/script-llm";
import type {
  AiModality,
  ListAiModelsQuery,
} from "@/lib/ai/model-catalog/types";
import { modelHasBillablePrice } from "@/lib/ai/model-catalog/pricing";
import { listAiModels } from "@/lib/db";

export type { GatewayMessage } from "@/lib/ai/gateway/parse";
export {
  parseGatewayImageBody,
  parseGatewayMessages,
  parseGatewayTextBody,
} from "@/lib/ai/gateway/parse";

export type GatewayListQuery = ListAiModelsQuery & {
  /** 仅返回 ready 且 enabled 的（前台默认 true） */
  readyOnly?: boolean;
  /** 仅返回有刊例可售的（前台默认 true） */
  pricedOnly?: boolean;
};

export function gatewayListModels(
  query: GatewayListQuery = {},
) {
  let rows = listAiModels({
    modality: query.modality,
    use: query.use,
    enabledOnly: query.enabledOnly ?? true,
  });
  if (query.pricedOnly !== false) {
    rows = rows.filter(modelHasBillablePrice);
  }
  if (query.readyOnly === false) return rows;
  return rows.filter((m) => m.ready);
}

export function gatewayGetModel(slug: string) {
  return listAiModels({ enabledOnly: false }).find((m) => m.slug === slug);
}

export function gatewayRequireModel(slug: string, modality: AiModality) {
  const model = gatewayGetModel(slug);
  if (!model) throw new Error(`未知模型：${slug}`);
  if (!model.enabled) throw new Error(`模型已停用：${model.label}`);
  if (model.modality !== modality) {
    throw new Error(`${model.label} 不是 ${modality} 模型`);
  }
  if (!model.ready) throw new Error(`「${model.label}」通道未配置密钥`);
  if (!modelHasBillablePrice(model)) {
    throw new Error(`「${model.label}」无刊例，不能调用`);
  }
  return model;
}

/** 文本：流式（写稿 / 剧本 / 改写） */
export async function* gatewayTextStream(
  slug: string,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): AsyncGenerator<StreamChunk> {
  const model = gatewayRequireModel(slug, "text");
  yield* streamScriptLlm(messages, {
    ...options,
    model: model.slug,
    catalogModel: model,
  });
}

/** 文本：一次性完成 */
export async function gatewayTextComplete(
  slug: string,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  },
): Promise<string> {
  const model = gatewayRequireModel(slug, "text");
  return completeScriptLlm(messages, {
    ...options,
    model: model.slug,
    catalogModel: model,
  });
}

/** 图片：文生图（封面 / 信息图 / 角色 / 分镜） */
export async function gatewayImageGenerate(
  slug: string,
  input: {
    prompt: string;
    aspectRatio?: string;
    references?: ImageInlineRef[];
  },
): Promise<{ url: string; model: string; slug: string; provider: string }> {
  const catalog = gatewayRequireModel(slug, "image");
  const { generateImageWithChat } = await import("@/lib/ai/openai-image");
  const out = await generateImageWithChat(input.prompt, {
    aspectRatio: input.aspectRatio,
    references: input.references,
    model: catalog.slug,
  });
  return {
    ...out,
    slug: catalog.slug,
    provider: catalog.provider,
  };
}

/** 视频：列出目录中的模型（preset 仍走 ark-video 组合逻辑） */
export function gatewayVideoModels() {
  return gatewayListModels({ modality: "video", use: "video" });
}

export async function gatewayVideoPresets() {
  const { listArkVideoPresets } = await import("@/lib/ai/ark-video");
  return listArkVideoPresets();
}

/** 对外能力说明 */
export function gatewayOpenApiSpec() {
  return {
    name: "Dianwu Model Gateway",
    version: "0.3.1",
    modalities: ["text", "image", "video"] as const,
    docs: "https://dianwu.tech/api-hub/docs",
    openaiCompatible: {
      baseUrl: "https://api.dianwu.ai/v1",
      models: "GET /v1/models",
      chatCompletions: "POST /v1/chat/completions",
    },
    endpoints: {
      spec: "GET /api/gateway/v1",
      listModels: "GET /api/models?modality=text|image|video",
      textComplete: "POST /api/gateway/v1/text/complete",
      textStream: "POST /api/gateway/v1/text/stream",
      imageGenerate: "POST /api/gateway/v1/image/generate",
      videoPresets: "GET /api/gateway/v1/video/presets",
    },
  };
}
