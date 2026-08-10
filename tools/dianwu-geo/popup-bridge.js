/** Open extension sync UI — popup window is reliable from web pages; toolbar openPopup needs a strict user gesture. */

async function openSyncPageFallbackWindow(path = "", windowId) {
  const url =
    chrome.runtime.getURL("src/popup/index.html") + (path ? `#${path}` : "");
  const width = 420;
  const height = 600;
  const anchor =
    windowId !== undefined
      ? await chrome.windows.get(windowId)
      : await chrome.windows.getCurrent();
  const left =
    anchor.left !== undefined && anchor.width !== undefined
      ? Math.round(anchor.left + anchor.width - width - 12)
      : undefined;
  const top =
    anchor.top !== undefined ? Math.round(anchor.top + 64) : undefined;

  const win = await chrome.windows.create({
    url,
    type: "popup",
    width,
    height,
    left,
    top,
    focused: true,
  });
  if (!win?.id) {
    throw new Error("无法创建同步面板窗口");
  }
  return { success: true, mode: "popup_window", windowId: win.id };
}

async function openActionPopup(message) {
  const windowId = message?.windowId;
  const preferToolbar = message?.preferToolbarPopup !== false;

  if (typeof chrome.action?.openPopup === "function") {
    try {
      await chrome.action.openPopup(
        windowId !== undefined ? { windowId } : undefined,
      );
      return { success: true, mode: "action_popup" };
    } catch (err) {
      console.warn("[dianwu-geo] chrome.action.openPopup failed:", err);
      if (preferToolbar) {
        throw new Error(
          "无法自动展开扩展面板，请点击浏览器工具栏上的「点物GEO」图标",
        );
      }
    }
  }

  if (preferToolbar) {
    throw new Error("请点击浏览器工具栏上的「点物GEO」扩展图标");
  }

  return openSyncPageFallbackWindow(message?.path || "", windowId);
}

async function clearStaleSyncState() {
  try {
    await chrome.storage.local.remove("activeSyncState");
  } catch {
    // ignore
  }
  try {
    await chrome.runtime.sendMessage({ type: "CLEAR_SYNC_STATE" });
  } catch {
    // ignore — main SW listener may already own this message
  }
}

async function handleOpenActionPopupMessage(message, sender) {
  if (message.pendingArticle) {
    // Drop recovered sync state so popup does not keep showing the previous article.
    await clearStaleSyncState();
    await chrome.storage.local.set({
      pendingArticle: {
        ...message.pendingArticle,
        _openedAt: Date.now(),
      },
    });
  }
  return openActionPopup({
    windowId: message.windowId ?? sender?.tab?.windowId,
    path: message.path,
    preferToolbarPopup: message.preferToolbarPopup === true,
  });
}

function replyAsync(handler, sendResponse) {
  handler()
    .then(sendResponse)
    .catch((err) =>
      sendResponse({
        success: false,
        error: err?.message || String(err),
      }),
    );
}

async function injectPageBridge(tabId) {
  const extensionId = chrome.runtime.id;
  const injectUrl = chrome.runtime.getURL("inject-api.js");

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (id, url) => {
      window.__DWGEO_EXTENSION_INSTALLED__ = true;
      window.__DWGEO_EXTENSION_ID__ = id;
      document.documentElement?.setAttribute("data-dwgeo-extension-id", id);
      document.documentElement?.setAttribute("data-dwgeo-inject-url", url);
      if (!window.$syncer) {
        const script = document.createElement("script");
        script.src = url;
        document.documentElement.appendChild(script);
      }
    },
    args: [extensionId, injectUrl],
  });

  return { success: true, extensionId, injectUrl };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "INJECT_PAGE_BRIDGE") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: "missing tab id" });
      return;
    }
    replyAsync(() => injectPageBridge(tabId), sendResponse);
    return true;
  }
  if (message.type !== "OPEN_ACTION_POPUP") return;
  replyAsync(() => handleOpenActionPopupMessage(message, sender), sendResponse);
  return true;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "GET_SYNC_STATE") {
    replyAsync(async () => {
      const data = await chrome.storage.local.get("activeSyncState");
      return { syncState: data?.activeSyncState || null };
    }, sendResponse);
    return true;
  }
  if (message.type === "OPEN_ACTION_POPUP") {
    replyAsync(() => handleOpenActionPopupMessage(message, sender), sendResponse);
    return true;
  }
});
