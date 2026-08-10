import {
  ensureSharedBridgeStarted,
  type BridgeServer,
} from "../bridge-server.js";
import type { PlatformAuthInfo } from "../protocol.js";
import { listPlatforms, printPlatforms } from "./platforms.js";

export async function checkAuth(options: {
  platform?: string;
  refresh?: boolean;
  bridge?: BridgeServer;
  waitExtensionMs?: number;
} = {}): Promise<PlatformAuthInfo | PlatformAuthInfo[]> {
  const bridge = options.bridge ?? (await ensureSharedBridgeStarted());
  await bridge.waitForExtension(options.waitExtensionMs);

  if (!options.platform) {
    const all = await listPlatforms({
      auth: true,
      forceRefresh: !!options.refresh,
      bridge,
    });
    return all;
  }

  const result = await bridge.call<PlatformAuthInfo>("checkAuth", {
    platform: options.platform,
  });
  return result;
}

export function printAuth(
  result: PlatformAuthInfo | PlatformAuthInfo[],
  platform?: string,
) {
  if (Array.isArray(result)) {
    printPlatforms(result, { auth: true });
    return;
  }
  const id = platform || result.id || "?";
  if (result.isAuthenticated) {
    console.log(
      `✓ ${id} 已登录${result.username || result.userId ? `（${result.username || result.userId}）` : ""}`,
    );
  } else {
    console.log(`✗ ${id} 未登录${result.error ? `：${result.error}` : ""}`);
  }
}
