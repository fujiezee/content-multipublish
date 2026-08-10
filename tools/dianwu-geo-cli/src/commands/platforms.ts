import {
  ensureSharedBridgeStarted,
  type BridgeServer,
} from "../bridge-server.js";
import type { PlatformAuthInfo } from "../protocol.js";

function normalizePlatforms(raw: unknown): PlatformAuthInfo[] {
  if (Array.isArray(raw)) return raw as PlatformAuthInfo[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { platforms?: unknown }).platforms)) {
    return (raw as { platforms: PlatformAuthInfo[] }).platforms;
  }
  return [];
}

export async function listPlatforms(options: {
  auth?: boolean;
  forceRefresh?: boolean;
  bridge?: BridgeServer;
  waitExtensionMs?: number;
} = {}): Promise<PlatformAuthInfo[]> {
  const bridge = options.bridge ?? (await ensureSharedBridgeStarted());
  await bridge.waitForExtension(options.waitExtensionMs);
  const raw = await bridge.call("listPlatforms", {
    forceRefresh: !!options.forceRefresh || !!options.auth,
  });
  return normalizePlatforms(raw);
}

export function printPlatforms(
  platforms: PlatformAuthInfo[],
  options: { auth?: boolean } = {},
) {
  if (!platforms.length) {
    console.log("未返回平台列表（扩展是否已连接？）");
    return;
  }
  for (const p of platforms) {
    const id = p.id || "?";
    const name = p.name || id;
    if (options.auth) {
      const flag = p.isAuthenticated ? "已登录" : "未登录";
      const user = p.username || p.userId || "";
      console.log(
        `${p.isAuthenticated ? "✓" : "·"} ${id.padEnd(14)} ${name}  [${flag}]${user ? `  ${user}` : ""}`,
      );
    } else {
      console.log(`${id.padEnd(14)} ${name}`);
    }
  }
}
