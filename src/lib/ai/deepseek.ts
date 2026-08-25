export type DeepSeekConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type StreamChunk =
  | { type: "thinking"; text: string }
  | { type: "content"; text: string }
  | { type: "finish"; reason: string };

export type DeepSeekThinkType = "enabled" | "disabled";
export type DeepSeekReasoningEffort = "low" | "high" | "max";

/** V4 默认 thinking=enabled、effort=high。短任务必须显式关掉或降到 low。 */
export function deepSeekThinkFields(input?: {
  thinking?: DeepSeekThinkType;
  reasoningEffort?: DeepSeekReasoningEffort;
}): Record<string, unknown> {
  if (!input?.thinking) return {};
  const extra: Record<string, unknown> = {
    thinking: { type: input.thinking },
  };
  if (input.thinking === "enabled" && input.reasoningEffort) {
    extra.reasoning_effort = input.reasoningEffort;
  }
  return extra;
}

export function resolveDeepSeekConfig(): DeepSeekConfig | null {
  const apiKey =
    process.env.DEEPSEEK_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "";
  if (!apiKey) return null;

  let baseUrl =
    process.env.DEEPSEEK_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    "https://api.deepseek.com/v1";
  baseUrl = baseUrl.replace(/\/$/, "");
  if (!baseUrl.endsWith("/v1")) {
    baseUrl = `${baseUrl}/v1`;
  }

  const model =
    process.env.DEEPSEEK_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "deepseek-v4-flash";

  return { apiKey, baseUrl, model };
}

/** Prefer reasoner model for streaming + thinking output. */
export function resolveDeepSeekStreamModel(config: DeepSeekConfig): string {
  const explicit =
    process.env.DEEPSEEK_REASONING_MODEL?.trim() ||
    process.env.DEEPSEEK_STREAM_MODEL?.trim();
  if (explicit) return explicit;
  if (
    config.model === "deepseek-chat" ||
    config.model === "deepseek-v4-flash"
  ) {
    return "deepseek-v4-pro";
  }
  return config.model;
}

export async function chatCompletion(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    thinking?: DeepSeekThinkType;
    reasoningEffort?: DeepSeekReasoningEffort;
  },
): Promise<string> {
  const config = resolveDeepSeekConfig();
  if (!config) {
    throw new Error(
      "未配置 DeepSeek API。请在项目根目录 .env.local 设置 DEEPSEEK_API_KEY",
    );
  }

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 90_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: options?.model ?? config.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
        ...deepSeekThinkFields({
          thinking: options?.thinking ?? "disabled",
          reasoningEffort: options?.reasoningEffort,
        }),
      }),
      signal: controller.signal,
    });

    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`DeepSeek API ${res.status}: ${raw.slice(0, 300)}`);
    }

    const json = JSON.parse(raw) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (json.error?.message) {
      throw new Error(json.error.message);
    }
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("DeepSeek 返回空内容");
    }
    return content;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("AI 响应超时，请稍后重试");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function* streamChatCompletion(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    thinking?: DeepSeekThinkType;
    reasoningEffort?: DeepSeekReasoningEffort;
  },
): AsyncGenerator<StreamChunk> {
  const config = resolveDeepSeekConfig();
  if (!config) {
    throw new Error(
      "未配置 DeepSeek API。请在项目根目录 .env.local 设置 DEEPSEEK_API_KEY",
    );
  }

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 180_000;
  let timer = setTimeout(() => controller.abort(), timeoutMs);
  const armIdleTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  const signal = options?.signal;
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const model = options?.model ?? resolveDeepSeekStreamModel(config);
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
        ...deepSeekThinkFields(options),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const raw = await res.text();
      throw new Error(`DeepSeek API ${res.status}: ${raw.slice(0, 300)}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("DeepSeek 流式响应不可用");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      armIdleTimer();
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

        if (json.error?.message) {
          throw new Error(json.error.message);
        }

        const choice = json.choices?.[0];
        const delta = choice?.delta;
        if (delta?.reasoning_content) {
          yield { type: "thinking", text: delta.reasoning_content };
        }
        if (delta?.content) {
          yield { type: "content", text: delta.content };
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
    signal?.removeEventListener("abort", onAbort);
  }
}
