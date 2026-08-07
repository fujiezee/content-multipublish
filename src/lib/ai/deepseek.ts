export type DeepSeekConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type StreamChunk =
  | { type: "thinking"; text: string }
  | { type: "content"; text: string };

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
    "deepseek-chat";

  return { apiKey, baseUrl, model };
}

/** Prefer reasoner model for streaming + thinking output. */
export function resolveDeepSeekStreamModel(config: DeepSeekConfig): string {
  const explicit =
    process.env.DEEPSEEK_REASONING_MODEL?.trim() ||
    process.env.DEEPSEEK_STREAM_MODEL?.trim();
  if (explicit) return explicit;
  if (config.model === "deepseek-chat") return "deepseek-reasoner";
  return config.model;
}

export async function chatCompletion(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: { temperature?: number; maxTokens?: number; timeoutMs?: number },
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
        model: config.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
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
  },
): AsyncGenerator<StreamChunk> {
  const config = resolveDeepSeekConfig();
  if (!config) {
    throw new Error(
      "未配置 DeepSeek API。请在项目根目录 .env.local 设置 DEEPSEEK_API_KEY",
    );
  }

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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

        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.reasoning_content) {
          yield { type: "thinking", text: delta.reasoning_content };
        }
        if (delta.content) {
          yield { type: "content", text: delta.content };
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
