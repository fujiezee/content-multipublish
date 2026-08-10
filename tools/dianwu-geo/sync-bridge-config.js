/**
 * Runs before the bundled SW MCPClient.
 * Rewrites ws://localhost:9527 connections to configured URL + token.
 */
(function initSyncBridgeConfig() {
  const DEFAULT_URL = "ws://127.0.0.1:9527";
  /** @type {{ url: string, token: string }} */
  const cache = { url: DEFAULT_URL, token: "" };

  function normalizeUrl(raw) {
    const s = String(raw || "").trim();
    if (!s) return DEFAULT_URL;
    if (s.startsWith("ws://") || s.startsWith("wss://")) return s;
    if (s.startsWith("http://")) return `ws://${s.slice("http://".length)}`;
    if (s.startsWith("https://")) return `wss://${s.slice("https://".length)}`;
    return `ws://${s}`;
  }

  function refreshFromStorage() {
    try {
      chrome.storage.local.get(["mcpServerUrl", "mcpToken"], (data) => {
        if (chrome.runtime.lastError) return;
        cache.url = normalizeUrl(data?.mcpServerUrl || DEFAULT_URL);
        cache.token = String(data?.mcpToken || "").trim();
      });
    } catch {
      // ignore
    }
  }

  refreshFromStorage();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.mcpServerUrl) {
        cache.url = normalizeUrl(changes.mcpServerUrl.newValue || DEFAULT_URL);
      }
      if (changes.mcpToken) {
        cache.token = String(changes.mcpToken.newValue || "").trim();
      }
    });
  } catch {
    // ignore
  }

  function isBuiltinMcpTarget(url) {
    try {
      const u = new URL(String(url));
      const host = u.hostname;
      const port = u.port || (u.protocol === "wss:" ? "443" : "80");
      const isLocal =
        host === "localhost" || host === "127.0.0.1" || host === "[::1]";
      return isLocal && (port === "9527" || String(url).includes(":9527"));
    } catch {
      return String(url).includes("localhost:9527") || String(url).includes("127.0.0.1:9527");
    }
  }

  function rewriteUrl(url) {
    const raw = String(url);
    if (!isBuiltinMcpTarget(raw) && raw !== cache.url) {
      // Still allow rewriting when MCPClient uses exactly the cached default
      if (!raw.includes("9527")) return raw;
    }

    let next = cache.url || DEFAULT_URL;
    if (cache.token) {
      try {
        const u = new URL(next);
        if (!u.searchParams.get("token")) {
          u.searchParams.set("token", cache.token);
        }
        next = u.toString();
      } catch {
        const sep = next.includes("?") ? "&" : "?";
        next = `${next}${sep}token=${encodeURIComponent(cache.token)}`;
      }
    }
    return next;
  }

  const NativeWebSocket = globalThis.WebSocket;
  if (!NativeWebSocket || NativeWebSocket.__dwgeoPatched) return;

  function PatchedWebSocket(url, protocols) {
    const rewritten = rewriteUrl(url);
    if (rewritten !== String(url)) {
      console.log("[dianwu-geo] MCP WebSocket rewrite:", url, "->", rewritten.replace(/token=[^&]+/, "token=***"));
    }
    if (protocols === undefined) {
      return new NativeWebSocket(rewritten);
    }
    return new NativeWebSocket(rewritten, protocols);
  }

  PatchedWebSocket.prototype = NativeWebSocket.prototype;
  Object.assign(PatchedWebSocket, NativeWebSocket);
  PatchedWebSocket.__dwgeoPatched = true;
  globalThis.WebSocket = PatchedWebSocket;
  globalThis.__DWGEO_BRIDGE_URL__ = () => cache.url;
  globalThis.__DWGEO_BRIDGE_TOKEN__ = () => cache.token;
})();
