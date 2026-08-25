/**
 * Retired: local CLI / MCP WebSocket (ws://127.0.0.1:9527) is not a product path.
 * Keep the bundled MCPClient from opening sockets so DevTools stays quiet.
 */
(function initSyncBridgeConfig() {
  function retireLocalMcp() {
    try {
      chrome.storage.local.get(["mcpEnabled"], (data) => {
        if (data?.mcpEnabled) chrome.storage.local.set({ mcpEnabled: false });
      });
    } catch {
      // ignore
    }
  }
  retireLocalMcp();

  function isRetiredMcpTarget(url) {
    const raw = String(url || "");
    if (raw.includes(":9527") || raw.includes("9527")) return true;
    try {
      const u = new URL(raw);
      const host = u.hostname;
      const isLocal =
        host === "localhost" || host === "127.0.0.1" || host === "[::1]";
      return isLocal && (u.port === "9527" || raw.includes(":9527"));
    } catch {
      return false;
    }
  }

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
          reason: "local MCP retired",
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
    if (isRetiredMcpTarget(url)) return createDisabledSocket(url);
    if (protocols === undefined) return new NativeWebSocket(url);
    return new NativeWebSocket(url, protocols);
  }

  PatchedWebSocket.prototype = NativeWebSocket.prototype;
  Object.assign(PatchedWebSocket, NativeWebSocket);
  PatchedWebSocket.__dwgeoPatched = true;
  globalThis.WebSocket = PatchedWebSocket;
  globalThis.__DWGEO_MCP_ENABLED__ = () => false;
})();
