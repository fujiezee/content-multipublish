/**
 * SaaS bind: always https://dianwu.ai. No local / custom origin.
 * Storage keys: saasBaseUrl, saasToken, saasHandshake
 */
(function () {
  const PROTOCOL = 1200;
  const SAAS_BASE_URL = "https://dianwu.ai";

  async function ensureBaseUrl() {
    const data = await chrome.storage.local.get(["saasBaseUrl", "saasToken"]);
    const current = String(data.saasBaseUrl || "").replace(/\/$/, "");
    if (current !== SAAS_BASE_URL) {
      await chrome.storage.local.set({ saasBaseUrl: SAAS_BASE_URL });
    }
    return {
      baseUrl: SAAS_BASE_URL,
      token: String(data.saasToken || "").trim(),
    };
  }

  async function readConfig() {
    const { baseUrl, token } = await ensureBaseUrl();
    const data = await chrome.storage.local.get(["saasHandshake"]);
    return { baseUrl, token, last: data.saasHandshake || null };
  }

  async function handshake() {
    const { baseUrl, token } = await ensureBaseUrl();
    const manifest = chrome.runtime.getManifest();
    try {
      const res = await fetch(`${baseUrl}/api/extension/handshake`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          extensionVersion: manifest.version,
          protocolVersion: PROTOCOL,
          token,
        }),
      });
      const json = await res.json().catch(() => ({}));
      const payload = {
        at: Date.now(),
        ok: Boolean(json.ok),
        compatible: Boolean(json.compatible),
        bound: Boolean(json.bound),
        workspaceId: json.workspaceId || null,
        notes: json.notes || "",
        serverProtocolVersion: json.serverProtocolVersion,
      };
      await chrome.storage.local.set({ saasHandshake: payload });
      console.info("[dianwu-geo] saas handshake", payload);
      return payload;
    } catch (err) {
      const payload = {
        at: Date.now(),
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      await chrome.storage.local.set({ saasHandshake: payload });
      return payload;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "SAAS_HANDSHAKE") return;
    handshake().then((r) => sendResponse(r));
    return true;
  });

  ensureBaseUrl()
    .then(() => handshake())
    .catch(() => undefined);

  globalThis.__DWGEO_SAAS__ = { readConfig, handshake, PROTOCOL, SAAS_BASE_URL };
})();
