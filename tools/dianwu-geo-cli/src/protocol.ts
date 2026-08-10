export const DEFAULT_WS_HOST = "127.0.0.1";
export const DEFAULT_WS_PORT = 9527;
export const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
export const DEFAULT_RPC_TIMEOUT_MS = 180_000;

export type BridgeMethod =
  | "listPlatforms"
  | "checkAuth"
  | "syncArticle"
  | "extractArticle"
  | "uploadImage";

export type BridgeRequest = {
  id: string;
  method: BridgeMethod | string;
  params?: Record<string, unknown>;
};

export type BridgeResponse = {
  id: string;
  result?: unknown;
  error?: { code?: number; message?: string } | string;
};

export type SyncArticleParams = {
  platforms: string[];
  article: {
    title: string;
    markdown?: string;
    content?: string;
    cover?: string;
  };
};

export type PlatformAuthInfo = {
  id?: string;
  name?: string;
  isAuthenticated?: boolean;
  username?: string;
  userId?: string;
  error?: string;
  [key: string]: unknown;
};

export function getBridgeToken(): string {
  return (
    process.env.DIANWU_GEO_TOKEN ||
    process.env.WECHATSYNC_TOKEN ||
    process.env.MCP_TOKEN ||
    ""
  ).trim();
}

export function getBridgeHost(): string {
  return (process.env.SYNC_WS_HOST || DEFAULT_WS_HOST).trim() || DEFAULT_WS_HOST;
}

export function getBridgePort(): number {
  const raw = process.env.SYNC_WS_PORT || String(DEFAULT_WS_PORT);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WS_PORT;
}

export function extractErrorMessage(error: BridgeResponse["error"]): string {
  if (!error) return "未知错误";
  if (typeof error === "string") return error;
  return error.message || `错误码 ${error.code ?? -1}`;
}
