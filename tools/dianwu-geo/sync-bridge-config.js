/**
 * Runs before the bundled SW MCPClient.
 * Rewrites ws://localhost:9527 connections to configured URL + token.
 * When MCP is disabled, block local bridge sockets so DevTools is not
 * flooded with net::ERR_CONNECTION_REFUSED.
 */
(function initSyncBridgeConfig() {
  const DEFAULT_URL = "ws://127.0.0.1:9527";
  /** @type {{ url: string, token: string, enabled: boolean, ready: boolean }} */
  const cache = { url: DEFAULT_URL, token: "", enabled: false, ready: false };

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
      chrome.storage.local.get(
        ["mcpServerUrl", "mcpToken", "mcpEnabled"],
        (data) => {
          if (chrome.runtime.lastError) {
            cache.ready = true;
            return;
          }
          cache.url = normalizeUrl(data?.mcpServerUrl || DEFAULT_URL);
          cache.token = String(data?.mcpToken || "").trim();
          cache.enabled = !!data?.mcpEnabled;
          cache.ready = true;
        },
      );
    } catch {
      cache.ready = true;
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
      if (changes.mcpEnabled) {
        cache.enabled = !!changes.mcpEnabled.newValue;
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
      return (
        String(url).includes("localhost:9527") ||
        String(url).includes("127.0.0.1:9527")
      );
    }
  }

  function rewriteUrl(url) {
    const raw = String(url);
    if (!isBuiltinMcpTarget(raw) && raw !== cache.url) {
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

  /** Avoid real TCP when MCP is off — prevents CONNECTION_REFUSED spam. */
  function createDisabledSocket(url) {
    const CLOSED = 3;
    /** @type {any} */
    const sock = {
      url: String(url),
      readyState: CLOSED,
      bufferedAmount: 0,
      extensions: "",
      protocol: "",
      binaryType: "blob",
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
      close() {
        this.readyState = CLOSED;
      },
      send() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    };
    queueMicrotask(() => {
      try {
        sock.onclose?.({
          code: 1000,
          reason: "MCP disabled",
          wasClean: true,
        });
      } catch {
        // ignore
      }
    });
    return sock;
  }

  const NativeWebSocket = globalThis.WebSocket;
  if (!NativeWebSocket || NativeWebSocket.__dwgeoPatched) return;

  function PatchedWebSocket(url, protocols) {
    const target = String(url);
    const isMcp = isBuiltinMcpTarget(target) || target.includes("9527");

    // Only short-circuit after storage is known; avoid racing first connect.
    if (isMcp && cache.ready && !cache.enabled) {
      return createDisabledSocket(target);
    }

    const rewritten = rewriteUrl(url);
    if (rewritten !== target) {
      console.log(
        "[dianwu-geo] MCP WebSocket rewrite:",
        target,
        "->",
        rewritten.replace(/token=[^&]+/, "token=***"),
      );
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
  globalThis.__DWGEO_MCP_ENABLED__ = () => cache.enabled;
})();
