/**
 * Injects 点物网站 bind settings into the popup「设置」drawer.
 * Local CLI / MCP serve is retired — hide Wechatsync MCP UI and keep MCP off.
 */
(function popupSyncBridgeSettings() {
  const PANEL_ID = "dwgeo-sync-bridge-settings";
  const STYLE_ID = "dwgeo-sync-bridge-layout";

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
      #${PANEL_ID} .dwgeo-bridge-split {
        margin-top: 16px;
        padding-top: 14px;
        border-top: 1px solid #e5e7eb;
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

  async function buildPanel() {
    return el("div", { id: PANEL_ID, "data-dwgeo-bridge": "1" }, [
      el("p", { className: "dwgeo-bridge-title", text: "点物网站" }),
      el("p", {
        className: "dwgeo-bridge-hint",
        text: "已对接 https://dianwu.ai。装好扩展后，打开网站点同步/发布即可。",
      }),
    ]);
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

    const saasUrlInput = el("input", {
      type: "text",
      placeholder: "https://dianwu.ai 或 http://127.0.0.1:3000",
    });
    saasUrlInput.value = settings.saasBaseUrl;

    const saasTokenInput = el("input", {
      type: "password",
      placeholder: "设置页生成的扩展 Token（可空）",
    });
    saasTokenInput.value = settings.saasToken;

    const saasStatus = el("div", {
      className: "dwgeo-bridge-status",
      text: handshakeText(settings.handshake),
    });
    const saasMsg = el("div", { className: "dwgeo-bridge-msg" });

    const saveSaasBtn = el(
      "button",
      {
        type: "button",
        className: "primary",
        onclick: async () => {
          await saveSaas(saasUrlInput.value, saasTokenInput.value);
          saasMsg.textContent = "已保存。";
          chrome.runtime.sendMessage({ type: "SAAS_HANDSHAKE" }, (resp) => {
            saasStatus.textContent = handshakeText(
              resp || { ok: false, error: chrome.runtime.lastError?.message },
            );
          });
        },
      },
      ["保存网站绑定"],
    );

    return el("div", { id: PANEL_ID, "data-dwgeo-bridge": "1" }, [
      el("p", { className: "dwgeo-bridge-title", text: "点物网站" }),
      el("p", {
        className: "dwgeo-bridge-hint",
        text: "装好扩展，在点物网页点同步/发布即可。网页会直接叫扩展，没有本机脚本。",
      }),
      el("label", { text: "网站地址（可选）" }),
      saasUrlInput,
      el("label", { text: "扩展 Token（可选，设置页生成）" }),
      saasTokenInput,
      saasStatus,
      saasMsg,
      el("div", { className: "dwgeo-bridge-actions" }, [saveSaasBtn]),
    ]);
  }

  function hideRetiredLocalScriptUi(root) {
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
    const claude = findClaudeSection(root);
    if (claude) claude.style.display = "none";
    for (const node of root.querySelectorAll("h3, p, span, label, div")) {
      const t = (node.textContent || "").replace(/\s+/g, "").trim();
      if (t === "MCP连接" || t.startsWith("MCP连接")) {
        const wrap = node.closest(".space-y-3") || node.parentElement;
        if (wrap && wrap !== root) wrap.style.display = "none";
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

    hideRetiredLocalScriptUi(scrollHost);

    if (document.getElementById(PANEL_ID) || mounting) return;
    mounting = true;
    try {
      // Re-check after await — MutationObserver can fire concurrently
      if (document.getElementById(PANEL_ID)) return;
      const panel = await buildPanel();
      if (document.getElementById(PANEL_ID)) return;

      const claude = findClaudeSection(scrollHost);
      if (claude && claude.parentElement) {
        claude.style.display = "none";
        claude.insertAdjacentElement("afterend", panel);
      } else {
        scrollHost.appendChild(panel);
      }
      hideRetiredLocalScriptUi(scrollHost);
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
