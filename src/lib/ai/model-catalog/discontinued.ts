/**
 * 上游已下线 / 带日期的旧快照：同步时不入库。
 * 站内精选 slug（如 deepseek-chat）可保留，仅映射到新 providerModel。
 */

function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/_/g, "-").replace(/^aliyun-/, "");
}

/** 明确退役的上游 model id（勿再从 /models 拉入） */
const HARD_RETIRED = new Set([
  "deepseek-chat",
  "deepseek-reasoner",
  "gpt-3.5-turbo",
  "gpt-3.5-turbo-16k",
  "gpt-4",
  "gpt-4-turbo",
  "gpt-4-turbo-preview",
  "gpt-4-0125-preview",
  "gpt-4-1106-preview",
  "text-davinci-003",
  "text-embedding-ada-002",
  "davinci-002",
  "babbage-002",
  "claude-2",
  "claude-2.0",
  "claude-2.1",
  "claude-instant-1",
  "claude-instant-1.2",
  "claude-3-opus-20240229",
  "claude-3-sonnet-20240229",
  "claude-3-haiku-20240307",
  "gemini-1.0-pro",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
  "gemini-pro",
  "gemini-pro-vision",
]);

/** 代理 / 千问：带发布日期后缀的旧档 */
export function isDatedSnapshotId(id: string): boolean {
  const k = normalize(id);
  return /-\d{8}$/.test(k) || /-\d{4}-\d{2}-\d{2}$/.test(k);
}

export function isHardRetiredModelId(id: string): boolean {
  const k = normalize(id);
  if (HARD_RETIRED.has(k)) return true;
  // 旧 Claude 3 带日期
  if (/^claude-3-(opus|sonnet|haiku)-\d{8}$/.test(k)) return true;
  return false;
}

/** 同步拉取时是否跳过该上游 id */
export function shouldSkipSyncImport(
  id: string,
  source: "ark" | "proxy" | "qwen" | "cloudflare" | "cursor",
): boolean {
  if (!id.trim()) return true;
  if (isHardRetiredModelId(id)) return true;
  // 代理 / 百炼：日期快照一律不拉；方舟当前 endpoint 本身常带 -YYMMDD，交给 status=shutdown
  if (source === "proxy" || source === "qwen") {
    if (isDatedSnapshotId(id)) return true;
  }
  return false;
}
