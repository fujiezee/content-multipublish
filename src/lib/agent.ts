/** Local Playwright agent: website creates jobs, this machine claims and runs them. */

import { workspaceHasOnlineAgent } from "@/lib/db";

export const AGENT_ONLINE_MS = 45_000;
export const AGENT_PAIR_TTL_MS = 15 * 60_000;
export const AGENT_TOKEN_PREFIX = "dwagent_";

export function isCloudPlaywrightDisabled(): boolean {
  if (process.env.CLOUDFLARE === "1") return true;
  const raw = (
    process.env.DIANWU_CLOUD ||
    process.env.DIANWU_AGENT_REQUIRED ||
    ""
  )
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isAgentRecentlySeen(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) return false;
  const at = Date.parse(lastSeenAt);
  if (!Number.isFinite(at)) return false;
  return Date.now() - at <= AGENT_ONLINE_MS;
}

export function normalizePairCode(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function formatPairCode(code: string): string {
  const compact = normalizePairCode(code);
  if (compact.length === 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4)}`;
  }
  return compact;
}

/** Cloud, or a paired agent is currently heartbeating — do not run Playwright in-process. */
export function shouldDeferPlaywrightToAgent(workspaceId: string): boolean {
  if (isCloudPlaywrightDisabled()) return true;
  return workspaceHasOnlineAgent(workspaceId, AGENT_ONLINE_MS);
}

export function originFromRequest(req: Request): string {
  const origin = req.headers.get("origin")?.trim();
  if (origin) return origin.replace(/\/$/, "");
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("host")?.trim() ||
    "";
  if (host) {
    const proto = (
      req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      (host.startsWith("127.0.0.1") || host.startsWith("localhost")
        ? "http"
        : "https")
    ).replace(/:$/, "");
    return `${proto}://${host}`.replace(/\/$/, "");
  }
  return (
    process.env.NEXT_PUBLIC_APP_ORIGIN?.trim() ||
    process.env.APP_ORIGIN?.trim() ||
    "http://127.0.0.1:3000"
  ).replace(/\/$/, "");
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

export function agentPairCommand(code: string, origin: string): string {
  const formatted = formatPairCode(code);
  if (isLoopbackOrigin(origin)) {
    return `npm run agent -- --pair ${formatted}`;
  }
  return `npm run agent -- --url ${origin} --pair ${formatted}`;
}
