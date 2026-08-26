import { resolveDeepSeekConfig } from "@/lib/ai/deepseek";
import { resolveDoubaoEnvConfig } from "@/lib/ai/doubao";
import {
  hasCloudflareAiReady,
} from "@/lib/ai/model-catalog/cloudflare-seed";
import {
  hasSunoReady,
  resolveSunoApiBase,
  resolveSunoApiKey,
} from "@/lib/ai/model-catalog/music-seed";
import {
  resolveQwenApiKey,
  resolveQwenOpenAiBase,
} from "@/lib/ai/model-catalog/qwen-seed";
import {
  hasCursorApiReady,
  probeCursorAccount,
} from "@/lib/ai/model-catalog/cursor-seed";

export type ProviderBalanceStatus =
  | "ok"
  | "low"
  | "empty"
  | "error"
  | "unconfigured"
  | "manual";

export type ProviderBalance = {
  id: string;
  label: string;
  uses: string;
  configured: boolean;
  status: ProviderBalanceStatus;
  amount?: string;
  detail?: string;
  error?: string;
  rechargeUrl?: string;
  rechargeLabel?: string;
};

const FETCH_MS = 12_000;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function openAiBaseUrl() {
  return (process.env.OPENAI_BASE_URL?.trim() || "").replace(/\/$/, "");
}

function openAiOrigin(base = openAiBaseUrl()) {
  return base.replace(/\/v1$/i, "") || base;
}

function originHost(url: string) {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] || url;
  }
}

async function fetchJson(
  url: string,
  apiKey: string,
  options?: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number },
): Promise<{ status: number; json: Record<string, unknown> | null; raw: string }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? FETCH_MS,
  );
  try {
    const res = await fetch(url, {
      method: options?.method || "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
        "user-agent": BROWSER_UA,
        ...(options?.body != null
          ? { "content-type": "application/json" }
          : {}),
      },
      body: options?.body != null ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, raw };
  } finally {
    clearTimeout(timer);
  }
}

function money(amount: number, currency: "CNY" | "USD") {
  if (!Number.isFinite(amount)) return currency === "CNY" ? "¥—" : "$—";
  if (currency === "CNY") {
    return `¥${amount.toFixed(2)}`;
  }
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusFromAmount(
  amount: number,
  low: number,
): ProviderBalanceStatus {
  if (!Number.isFinite(amount) || amount <= 0) return "empty";
  if (amount < low) return "low";
  return "ok";
}

function ymdUtc(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function remainingUsdFromBilling(
  hardLimitUsd: number,
  usageCents: number,
): { limitUsd: number; usedUsd: number; remainUsd: number } {
  const limitUsd = Number.isFinite(hardLimitUsd) ? hardLimitUsd : 0;
  const usedUsd = (Number.isFinite(usageCents) ? usageCents : 0) / 100;
  return { limitUsd, usedUsd, remainUsd: limitUsd - usedUsd };
}

type DeepSeekBalanceInfo = {
  currency?: string;
  total_balance?: string;
  granted_balance?: string;
  topped_up_balance?: string;
};

export function parseDeepSeekBalance(json: {
  is_available?: boolean;
  balance_infos?: DeepSeekBalanceInfo[];
}): { amount: number; currency: "CNY" | "USD"; available: boolean; detail: string } | null {
  const infos = Array.isArray(json.balance_infos) ? json.balance_infos : [];
  const cny = infos.find((row) => row.currency === "CNY");
  const usd = infos.find((row) => row.currency === "USD");
  const pick = cny || usd || infos[0];
  if (!pick) return null;
  const amount = Number(pick.total_balance);
  const currency: "CNY" | "USD" = pick.currency === "USD" ? "USD" : "CNY";
  const bits = [
    `可用 ${money(amount, currency)}`,
    pick.topped_up_balance
      ? `充值 ${money(Number(pick.topped_up_balance), currency)}`
      : "",
    pick.granted_balance && Number(pick.granted_balance) > 0
      ? `赠送 ${money(Number(pick.granted_balance), currency)}`
      : "",
  ].filter(Boolean);
  return {
    amount,
    currency,
    available: json.is_available !== false && amount > 0,
    detail: bits.join(" · "),
  };
}

function unconfigured(
  id: string,
  label: string,
  uses: string,
  rechargeUrl: string,
  extra?: Partial<ProviderBalance>,
): ProviderBalance {
  return {
    id,
    label,
    uses,
    configured: false,
    status: "unconfigured",
    detail: extra?.detail || "还没配密钥",
    rechargeUrl,
    rechargeLabel: "打开控制台",
    ...extra,
  };
}

function manualConfigured(
  id: string,
  label: string,
  uses: string,
  rechargeUrl: string,
  detail: string,
): ProviderBalance {
  return {
    id,
    label,
    uses,
    configured: true,
    status: "manual",
    detail,
    rechargeUrl,
    rechargeLabel: "去充值",
  };
}

function arkConfigured() {
  if (resolveDoubaoEnvConfig()?.apiKey) return true;
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

async function probeDeepSeek(): Promise<ProviderBalance> {
  const uses = "写稿 · 挖词 · 信息图提纲";
  const rechargeUrl = "https://platform.deepseek.com/top_up";
  const key = process.env.DEEPSEEK_API_KEY?.trim() || "";
  if (!key) {
    const cfg = resolveDeepSeekConfig();
    if (!cfg || !/api\.deepseek\.com/i.test(cfg.baseUrl)) {
      return unconfigured("deepseek", "DeepSeek 官方", uses, rechargeUrl, {
        detail: "还没配 DEEPSEEK_API_KEY",
      });
    }
  }
  const apiKey = key || resolveDeepSeekConfig()?.apiKey || "";
  if (!apiKey) {
    return unconfigured("deepseek", "DeepSeek 官方", uses, rechargeUrl);
  }
  try {
    const { status, json, raw } = await fetchJson(
      "https://api.deepseek.com/user/balance",
      apiKey,
    );
    if (status !== 200 || !json) {
      return {
        id: "deepseek",
        label: "DeepSeek 官方",
        uses,
        configured: true,
        status: "error",
        error: `查询失败（${status}）${raw.slice(0, 80)}`,
        rechargeUrl,
        rechargeLabel: "去充值",
      };
    }
    const parsed = parseDeepSeekBalance(
      json as {
        is_available?: boolean;
        balance_infos?: DeepSeekBalanceInfo[];
      },
    );
    if (!parsed) {
      return {
        id: "deepseek",
        label: "DeepSeek 官方",
        uses,
        configured: true,
        status: "error",
        error: "余额接口没有返回数字",
        rechargeUrl,
        rechargeLabel: "去充值",
      };
    }
    const statusFlag = parsed.available
      ? statusFromAmount(parsed.amount, parsed.currency === "CNY" ? 20 : 5)
      : "empty";
    return {
      id: "deepseek",
      label: "DeepSeek 官方",
      uses,
      configured: true,
      status: statusFlag,
      amount: money(parsed.amount, parsed.currency),
      detail: parsed.detail,
      rechargeUrl,
      rechargeLabel: "去充值",
    };
  } catch (err) {
    return {
      id: "deepseek",
      label: "DeepSeek 官方",
      uses,
      configured: true,
      status: "error",
      error: err instanceof Error ? err.message : "查询失败",
      rechargeUrl,
      rechargeLabel: "去充值",
    };
  }
}

async function usageCentsLastYear(origin: string, apiKey: string) {
  let cents = 0;
  const today = new Date();
  for (let i = 0; i < 4; i += 1) {
    const end = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - i * 90,
    ));
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 89);
    const { status, json } = await fetchJson(
      `${origin}/v1/dashboard/billing/usage?start_date=${ymdUtc(start)}&end_date=${ymdUtc(end)}`,
      apiKey,
    );
    if (status !== 200 || !json) continue;
    cents += Number(json.total_usage || 0);
  }
  return cents;
}

async function probeOpenRouter(apiKey: string, uses: string): Promise<ProviderBalance> {
  const rechargeUrl = "https://openrouter.ai/settings/credits";
  const { status, json, raw } = await fetchJson(
    "https://openrouter.ai/api/v1/key",
    apiKey,
  );
  if (status !== 200 || !json) {
    return {
      id: "openrouter",
      label: "OpenRouter",
      uses,
      configured: true,
      status: "error",
      error: `查询失败（${status}）${raw.slice(0, 80)}`,
      rechargeUrl,
      rechargeLabel: "去充值",
    };
  }
  const data =
    json.data && typeof json.data === "object"
      ? (json.data as Record<string, unknown>)
      : json;
  const remaining = data.limit_remaining;
  const usage = Number(data.usage);
  if (remaining == null) {
    return {
      id: "openrouter",
      label: "OpenRouter",
      uses,
      configured: true,
      status: "ok",
      amount: "不限",
      detail: Number.isFinite(usage)
        ? `累计已用 ${money(usage, "USD")}`
        : "Key 没有额度上限",
      rechargeUrl,
      rechargeLabel: "去充值",
    };
  }
  const remainUsd = Number(remaining);
  return {
    id: "openrouter",
    label: "OpenRouter",
    uses,
    configured: true,
    status: statusFromAmount(remainUsd, 10),
    amount: money(remainUsd, "USD"),
    detail: Number.isFinite(usage)
      ? `累计已用 ${money(usage, "USD")}`
      : undefined,
    rechargeUrl,
    rechargeLabel: "去充值",
  };
}

async function probeProxy(): Promise<ProviderBalance> {
  const uses = "配图 · 剧本 GPT/Claude · DeepSeek 官方没钱时的兜底";
  const apiKey = process.env.OPENAI_API_KEY?.trim() || "";
  const base = openAiBaseUrl();
  const origin = openAiOrigin(base);
  const host = originHost(origin || base || "api.openai-proxy.org");
  const rechargeUrl = /openrouter\.ai/i.test(host)
    ? "https://openrouter.ai/settings/credits"
    : `https://${host.replace(/^api\./, "www.")}`;

  if (!apiKey || !base) {
    return unconfigured("proxy", "代理站", uses, rechargeUrl, {
      detail: "还没配 OPENAI_API_KEY / OPENAI_BASE_URL",
    });
  }
  if (/api\.deepseek\.com/i.test(base)) {
    return {
      id: "proxy",
      label: "代理站",
      uses,
      configured: false,
      status: "unconfigured",
      detail: "OPENAI_BASE_URL 指向 DeepSeek 官方，和上面同一账号",
      rechargeUrl: "https://platform.deepseek.com/top_up",
      rechargeLabel: "去充值",
    };
  }

  try {
    if (/openrouter\.ai/i.test(host)) {
      return probeOpenRouter(apiKey, uses);
    }

    const adminKey =
      process.env.OPENAI_PROXY_ADMIN_KEY?.trim() ||
      process.env.CLOSEAI_ADMIN_KEY?.trim() ||
      "";
    if (adminKey) {
      const { status, json } = await fetchJson(
        `${origin}/api/v1/management/account/balance`,
        adminKey,
        { method: "POST", body: {} },
      );
      const balance = Number(
        json && (json.balance as string | number | undefined),
      );
      if (status === 200 && Number.isFinite(balance)) {
        return {
          id: "proxy",
          label: `代理站 ${host}`,
          uses,
          configured: true,
          status: statusFromAmount(balance, 50),
          amount: money(balance, "CNY"),
          detail: "CloseAI 管理接口实时余额",
          rechargeUrl,
          rechargeLabel: "去充值",
        };
      }
    }

    const sub = await fetchJson(
      `${origin}/v1/dashboard/billing/subscription`,
      apiKey,
    );
    if (sub.status !== 200 || !sub.json) {
      return {
        id: "proxy",
        label: `代理站 ${host}`,
        uses,
        configured: true,
        status: "error",
        error: `订阅接口 ${sub.status}`,
        rechargeUrl,
        rechargeLabel: "去充值",
      };
    }
    const hard = Number(
      sub.json.hard_limit_usd ?? sub.json.soft_limit_usd ?? 0,
    );
    const usageCents = await usageCentsLastYear(origin, apiKey);
    const { limitUsd, usedUsd, remainUsd } = remainingUsdFromBilling(
      hard,
      usageCents,
    );
    const remain = remainUsd < 0 ? 0 : remainUsd;
    return {
      id: "proxy",
      label: `代理站 ${host}`,
      uses,
      configured: true,
      status: statusFromAmount(remain, 15),
      amount: money(remain, "USD"),
      detail: `近一年已用 ${money(usedUsd, "USD")} · 额度上限 ${money(limitUsd, "USD")}（按代理站旧版 billing 接口估算）`,
      rechargeUrl,
      rechargeLabel: "去充值",
    };
  } catch (err) {
    return {
      id: "proxy",
      label: `代理站 ${host}`,
      uses,
      configured: true,
      status: "error",
      error: err instanceof Error ? err.message : "查询失败",
      rechargeUrl,
      rechargeLabel: "去充值",
    };
  }
}

async function probeSuno(): Promise<ProviderBalance> {
  const uses = "音乐生成";
  const rechargeUrl = "https://sunoapi.org";
  if (!hasSunoReady()) {
    return unconfigured("suno", "Suno (sunoapi.org)", uses, rechargeUrl, {
      detail: "还没配 SUNO_API_KEY",
    });
  }
  const provider = (process.env.SUNO_PROVIDER || "sunoapi").toLowerCase();
  if (provider === "gcui") {
    return manualConfigured(
      "suno",
      "Suno (自托管 gcui)",
      uses,
      rechargeUrl,
      "自托管没有统一余额接口，到上游看额度",
    );
  }
  const apiKey = resolveSunoApiKey();
  const base = resolveSunoApiBase();
  try {
    const { status, json, raw } = await fetchJson(
      `${base}/api/v1/generate/credit`,
      apiKey,
    );
    const credits = Number(json?.data);
    if (status !== 200 || !Number.isFinite(credits)) {
      return {
        id: "suno",
        label: "Suno (sunoapi.org)",
        uses,
        configured: true,
        status: "error",
        error: `查询失败（${status}）${raw.slice(0, 80)}`,
        rechargeUrl,
        rechargeLabel: "去充值",
      };
    }
    return {
      id: "suno",
      label: "Suno (sunoapi.org)",
      uses,
      configured: true,
      status: statusFromAmount(credits, 80),
      amount: `${credits} 积分`,
      detail: "出歌按次扣积分",
      rechargeUrl,
      rechargeLabel: "去充值",
    };
  } catch (err) {
    return {
      id: "suno",
      label: "Suno (sunoapi.org)",
      uses,
      configured: true,
      status: "error",
      error: err instanceof Error ? err.message : "查询失败",
      rechargeUrl,
      rechargeLabel: "去充值",
    };
  }
}

function probeArk(): ProviderBalance {
  const uses = "出片 · 提及检测 · 部分出图";
  const rechargeUrl =
    "https://console.volcengine.com/finance/fund/recharge";
  if (!arkConfigured()) {
    return unconfigured("ark", "火山方舟 / 豆包", uses, rechargeUrl, {
      detail: "还没配 ARK_API_KEY",
    });
  }
  return manualConfigured(
    "ark",
    "火山方舟 / 豆包",
    uses,
    rechargeUrl,
    "方舟 Key 查不了余额，打开火山引擎费用中心看账单和充值",
  );
}

function probeQwen(): ProviderBalance {
  const uses = "写稿千问 · 音色克隆";
  const rechargeUrl = "https://billing.console.aliyun.com/recharge";
  if (!resolveQwenApiKey() || !resolveQwenOpenAiBase()) {
    return unconfigured("qwen", "通义千问 / 百炼", uses, rechargeUrl, {
      detail: "还没配 DASHSCOPE_API_KEY",
    });
  }
  return manualConfigured(
    "qwen",
    "通义千问 / 百炼",
    uses,
    rechargeUrl,
    "百炼走阿里云后付费，API Key 查不了余额，打开费用中心充值",
  );
}

function probeCloudflare(): ProviderBalance {
  const uses = "Workers AI 兜底模型";
  const rechargeUrl = "https://dash.cloudflare.com/?to=/:account/billing";
  if (!hasCloudflareAiReady()) {
    return unconfigured("cloudflare", "Cloudflare AI", uses, rechargeUrl, {
      detail: "还没配 CLOUDFLARE_AI_TOKEN",
    });
  }
  return manualConfigured(
    "cloudflare",
    "Cloudflare AI",
    uses,
    rechargeUrl,
    "Workers AI 按量出账，Token 查不了剩余额度，打开 Cloudflare 账单",
  );
}

async function probeCursor(): Promise<ProviderBalance> {
  const uses = "写稿 · 剧本 · Composer / Grok";
  const rechargeUrl = "https://cursor.com/dashboard";
  if (!hasCursorApiReady()) {
    return unconfigured("cursor", "Cursor API", uses, rechargeUrl, {
      detail: "还没配 CURSOR_API_KEY",
    });
  }
  const probed = await probeCursorAccount();
  if (!probed.ok) {
    return {
      id: "cursor",
      label: "Cursor API",
      uses,
      configured: true,
      status: "error",
      error: probed.error || "查询失败",
      rechargeUrl,
      rechargeLabel: "打开控制台",
    };
  }
  return {
    id: "cursor",
    label: "Cursor API",
    uses,
    configured: true,
    status: "manual",
    detail: probed.detail
      ? `${probed.detail}。用量看 Cursor Dashboard`
      : "密钥有效。用量看 Cursor Dashboard",
    rechargeUrl,
    rechargeLabel: "打开控制台",
  };
}

export async function listProviderBalances(): Promise<ProviderBalance[]> {
  const [deepseek, proxy, suno, cursor] = await Promise.all([
    probeDeepSeek(),
    probeProxy(),
    probeSuno(),
    probeCursor(),
  ]);
  return [
    deepseek,
    proxy,
    probeArk(),
    probeQwen(),
    suno,
    probeCloudflare(),
    cursor,
  ];
}
