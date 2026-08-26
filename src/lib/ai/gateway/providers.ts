import { resolveDeepSeekConfig } from "@/lib/ai/deepseek";
import { resolveDoubaoEnvConfig } from "@/lib/ai/doubao";
import { hasSunoReady } from "@/lib/ai/model-catalog/music-seed";
import {
  hasCloudflareAiReady,
  resolveCloudflareAiOpenAiBase,
  resolveCloudflareAiToken,
} from "@/lib/ai/model-catalog/cloudflare-seed";
import {
  resolveQwenApiKey,
  resolveQwenOpenAiBase,
} from "@/lib/ai/model-catalog/qwen-seed";
import {
  hasCursorApiReady,
  resolveCursorApiKey,
  resolveCursorOpenAiBase,
} from "@/lib/ai/model-catalog/cursor-seed";
import type { AiProviderChannel } from "@/lib/ai/model-catalog/types";

function openAiBaseUrl() {
  return (process.env.OPENAI_BASE_URL?.trim() || "").replace(/\/$/, "");
}

function hasOpenAiKey() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function hasArkKey() {
  if (process.env.ARK_API_KEY?.trim() || resolveDoubaoEnvConfig()?.apiKey) {
    return true;
  }
  // 历史上查排名页写过方舟 Key，仍当作已配
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getDoubaoStoredSecret } = require("@/lib/db") as {
      getDoubaoStoredSecret: () => { apiKey: string };
    };
    return Boolean(getDoubaoStoredSecret()?.apiKey?.trim());
  } catch {
    return false;
  }
}

function hasQwenKey() {
  return Boolean(resolveQwenApiKey() && resolveQwenOpenAiBase());
}

function isOpenRouterBase() {
  return /openrouter\.ai/i.test(openAiBaseUrl());
}

/** 通道密钥是否已配置（不含 enabled / 模型是否存在） */
export function providerChannelReady(channel: AiProviderChannel): boolean {
  switch (channel) {
    case "deepseek":
      return Boolean(resolveDeepSeekConfig());
    case "openrouter":
      return (
        hasOpenAiKey() &&
        (isOpenRouterBase() || /openai-proxy|proxy\.org/i.test(openAiBaseUrl()))
      );
    case "gemini":
      return hasOpenAiKey();
    case "anthropic":
      return hasOpenAiKey() && Boolean(openAiBaseUrl());
    case "ark":
    case "doubao":
      return hasArkKey();
    case "qwen":
      return hasQwenKey();
    case "suno":
      return hasSunoReady();
    case "cloudflare":
      return hasCloudflareAiReady();
    case "cursor":
      return hasCursorApiReady();
    default:
      return false;
  }
}

export function openAiCompatibleTransport(
  channel: AiProviderChannel,
): { apiKey: string; baseUrl: string; label: string } | null {
  if (channel === "qwen") {
    const apiKey = resolveQwenApiKey();
    const base = resolveQwenOpenAiBase();
    if (!apiKey || !base) return null;
    return { apiKey, baseUrl: base, label: "通义千问 MaaS" };
  }
  if (channel === "cloudflare") {
    const apiKey = resolveCloudflareAiToken();
    const base = resolveCloudflareAiOpenAiBase();
    if (!apiKey || !base) return null;
    return { apiKey, baseUrl: base, label: "Cloudflare Workers AI" };
  }
  if (channel === "cursor") {
    const apiKey = resolveCursorApiKey();
    const base = resolveCursorOpenAiBase();
    if (!apiKey || !base) return null;
    return { apiKey, baseUrl: base, label: "Cursor API" };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim() || "";
  if (!apiKey) return null;
  if (channel === "openrouter") {
    // OpenRouter 或本站 openai-proxy 都可走同一 Key
    if (!isOpenRouterBase() && !/openai-proxy|proxy\.org/i.test(openAiBaseUrl())) {
      return null;
    }
    const base = openAiBaseUrl() || "https://openrouter.ai/api/v1";
    return {
      apiKey,
      baseUrl: base.endsWith("/v1") ? base : `${base}/v1`,
      label: isOpenRouterBase() ? "OpenRouter" : "代理站",
    };
  }
  if (channel === "gemini" || channel === "anthropic") {
    const base = openAiBaseUrl() || "https://api.openai-proxy.org/v1";
    return {
      apiKey,
      baseUrl: base.endsWith("/v1") ? base : `${base}/v1`,
      label: channel === "anthropic" ? "Claude 代理" : "代理站",
    };
  }
  if (channel === "doubao" && /volces|ark/i.test(openAiBaseUrl())) {
    const base = openAiBaseUrl();
    return {
      apiKey,
      baseUrl: base.endsWith("/v1") ? base : `${base}/v1`,
      label: "豆包",
    };
  }
  return null;
}

export function providerChannelHint(channel: AiProviderChannel): string {
  switch (channel) {
    case "deepseek":
      return "配置 DEEPSEEK_API_KEY";
    case "openrouter":
      return "OPENAI_API_KEY + OpenRouter 或 openai-proxy BASE_URL";
    case "gemini":
      return "OPENAI_API_KEY + OPENAI_BASE_URL（openai-proxy）";
    case "anthropic":
      return "OPENAI_API_KEY + OPENAI_BASE_URL（代理站 Claude）";
    case "ark":
      return "ARK_API_KEY";
    case "doubao":
      return "ARK_API_KEY";
    case "qwen":
      return "DASHSCOPE_API_KEY + QWEN_BASE_URL（…/compatible-mode/v1）";
    case "suno":
      return "SUNO_API_KEY（sunoapi.org），或 SUNO_PROVIDER=gcui + SUNO_API_URL";
    case "cloudflare":
      return "CLOUDFLARE_AI_TOKEN（或 CLOUDFLARE_API_TOKEN）+ CLOUDFLARE_ACCOUNT_ID";
    case "cursor":
      return "CURSOR_API_KEY（Dashboard → API Keys），可选 CURSOR_BASE_URL";
    default:
      return "未配置";
  }
}
