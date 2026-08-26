import { AsyncLocalStorage } from "node:async_hooks";
import {
  chatCompletion as deepseekChat,
  streamChatCompletion as deepseekStream,
  type DeepSeekReasoningEffort,
  type StreamChunk,
} from "@/lib/ai/deepseek";
import type { AiModelView, AiProviderChannel } from "@/lib/ai/model-catalog/types";
import { modelHasBillablePrice } from "@/lib/ai/model-catalog/pricing";
import { listAiModels } from "@/lib/db";
import {
  openAiCompatibleTransport,
} from "@/lib/ai/gateway/providers";

export type ScriptLlmProvider = "deepseek" | "openai" | "anthropic" | "proxy";

export type ScriptLlmOption = {
  id: string;
  provider: ScriptLlmProvider;
  /** 发给代理的模型名；缺省就是 id。目录有名但实例挂了时用来改走能通的档。 */
  model?: string;
  label: string;
  hint: string;
  cost: string;
  fallbackId?: string;
  badges?: Array<"recommended" | "hot" | "new">;
};

/** 公开给页面的写剧本模型。测试档走 OPENAI_BASE_URL 代理，id 按代理原名。 */
export const SCRIPT_LLM_OPTIONS: ScriptLlmOption[] = [
  {
    id: "deepseek-reasoner",
    provider: "deepseek",
    label: "DeepSeek 思考",
    hint: "现在默认。先想再写 JSON，最便宜",
    cost: "约 ¥0.02/集",
    fallbackId: "deepseek-chat",
  },
  {
    id: "claude-sonnet-5",
    provider: "proxy",
    label: "Claude Sonnet 5",
    hint: "对白和节奏稳，写剧本首选",
    cost: "试写",
    fallbackId: "gpt-5.6-luna",
  },
  {
    id: "gpt-5.6-luna",
    provider: "proxy",
    label: "GPT-5.6 Luna",
    hint: "便宜，质量够用",
    cost: "试写",
    fallbackId: "glm-5.2",
  },
  {
    id: "glm-5.2",
    provider: "proxy",
    label: "GLM-5.2",
    hint: "中文对白自然",
    cost: "试写",
    fallbackId: "deepseek-reasoner",
  },
  {
    id: "deepseek-chat",
    provider: "deepseek",
    label: "DeepSeek 对话",
    hint: "更快，少思考，适合改一集",
    cost: "约 ¥0.01/集",
  },
];

const store = new AsyncLocalStorage<string>();

function hasDeepSeekKey() {
  if (process.env.DEEPSEEK_API_KEY?.trim()) return true;
  const base = process.env.DEEPSEEK_BASE_URL || "";
  return Boolean(process.env.OPENAI_API_KEY?.trim() && /deepseek/i.test(base));
}

function hasOpenAiKey() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function openaiBaseUrl() {
  return (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
}

export function scriptLlmConfigured(option: ScriptLlmOption): boolean {
  if (option.provider === "deepseek") return hasDeepSeekKey();
  return hasOpenAiKey();
}

function catalogProviderToScript(p: AiProviderChannel): ScriptLlmProvider {
  if (p === "deepseek") return "deepseek";
  return "proxy";
}

function catalogToScriptOption(
  model: AiModelView,
): ScriptLlmOption & { ready: boolean } {
  return {
    id: model.slug,
    provider: catalogProviderToScript(model.provider),
    model: model.providerModel,
    label: model.label,
    hint: model.hint,
    cost: model.costHint,
    fallbackId: model.fallbackSlug || undefined,
    badges: model.badges,
    ready: model.ready && model.enabled,
  };
}

function catalogTextModel(slug: string): AiModelView | undefined {
  try {
    return listAiModels({ modality: "text" }).find((m) => m.slug === slug);
  } catch {
    return undefined;
  }
}

export function listScriptLlmOptions(): Array<
  ScriptLlmOption & { ready: boolean }
> {
  try {
    const catalog = listAiModels({
      modality: "text",
      use: "script",
      enabledOnly: true,
    }).filter(modelHasBillablePrice);
    if (catalog.length) {
      return catalog.map(catalogToScriptOption);
    }
  } catch {
    // DB not ready (build / edge)
  }
  return SCRIPT_LLM_OPTIONS.map((item) => ({
    ...item,
    ready: scriptLlmConfigured(item),
  }));
}

export function defaultScriptLlmId(): string {
  const ready = listScriptLlmOptions().filter((item) => item.ready);
  return (
    ready.find((item) => item.id === "deepseek-reasoner")?.id ||
    ready[0]?.id ||
    "deepseek-reasoner"
  );
}

export function normalizeScriptLlmId(raw?: string | null): string {
  const id = String(raw || "").trim();
  if (listScriptLlmOptions().some((item) => item.id === id)) return id;
  if (SCRIPT_LLM_OPTIONS.some((item) => item.id === id)) return id;
  return defaultScriptLlmId();
}

export function scriptLlmMeta(id?: string | null) {
  const normalized = normalizeScriptLlmId(id);
  const fromCatalog = catalogTextModel(normalized);
  if (fromCatalog) {
    return catalogToScriptOption(fromCatalog);
  }
  return (
    SCRIPT_LLM_OPTIONS.find((item) => item.id === normalized) ||
    SCRIPT_LLM_OPTIONS[0]
  );
}

export function withScriptLlm<T>(
  id: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return store.run(normalizeScriptLlmId(id), fn);
}

export function activeScriptLlmId(): string {
  return store.getStore() || defaultScriptLlmId();
}

function omitsTemperature(model: string): boolean {
  return /claude-(sonnet|opus|haiku)-5|gpt-5/i.test(model);
}

/** GPT-5 / o 系列不认 max_tokens，要改用 max_completion_tokens。 */
export function scriptLlmTokenField(
  model: string,
): "max_tokens" | "max_completion_tokens" {
  return /gpt-5|\bo[1-4](?:-|$)|luna/i.test(model)
    ? "max_completion_tokens"
    : "max_tokens";
}

function chatBody(input: {
  model: string;
  messages: { role: string; content: string }[];
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  extra?: Record<string, unknown>;
}) {
  const limit = input.maxTokens ?? 8192;
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    [scriptLlmTokenField(input.model)]: limit,
    ...input.extra,
  };
  if (input.stream) body.stream = true;
  if (!omitsTemperature(input.model) && input.temperature != null) {
    body.temperature = input.temperature;
  }
  return body;
}

export function scriptLlmRequestModel(id?: string | null) {
  const option = scriptLlmMeta(id);
  return option.model || option.id;
}

export function scriptModelWantsThinking(id?: string | null): boolean {
  const option = scriptLlmMeta(id);
  const blob = `${option.id} ${option.model || ""}`.toLowerCase();
  if (/v4-flash|deepseek-chat/.test(blob) && !/reasoner|v4-pro/.test(blob)) {
    return false;
  }
  return /reasoner|v4-pro|thinking|qwq|\br1\b/.test(blob);
}

export function scriptThinkFields(
  id?: string | null,
  effort?: DeepSeekReasoningEffort,
  disable?: boolean,
): Record<string, unknown> {
  const request = scriptLlmRequestModel(id);
  if (!/deepseek/i.test(`${id || ""} ${request}`)) return {};
  if (disable || !scriptModelWantsThinking(id)) {
    return { thinking: { type: "disabled" } };
  }
  return {
    thinking: { type: "enabled" },
    reasoning_effort: effort || "high",
  };
}

function thinkCallOpts(think: Record<string, unknown>): {
  thinking?: "enabled" | "disabled";
  reasoningEffort?: DeepSeekReasoningEffort;
} {
  const type = (think.thinking as { type?: "enabled" | "disabled" } | undefined)?.type;
  const effort = think.reasoning_effort;
  return {
    thinking: type,
    reasoningEffort:
      effort === "low" || effort === "high" || effort === "max" ? effort : undefined,
  };
}

type ScriptLlmCallOptions = {
  model?: string;
  catalogModel?: AiModelView;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  thinkingEffort?: DeepSeekReasoningEffort;
  disableThinking?: boolean;
};

function proxyErrorMessage(label: string, status: number, raw: string) {
  if (/get_instance_failed/i.test(raw)) {
    return `${label} 代理没挂上这个模型实例，换一档或稍后再试`;
  }
  return `${label} ${status}: ${raw.slice(0, 280)}`;
}

function optionOrThrow(id: string) {
  const fromCatalog = catalogTextModel(id);
  if (fromCatalog) {
    const option = catalogToScriptOption(fromCatalog);
    if (!option.ready) {
      throw new Error(`「${option.label}」通道未配置或已停用`);
    }
    return option;
  }
  const option = scriptLlmMeta(id);
  if (!scriptLlmConfigured(option)) {
    if (option.provider === "openai" || option.provider === "proxy" || option.provider === "anthropic") {
      throw new Error("还没配代理 Key。在 .env.local 写 OPENAI_API_KEY");
    }
    throw new Error("还没配 DeepSeek。在 .env.local 写 DEEPSEEK_API_KEY");
  }
  return option;
}

function resolveCatalogForOption(id: string): AiModelView | undefined {
  return catalogTextModel(id);
}

async function* streamOpenAiCompatible(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options: {
    model: string;
    apiKey: string;
    baseUrl: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    label: string;
    extra?: Record<string, unknown>;
    signal?: AbortSignal;
  },
): AsyncGenerator<StreamChunk> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 180_000;
  let timer = setTimeout(() => controller.abort(), timeoutMs);
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(`${options.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(
        chatBody({
          model: options.model,
          messages,
          stream: true,
          temperature: options.temperature ?? 0.55,
          maxTokens: options.maxTokens,
          extra: options.extra,
        }),
      ),
      signal: controller.signal,
    });
    if (!res.ok) {
      const raw = await res.text();
      throw new Error(proxyErrorMessage(options.label, res.status, raw));
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error(`${options.label} 流式响应不可用`);
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const lineEnd = buffer.indexOf("\n");
        if (lineEnd < 0) break;
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let json: {
          choices?: {
            delta?: { content?: string; reasoning_content?: string };
            finish_reason?: string | null;
          }[];
          error?: { message?: string };
        };
        try {
          json = JSON.parse(data) as typeof json;
        } catch {
          continue;
        }
        if (json.error?.message) throw new Error(json.error.message);
        const choice = json.choices?.[0];
        if (choice?.delta?.reasoning_content) {
          yield { type: "thinking", text: choice.delta.reasoning_content };
        }
        if (choice?.delta?.content) {
          yield { type: "content", text: choice.delta.content };
        }
        if (choice?.finish_reason) {
          yield { type: "finish", reason: choice.finish_reason };
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("已取消生成");
    }
    throw err;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export async function* streamScriptLlm(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: ScriptLlmCallOptions,
): AsyncGenerator<StreamChunk> {
  const modelId = options?.model || activeScriptLlmId();
  const catalog = options?.catalogModel || resolveCatalogForOption(modelId);
  const option = optionOrThrow(modelId);
  const think = scriptThinkFields(
    modelId,
    options?.thinkingEffort,
    options?.disableThinking,
  );

  if (catalog && catalog.provider === "deepseek") {
    yield* deepseekStream(messages, {
      model: catalog.providerModel || option.id,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      timeoutMs: options?.timeoutMs,
      signal: options?.signal,
      ...thinkCallOpts(think),
    });
    return;
  }

  if (catalog && catalog.provider !== "deepseek") {
    const transport = openAiCompatibleTransport(catalog.provider);
    if (transport) {
      yield* streamOpenAiCompatible(messages, {
        model: catalog.providerModel || scriptLlmRequestModel(option.id),
        apiKey: transport.apiKey,
        baseUrl: transport.baseUrl,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        timeoutMs: options?.timeoutMs,
        label: catalog.label,
        extra: think,
        signal: options?.signal,
      });
      return;
    }
  }

  if (option.provider === "deepseek") {
    yield* deepseekStream(messages, {
      model: option.id,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      timeoutMs: options?.timeoutMs,
      signal: options?.signal,
      ...thinkCallOpts(think),
    });
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim() || "";
  yield* streamOpenAiCompatible(messages, {
    model: scriptLlmRequestModel(option.id),
    apiKey,
    baseUrl: openaiBaseUrl(),
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    timeoutMs: options?.timeoutMs,
    label: option.label,
    extra: think,
    signal: options?.signal,
  });
}

export async function completeScriptLlm(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: ScriptLlmCallOptions,
): Promise<string> {
  const modelId = options?.model || activeScriptLlmId();
  const catalog = options?.catalogModel || resolveCatalogForOption(modelId);
  const option = optionOrThrow(modelId);
  const think = scriptThinkFields(
    modelId,
    options?.thinkingEffort,
    options?.disableThinking,
  );

  if (catalog && catalog.provider === "deepseek") {
    return deepseekChat(messages, {
      model: catalog.providerModel || option.id,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      timeoutMs: options?.timeoutMs,
      ...thinkCallOpts(think),
    });
  }

  if (catalog && catalog.provider !== "deepseek") {
    const transport = openAiCompatibleTransport(catalog.provider);
    if (transport) {
      let text = "";
      for await (const chunk of streamOpenAiCompatible(messages, {
        model: catalog.providerModel || scriptLlmRequestModel(option.id),
        apiKey: transport.apiKey,
        baseUrl: transport.baseUrl,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        timeoutMs: options?.timeoutMs,
        label: catalog.label,
        extra: think,
        signal: options?.signal,
      })) {
        if (chunk.type === "content") text += chunk.text;
      }
      if (!text.trim()) throw new Error(`${catalog.label} 返回空内容`);
      return text;
    }
  }

  if (option.provider === "deepseek") {
    return deepseekChat(messages, {
      model: option.id,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      timeoutMs: options?.timeoutMs,
      ...thinkCallOpts(think),
    });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim() || "";
  let text = "";
  for await (const chunk of streamOpenAiCompatible(messages, {
    model: scriptLlmRequestModel(option.id),
    apiKey,
    baseUrl: openaiBaseUrl(),
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    timeoutMs: options?.timeoutMs,
    label: option.label,
    extra: think,
    signal: options?.signal,
  })) {
    if (chunk.type === "content") text += chunk.text;
  }
  if (!text.trim()) throw new Error(`${option.label} 返回空内容`);
  return text;
}

export function scriptLlmFallbackId(id?: string | null): string {
  const option = scriptLlmMeta(id);
  return option.fallbackId || option.id;
}
