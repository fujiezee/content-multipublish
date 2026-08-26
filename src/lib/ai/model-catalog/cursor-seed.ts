import type {
  AiModelInput,
  AiModelPricingConfig,
  AiModelUse,
} from "@/lib/ai/model-catalog/types";
import { costHintFromOfficial } from "@/lib/ai/model-catalog/ark-prices";
import { shouldSkipSyncImport } from "@/lib/ai/model-catalog/discontinued";

/** USD → 人民币分（刊例按 7.2 汇率，与 Cloudflare 通道一致） */
const USD_CNY = 7.2;

export function resolveCursorApiKey(): string {
  return (
    process.env.CURSOR_API_KEY?.trim() ||
    process.env.CURSOR_APIKEY?.trim() ||
    ""
  );
}

export function resolveCursorOpenAiBase(): string {
  let base =
    process.env.CURSOR_BASE_URL?.trim() || "https://api.cursor.com/v1";
  base = base.replace(/\/$/, "");
  if (!base.endsWith("/v1")) base = `${base}/v1`;
  return base;
}

export function hasCursorApiReady(): boolean {
  return Boolean(resolveCursorApiKey());
}

function usdToFen(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.max(1, Math.round(usd * USD_CNY * 100));
}

function tokenPricing(inputUsd: number, outputUsd: number): AiModelPricingConfig {
  return {
    billUnit: "1m_tokens",
    officialInputFen: usdToFen(inputUsd),
    officialOutputFen: usdToFen(outputUsd),
    currency: "CNY",
    source: "manual",
  };
}

type CursorSeed = {
  id: string;
  label: string;
  hint: string;
  uses?: AiModelUse[];
  sortOrder: number;
  enabled?: boolean;
  fallbackSlug?: string;
  badges?: AiModelInput["badges"];
  /** 美元 / 百万 token */
  inputUsd: number;
  outputUsd: number;
};

const CURSOR_TEXT: CursorSeed[] = [
  {
    id: "composer-2.5",
    label: "Composer 2.5",
    hint: "Cursor 写稿主力，中文口播和剧本都稳",
    uses: ["script", "shot", "copywriting", "review"],
    sortOrder: 32,
    fallbackSlug: "cursor-composer-2.5-fast",
    badges: ["recommended", "hot"],
    inputUsd: 1.25,
    outputUsd: 6,
  },
  {
    id: "composer-2.5-fast",
    label: "Composer 2.5 Fast",
    hint: "更快更便宜，适合改稿和分镜",
    uses: ["script", "shot", "copywriting", "review"],
    sortOrder: 34,
    fallbackSlug: "cursor-composer-2.5",
    badges: ["new"],
    inputUsd: 0.4,
    outputUsd: 2,
  },
  {
    id: "grok-4.6",
    label: "Grok 4.6",
    hint: "长文判断狠，适合挖点和难稿",
    uses: ["script", "copywriting", "review"],
    sortOrder: 36,
    fallbackSlug: "cursor-composer-2.5",
    inputUsd: 0.6,
    outputUsd: 3,
  },
  {
    id: "grok-4.6-fast",
    label: "Grok 4.6 Fast",
    hint: "Grok 的快档，适合改一版",
    uses: ["shot", "copywriting"],
    sortOrder: 37,
    fallbackSlug: "cursor-grok-4.6",
    inputUsd: 0.2,
    outputUsd: 1,
  },
  {
    id: "auto-smart",
    label: "Cursor Auto",
    hint: "按任务自动选模型（Teams / Enterprise Router）",
    uses: ["script", "shot", "copywriting", "review"],
    sortOrder: 38,
    fallbackSlug: "cursor-composer-2.5",
    inputUsd: 1.25,
    outputUsd: 6,
  },
];

export function cursorModelSlug(providerModel: string): string {
  const raw = providerModel.trim();
  if (raw.startsWith("cursor-")) return raw.slice(0, 120);
  return `cursor-${raw}`.slice(0, 120);
}

function toInput(row: CursorSeed): AiModelInput {
  const pricing = tokenPricing(row.inputUsd, row.outputUsd);
  return {
    slug: cursorModelSlug(row.id),
    label: row.label,
    hint: row.hint,
    modality: "text",
    uses: row.uses || ["script", "shot", "copywriting", "review"],
    provider: "cursor",
    providerModel: row.id,
    costHint: costHintFromOfficial(pricing),
    sortOrder: row.sortOrder,
    enabled: row.enabled !== false,
    fallbackSlug: row.fallbackSlug,
    badges: row.badges,
    config: { pricing },
  };
}

export const CURSOR_AI_MODEL_SEED: AiModelInput[] = CURSOR_TEXT.map(toInput);

function prettyLabel(id: string): string {
  if (id === "auto-smart") return "Cursor Auto";
  return id
    .replace(/^cursor-/, "")
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function cursorModelIdToInput(id: string): AiModelInput | null {
  const raw = id.trim();
  if (!raw) return null;
  const known = CURSOR_TEXT.find((row) => row.id === raw);
  if (known) return toInput(known);
  const pricing = tokenPricing(1.25, 6);
  return {
    slug: cursorModelSlug(raw),
    label: prettyLabel(raw),
    hint: "Cursor API 文本模型",
    modality: "text",
    uses: ["script", "shot", "copywriting", "review"],
    provider: "cursor",
    providerModel: raw,
    costHint: costHintFromOfficial(pricing),
    sortOrder: 80,
    enabled: true,
    config: { pricing },
  };
}

function cursorAuthHeaders(apiKey: string, mode: "bearer" | "basic"): HeadersInit {
  if (mode === "basic") {
    const token = Buffer.from(`${apiKey}:`, "utf8").toString("base64");
    return {
      authorization: `Basic ${token}`,
      accept: "application/json",
    };
  }
  return {
    authorization: `Bearer ${apiKey}`,
    accept: "application/json",
  };
}

async function cursorGetJson(path: string): Promise<{
  status: number;
  json: unknown;
  raw: string;
}> {
  const apiKey = resolveCursorApiKey();
  if (!apiKey) {
    throw new Error("未配置 CURSOR_API_KEY，无法调用 Cursor API");
  }
  const base = resolveCursorOpenAiBase();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const run = async (mode: "bearer" | "basic") => {
    const res = await fetch(url, {
      headers: cursorAuthHeaders(apiKey, mode),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const raw = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      json = null;
    }
    return { status: res.status, json, raw };
  };
  let out = await run("bearer");
  if (out.status === 401 || out.status === 403) {
    out = await run("basic");
  }
  return out;
}

function collectModelIds(json: unknown): string[] {
  const ids: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) ids.push(value.trim());
    else if (value && typeof value === "object") {
      const rec = value as Record<string, unknown>;
      const id = rec.id ?? rec.name ?? rec.model;
      if (typeof id === "string" && id.trim()) ids.push(id.trim());
    }
  };
  if (!json) return ids;
  if (Array.isArray(json)) {
    json.forEach(push);
    return ids;
  }
  if (typeof json !== "object") return ids;
  const rec = json as Record<string, unknown>;
  for (const key of ["data", "items", "models", "result"]) {
    const val = rec[key];
    if (Array.isArray(val)) val.forEach(push);
    else if (val && typeof val === "object") {
      const nested = val as Record<string, unknown>;
      for (const inner of ["data", "items", "models"]) {
        if (Array.isArray(nested[inner])) nested[inner].forEach(push);
      }
    }
  }
  return ids;
}

export async function fetchCursorModelIds(): Promise<string[]> {
  const { status, json, raw } = await cursorGetJson("/models");
  if (status !== 200) {
    throw new Error(`拉取 Cursor 模型失败 ${status}: ${raw.slice(0, 220)}`);
  }
  const ids = [...new Set(collectModelIds(json))].filter(Boolean);
  if (!ids.length) {
    throw new Error("Cursor /models 没有返回可用模型");
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

export async function probeCursorAccount(): Promise<{
  ok: boolean;
  detail?: string;
  error?: string;
}> {
  try {
    const { status, json, raw } = await cursorGetJson("/me");
    if (status !== 200) {
      return {
        ok: false,
        error: `查询失败（${status}）${raw.slice(0, 80)}`,
      };
    }
    const rec =
      json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    const name =
      String(rec.email || rec.name || rec.user_email || rec.id || "").trim() ||
      "已登录";
    return { ok: true, detail: name };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "查询失败",
    };
  }
}
