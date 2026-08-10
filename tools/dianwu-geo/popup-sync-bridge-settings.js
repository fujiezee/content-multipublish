/**
 * Injects CLI / MCP bridge settings into the popup「设置」drawer
 * (under Claude Code / MCP), and enlarges that drawer + popup chrome.
 */
(function popupSyncBridgeSettings() {
  const PANEL_ID = "dwgeo-sync-bridge-settings";
  const STYLE_ID = "dwgeo-sync-bridge-layout";
  const DEFAULT_URL = "ws://127.0.0.1:9527";

  function ensureLayoutStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /* 600px fits Chrome popup max — prevents OUTER browser scrollbar */
      html, body {
        width: 420px !important;
        height: 600px !important;
        max-height: 600px !important;
        overflow: hidden !important;
        margin: 0 !important;
      }
      #root {
        width: 100% !important;
        height: 100% !important;
        max-height: 100% !important;
        overflow: hidden !important;
        margin: 0 !important;
      }
      #root > div.flex.flex-col {
        height: 100% !important;
        max-height: 100% !important;
        overflow: hidden !important;
        min-height: 0 !important;
      }
      /* Inner only: platform list scrolls */
      #root main {
        overflow-x: hidden !important;
        overflow-y: auto !important;
        flex: 1 1 0 !important;
        min-height: 0 !important;
      }

      #${PANEL_ID} {
        margin-top: 4px;
        padding: 14px 14px 16px;
        border-radius: 12px;
        border: 1px solid #e5e7eb;
        background: #fffdf9;
        box-sizing: border-box;
      }
      #${PANEL_ID} .dwgeo-bridge-title {
        font-size: 13px;
        font-weight: 600;
        color: #101828;
        margin: 0 0 4px;
      }
      #${PANEL_ID} .dwgeo-bridge-hint {
        font-size: 12px;
        color: #667085;
        margin: 0 0 12px;
        line-height: 1.45;
      }
      #${PANEL_ID} label {
        display: block;
        font-size: 12px;
        color: #344054;
        margin: 0 0 4px;
      }
      #${PANEL_ID} input[type="text"],
      #${PANEL_ID} input[type="password"] {
        width: 100%;
        box-sizing: border-box;
        padding: 9px 10px;
        border: 1px solid #d0d5dd;
        border-radius: 8px;
        font-size: 13px;
        margin-bottom: 10px;
        background: #fff;
      }
      #${PANEL_ID} .dwgeo-bridge-status {
        font-size: 12px;
        color: #667085;
        margin: 2px 0 6px;
        line-height: 1.4;
      }
      #${PANEL_ID} .dwgeo-bridge-msg {
        font-size: 12px;
        color: #027a48;
        min-height: 18px;
        margin-bottom: 8px;
      }
      #${PANEL_ID} .dwgeo-bridge-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      #${PANEL_ID} .dwgeo-bridge-actions button {
        padding: 8px 12px;
        border-radius: 8px;
        font-size: 12px;
        cursor: pointer;
      }
      #${PANEL_ID} .dwgeo-bridge-actions button.primary {
        border: none;
        background: #1d4ed8;
        color: #fff;
      }
      #${PANEL_ID} .dwgeo-bridge-actions button.ghost {
        border: 1px solid #d0d5dd;
        background: #fff;
        color: #344054;
      }
    `;
    document.head.appendChild(style);
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "className") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else {
          node.setAttribute(k, String(v));
        }
      }
    }
    for (const child of children || []) {
      if (child == null) continue;
      node.appendChild(
        typeof child === "string" ? document.createTextNode(child) : child,
      );
    }
    return node;
  }

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        ["mcpServerUrl", "mcpToken", "mcpEnabled"],
        (data) => {
          resolve({
            url: data?.mcpServerUrl || DEFAULT_URL,
            token: data?.mcpToken || "",
            enabled: !!data?.mcpEnabled,
          });
        },
      );
    });
  }

  function saveSettings(url, token) {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        {
          mcpServerUrl: (url || DEFAULT_URL).trim(),
          mcpToken: (token || "").trim(),
        },
        () => resolve(),
      );
    });
  }

  function fetchStatus() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "MCP_STATUS" }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({
            enabled: false,
            connected: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }
        resolve(resp || { enabled: false, connected: false });
      });
    });
  }

  function statusText(st) {
    if (st.connected) return "桥接：已连接";
    if (st.enabled) return "桥接：已开启，等待连接…（请先运行 dianwu-geo serve）";
    return "桥接：未开启（请先打开上方「MCP 连接」开关）";
  }

  function hideFeedbackLinks() {
    const candidates = document.querySelectorAll("button, a, [role='button']");
    for (const node of candidates) {
      const text = (node.textContent || "").replace(/\s+/g, "").trim();
      if (text === "问题反馈" || text.endsWith("问题反馈")) {
        node.style.display = "none";
        const wrap = node.closest("div");
        if (
          wrap &&
          wrap !== document.body &&
          (wrap.textContent || "").replace(/\s+/g, "").trim() === "问题反馈"
        ) {
          wrap.style.display = "none";
        }
      }
    }
  }

  function enlargeSettingsDrawer(drawer) {
    if (!drawer) return;
    drawer.style.width = "min(420px, 100vw)";
    drawer.style.maxWidth = "100vw";
    drawer.style.overflow = "hidden";
    const scroll = drawer.querySelector(".overflow-y-auto");
    if (scroll) {
      scroll.style.height = "calc(100% - 64px)";
      scroll.style.maxHeight = "none";
      scroll.style.paddingBottom = "20px";
      scroll.style.overflowY = "auto";
    }
  }

  function findSettingsScrollHost() {
    const headings = document.querySelectorAll("h2");
    for (const h of headings) {
      if ((h.textContent || "").trim() !== "设置") continue;
      const drawer = h.closest(".fixed");
      if (!drawer) continue;
      enlargeSettingsDrawer(drawer);
      const scroll = drawer.querySelector(".overflow-y-auto");
      return scroll || drawer;
    }
    return null;
  }

  function findClaudeSection(scrollHost) {
    const nodes = scrollHost.querySelectorAll("h3, p, div");
    for (const node of nodes) {
      const t = (node.textContent || "").trim();
      if (t === "Claude Code 集成" || t.startsWith("Claude Code")) {
        // Prefer the section container (space-y-3 wrapper)
        return (
          node.closest(".space-y-3") ||
          node.parentElement ||
          node
        );
      }
    }
    return null;
  }

  async function buildPanel() {
    const settings = await loadSettings();
    const status = await fetchStatus();

    const urlInput = el("input", {
      type: "text",
      placeholder: DEFAULT_URL,
    });
    urlInput.value = settings.url;

    const tokenInput = el("input", {
      type: "password",
      placeholder: "与 DIANWU_GEO_TOKEN 一致（可空）",
    });
    tokenInput.value = settings.token;

    const statusLine = el("div", {
      className: "dwgeo-bridge-status",
      text: statusText(status),
    });
    const msg = el("div", { className: "dwgeo-bridge-msg" });

    const saveBtn = el(
      "button",
      {
        type: "button",
        className: "primary",
        onclick: async () => {
          await saveSettings(urlInput.value, tokenInput.value);
          msg.textContent = "已保存。请关闭再开启「MCP 连接」使地址生效。";
          statusLine.textContent = statusText(await fetchStatus());
        },
      },
      ["保存桥接设置"],
    );

    const refreshBtn = el(
      "button",
      {
        type: "button",
        className: "ghost",
        onclick: async () => {
          statusLine.textContent = statusText(await fetchStatus());
          msg.textContent = "";
        },
      },
      ["刷新状态"],
    );

    return el("div", { id: PANEL_ID, "data-dwgeo-bridge": "1" }, [
      el("p", { className: "dwgeo-bridge-title", text: "CLI / MCP 同步桥接" }),
      el("p", {
        className: "dwgeo-bridge-hint",
        text: "服务器默认 ws://127.0.0.1:9527，本机执行 dianwu-geo serve 或 npm run geo:serve。",
      }),
      el("label", { text: "服务器地址" }),
      urlInput,
      el("label", { text: "Token" }),
      tokenInput,
      statusLine,
      msg,
      el("div", { className: "dwgeo-bridge-actions" }, [saveBtn, refreshBtn]),
    ]);
  }

  /** Hide stock “运行 yarn mcp …” hint — replaced by our bridge panel. */
  function hideStockMcpHints(root) {
    if (!root) return;
    for (const p of root.querySelectorAll("p")) {
      const t = (p.textContent || "").replace(/\s+/g, "");
      if (
        t.includes("yarnmcp") ||
        (t.includes("运行") && t.includes("启动服务"))
      ) {
        p.style.display = "none";
      }
    }
  }

  let mounting = false;

  async function mountIntoSettings() {
    ensureLayoutStyles();
    hideFeedbackLinks();
    const scrollHost = findSettingsScrollHost();
    if (!scrollHost) {
      document.getElementById(PANEL_ID)?.remove();
      return;
    }

    hideStockMcpHints(scrollHost);

    if (document.getElementById(PANEL_ID) || mounting) return;
    mounting = true;
    try {
      // Re-check after await — MutationObserver can fire concurrently
      if (document.getElementById(PANEL_ID)) return;
      const panel = await buildPanel();
      if (document.getElementById(PANEL_ID)) return;

      const claude = findClaudeSection(scrollHost);
      if (claude && claude.parentElement) {
        claude.insertAdjacentElement("afterend", panel);
      } else {
        scrollHost.appendChild(panel);
      }
      hideStockMcpHints(scrollHost);
    } finally {
      mounting = false;
    }
  }

  ensureLayoutStyles();
  hideFeedbackLinks();

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      void mountIntoSettings();
    });
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => void mountIntoSettings(), 300);
    });
  } else {
    setTimeout(() => void mountIntoSettings(), 300);
  }
})();
