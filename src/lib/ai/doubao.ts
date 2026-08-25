export type DoubaoConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

const DEFAULT_BASE = "https://ark.cn-beijing.volces.com/api/v3";

/** 方舟对话模型。角色名 Doubao-Seed-Character 不能直接当 model。 */
export const DOUBAO_CHAT_MODELS = [
  "doubao-seed-2-0-lite-260428",
  "doubao-seed-2-0-pro-260215",
  "doubao-seed-2-0-mini-260428",
  "doubao-seed-1-6-251015",
  "doubao-seed-1-6-250615",
  "doubao-1-5-pro-32k-250115",
  "doubao-pro-32k-241215",
] as const;

export const DEFAULT_DOUBAO_MODEL = DOUBAO_CHAT_MODELS[0];

const MODEL_ALIASES: Record<string, string> = {
  "doubao-seed-character": "doubao-seed-2-0-lite-260428",
  "doubao-seed-character-260628": "doubao-seed-2-0-lite-260428",
  "doubao-seed-character-251128": "doubao-seed-2-0-lite-260428",
};

export function isDoubaoChatModelId(raw: string): boolean {
  const model = raw.trim();
  if (!model) return false;
  if (/seedance|seedream|seededit|seed3d|embedding|tts/i.test(model)) {
    return false;
  }
  return /^(ep-|doubao-|deepseek-)/i.test(model);
}

export function normalizeDoubaoModelId(raw: string): string {
  const model = raw.trim();
  if (!model) return DEFAULT_DOUBAO_MODEL;
  const collapsed = model.toLowerCase().replace(/[\s_]+/g, "-");
  if (MODEL_ALIASES[collapsed]) return MODEL_ALIASES[collapsed];
  if (/character/i.test(collapsed) && !collapsed.startsWith("ep-")) {
    return DEFAULT_DOUBAO_MODEL;
  }
  if (isDoubaoChatModelId(model)) return model;
  return DEFAULT_DOUBAO_MODEL;
}

export function resolveDoubaoEnvConfig(): DoubaoConfig | null {
  const apiKey =
    process.env.ARK_API_KEY?.trim() ||
    process.env.DOUBAO_API_KEY?.trim() ||
    "";
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: normalizeArkBase(
      process.env.ARK_BASE_URL?.trim() ||
        process.env.DOUBAO_BASE_URL?.trim() ||
        DEFAULT_BASE,
    ),
    model: normalizeDoubaoModelId(
      process.env.ARK_MODEL?.trim() ||
        process.env.DOUBAO_MODEL?.trim() ||
        "",
    ),
  };
}

export function resolveDoubaoConfig(stored?: {
  apiKey?: string;
  model?: string;
}): DoubaoConfig | null {
  const env = resolveDoubaoEnvConfig();
  const apiKey = stored?.apiKey?.trim() || env?.apiKey || "";
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: env?.baseUrl || DEFAULT_BASE,
    model: normalizeDoubaoModelId(stored?.model || env?.model || ""),
  };
}

function normalizeArkBase(raw: string): string {
  let base = raw.replace(/\/$/, "");
  if (base.endsWith("/chat/completions")) {
    base = base.replace(/\/chat\/completions$/, "");
  }
  if (!/\/api\/v3$/i.test(base)) {
    base = `${base}/api/v3`;
  }
  return base;
}

function extractContent(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (!Array.isArray(raw)) return "";
  return raw
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const o = part as Record<string, unknown>;
      if (typeof o.text === "string") return o.text;
      if (typeof o.content === "string") return o.content;
      return "";
    })
    .join("")
    .trim();
}

function looksLikeToolError(message: string): boolean {
  return /web_search|tool|plugin|插件|联网/i.test(message);
}

function isModelNotFound(message: string): boolean {
  return /InvalidEndpointOrModel|ModelNotOpen|NotFound|does not exist|not have access|未开通|模型不存在/i.test(
    message,
  );
}

function isOverdue(message: string): boolean {
  return /AccountOverdueError|overdue balance|欠费/i.test(message);
}

export function explainDoubaoError(message: string): string {
  if (isOverdue(message)) {
    return "火山引擎账号欠费，豆包调不通。先到费用中心充值，再去查排名。https://console.volcengine.com/finance/fund";
  }
  if (/ModelNotOpen|未开通/i.test(message)) {
    return "这个模型还没开通。到方舟开通管理打开一个文本对话模型，或把接入点 ID（ep- 开头）填进模型栏。https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement";
  }
  if (/InvalidEndpointOrModel|Character/i.test(message)) {
    return "模型名不对。不要填 Doubao-Seed-Character 这种角色名，用 doubao-seed-2-0-lite-260428，或控制台里的 ep- 接入点。";
  }
  return message;
}

function modelCandidates(preferred: string, discovered: string[]): string[] {
  const first = normalizeDoubaoModelId(preferred);
  const list = [first, ...discovered, ...DOUBAO_CHAT_MODELS];
  return [...new Set(list.filter(Boolean))];
}

async function listArkChatModels(config: DoubaoConfig): Promise<string[]> {
  try {
    const res = await fetch(`${config.baseUrl}/models`, {
      headers: { authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: Array<{ id?: string; status?: string }>;
    };
    const skip =
      /embedding|tts|seedance|seedream|seededit|seed3d|wan2|hyper3d|hitem3d|vision|ui-tars|translation|code-preview/i;
    const scored: Array<{ id: string; score: number }> = [];
    for (const row of json.data ?? []) {
      const id = row.id?.trim() || "";
      if (!id || skip.test(id)) continue;
      const status = (row.status || "").toLowerCase();
      if (status === "shutdown") continue;
      let score = 0;
      if (!status) score += 4;
      if (/doubao-seed-2-0-lite/.test(id)) score += 8;
      else if (/doubao-seed-2-0-pro/.test(id)) score += 7;
      else if (/doubao-seed-2-0-mini/.test(id)) score += 6;
      else if (/doubao-seed-1-6/.test(id) && !/character/.test(id)) score += 5;
      else if (/character/.test(id)) score += 1;
      else if (/^doubao-/.test(id)) score += 3;
      scored.push({ id, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.id);
  } catch {
    return [];
  }
}

async function arkChatOnce(input: {
  config: DoubaoConfig;
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  webSearch: boolean;
}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
    };
    if (input.webSearch) {
      body.tools = [{ type: "web_search" }];
    }
    const res = await fetch(`${input.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`豆包 API ${res.status}: ${raw.slice(0, 300)}`);
    }
    const json = JSON.parse(raw) as {
      choices?: { message?: { content?: unknown } }[];
      error?: { message?: string };
    };
    if (json.error?.message) {
      throw new Error(json.error.message);
    }
    const content = extractContent(json.choices?.[0]?.message?.content);
    if (!content) {
      throw new Error("豆包返回空内容");
    }
    return content;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("豆包响应超时，请稍后重试");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function doubaoChatCompletion(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: {
    config?: DoubaoConfig | null;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    webSearch?: boolean;
  },
): Promise<string> {
  const config = options?.config ?? resolveDoubaoConfig();
  if (!config) {
    throw new Error(
      "未配置豆包。在查排名页填入火山方舟 API Key，或在 .env.local 设置 ARK_API_KEY",
    );
  }

  const wantSearch = options?.webSearch !== false;
  const discovered = await listArkChatModels(config);
  const candidates = modelCandidates(config.model, discovered).slice(0, 6);
  let lastErr = "";

  for (const model of candidates) {
    try {
      const text = await arkChatOnce({
        config,
        model,
        messages,
        temperature: options?.temperature ?? 0.3,
        maxTokens: options?.maxTokens ?? 800,
        timeoutMs: options?.timeoutMs ?? 60_000,
        webSearch: wantSearch,
      });
      config.model = model;
      return text;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isOverdue(message)) {
        throw new Error(explainDoubaoError(message));
      }
      if (wantSearch && looksLikeToolError(message) && !isModelNotFound(message)) {
        try {
          const text = await arkChatOnce({
            config,
            model,
            messages,
            temperature: options?.temperature ?? 0.3,
            maxTokens: options?.maxTokens ?? 800,
            timeoutMs: options?.timeoutMs ?? 60_000,
            webSearch: false,
          });
          config.model = model;
          return text;
        } catch (retryErr) {
          lastErr = retryErr instanceof Error ? retryErr.message : String(retryErr);
          if (isOverdue(lastErr)) throw new Error(explainDoubaoError(lastErr));
          if (isModelNotFound(lastErr)) continue;
          throw new Error(explainDoubaoError(lastErr));
        }
      }
      lastErr = message;
      if (isModelNotFound(message)) continue;
      throw new Error(explainDoubaoError(message));
    }
  }

  throw new Error(explainDoubaoError(lastErr || "没有可用的豆包对话模型"));
}

export async function probeDoubaoModel(config: DoubaoConfig): Promise<{
  model: string;
}> {
  await doubaoChatCompletion([{ role: "user", content: "只回复：好" }], {
    config,
    temperature: 0,
    maxTokens: 16,
    timeoutMs: 30_000,
    webSearch: false,
  });
  return { model: config.model };
}
