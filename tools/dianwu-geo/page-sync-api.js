/**
 * Injects window.$syncer for local editor / dianwu.ai pages (article-syncjs SDK).
 * Based on Wechatsync v2 content/api.ts — talks to extension via postMessage bridge.
 */

const PRODUCT_TITLE = "点物GEO 文章多平台同步助手";
const PENDING_ARTICLE_STORAGE_KEY = "dianwu-geo-pending-article";

function isLocalEditorHost() {
  const host = window.location.hostname;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.endsWith(".local")
  );
}

function readPendingArticleFromSession() {
  try {
    const raw = sessionStorage.getItem(PENDING_ARTICLE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readEditorFieldValue(selector) {
  const el = document.querySelector(selector);
  if (!el) return "";
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value.trim();
  }
  return (
    el.getAttribute("data-value")?.trim() ||
    el.textContent?.trim() ||
    ""
  );
}

function isBadArticleTitle(title) {
  const value = title?.trim();
  if (!value) return true;
  if (value === PRODUCT_TITLE) return true;
  return value.startsWith(`${PRODUCT_TITLE} ·`);
}

let currentSyncId = null;
/** @type {Array<Record<string, unknown>>} */
let currentAccounts = [];
/** @type {Map<string, number>} */
const recentBridgeActions = new Map();

function shouldHandleBridgeAction(action) {
  const eventID = action?.eventID;
  const method = action?.method;
  if (!eventID || !method) return true;
  const key = `${method}:${eventID}`;
  const now = Date.now();
  const last = recentBridgeActions.get(key);
  if (last != null && now - last < 800) return false;
  recentBridgeActions.set(key, now);
  if (recentBridgeActions.size > 200) {
    for (const [k, ts] of recentBridgeActions) {
      if (now - ts > 10_000) recentBridgeActions.delete(k);
    }
  }
  return true;
}

function sendToWindow(msg) {
  msg.callReturn = true;
  const serialized = JSON.stringify(msg);
  window.postMessage(serialized, "*");
  try {
    const script = document.createElement("script");
    script.textContent = `(function(){try{window.postMessage(${JSON.stringify(serialized)},"*");}catch(e){}})();`;
    (document.documentElement || document.head).appendChild(script);
    script.remove();
  } catch (err) {
    console.warn("[dianwu-geo] sendToWindow page inject failed:", err);
  }
}

function sendTaskUpdate(task) {
  window.postMessage(
    JSON.stringify({
      method: "taskUpdate",
      task: task,
    }),
    "*",
  );
}

function mapPlatformToAccount(platform) {
  return {
    type: platform.id,
    title: platform.username || platform.name,
    displayName: platform.name,
    icon: platform.icon,
    avatar: platform.icon,
    uid: platform.username,
    home: platform.homepage,
    supportTypes: ["html"],
  };
}

/** Read article from local editor page (avoid document.title fallback). */
function extractLocalEditorArticle() {
  const onEditorPage = /^\/articles\/[^/]+\/?$/.test(
    window.location.pathname,
  );
  if (!onEditorPage) return null;
  if (!isLocalEditorHost()) return null;

  const pending = readPendingArticleFromSession();
  const titleFromDom =
    readEditorFieldValue("[data-dwgeo-article-title]") ||
    readEditorFieldValue('input[placeholder="文章标题"]');
  const summaryEl =
    document.querySelector("[data-dwgeo-article-summary]") ||
    document.querySelector('input[placeholder^="摘要"]');
  const coverEl = document.querySelector("[data-dwgeo-article-cover]");
  const bodyEl =
    document.querySelector("[data-dwgeo-article-body] .ProseMirror") ||
    document.querySelector(".ProseMirror");

  const articleTitle =
    (titleFromDom && !isBadArticleTitle(titleFromDom)
      ? titleFromDom
      : pending?.title && !isBadArticleTitle(pending.title)
        ? pending.title
        : "") || "";
  const html =
    bodyEl?.innerHTML?.trim() || pending?.content || pending?.html || "";
  if (!articleTitle || !html) return null;

  const coverFromAttr = coverEl?.getAttribute("data-dwgeo-article-cover")?.trim();
  let cover = coverFromAttr || undefined;
  if (cover?.startsWith("/")) {
    cover = `${window.location.origin}${cover}`;
  }
  if (!cover) {
    const firstImg = bodyEl?.querySelector("img[src]");
    const src = firstImg?.getAttribute("src")?.trim();
    if (src && !src.startsWith("data:") && !src.includes("article-placeholder")) {
      cover = src.startsWith("/")
        ? `${window.location.origin}${src}`
        : src;
    }
  }

  return {
    title: articleTitle,
    html,
    content: html,
    markdown: "",
    summary:
      readEditorFieldValue("[data-dwgeo-article-summary]") ||
      summaryEl?.value?.trim() ||
      undefined,
    desc:
      readEditorFieldValue("[data-dwgeo-article-summary]") ||
      summaryEl?.value?.trim() ||
      undefined,
    ...(cover ? { cover } : {}),
    source: { url: window.location.href, platform: "local-editor" },
  };
}

function resolveSyncTitle(post) {
  const fromPost = post?.title?.trim();
  if (fromPost && !isBadArticleTitle(fromPost)) return fromPost;

  const fromDom =
    readEditorFieldValue("[data-dwgeo-article-title]") ||
    readEditorFieldValue('input[placeholder="文章标题"]');
  if (fromDom && !isBadArticleTitle(fromDom)) return fromDom;

  const pending = readPendingArticleFromSession();
  const fromPending = pending?.title?.trim();
  if (fromPending && !isBadArticleTitle(fromPending)) return fromPending;

  return fromPost || fromDom || fromPending || "";
}

function updateAccountFromResult(result) {
  const platform = result.platform;
  const account = currentAccounts.find(
    (a) => a.type === platform || a.uid === platform,
  );
  if (!account) return;

  account.status = result.success ? "done" : "failed";
  account.error = result.error;
  account.msg = undefined;
  account.editResp = result.success
    ? { draftLink: result.postUrl || result.url }
    : null;
}

function buildPendingArticle(post) {
  const htmlContent = post.content || post.html || "";
  const articleTitle = resolveSyncTitle(post);
  if (!articleTitle) return null;

  const cover = pickArticleCover(post);

  return {
    title: articleTitle,
    content: htmlContent,
    html: htmlContent,
    markdown: post.markdown || "",
    summary: post.desc || post.summary || undefined,
    ...(cover ? { cover } : {}),
    source: post.source || {
      url: window.location.href,
      platform: "local-editor",
    },
  };
}

function pickArticleCover(post) {
  const raw =
    post.thumb ||
    post.cover ||
    readEditorFieldValue("[data-dwgeo-article-cover]") ||
    undefined;
  if (!raw || String(raw).includes("article-placeholder")) return undefined;
  return raw;
}

function notifyPageSyncResult(result) {
  const payload = {
    method: "dianwuGeoSyncResult",
    ...result,
  };
  const serialized = JSON.stringify(payload);
  window.postMessage(serialized, "*");
  try {
    document.dispatchEvent(
      new CustomEvent("dianwu-geo-sync-result", { detail: payload }),
    );
  } catch {
    // ignore
  }
  try {
    const script = document.createElement("script");
    script.textContent = `(function(){try{var p=${JSON.stringify(serialized)};window.postMessage(p,"*");document.dispatchEvent(new CustomEvent("dianwu-geo-sync-result",{detail:JSON.parse(p)}));}catch(e){}})();`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  } catch {
    // ignore
  }
}

function stashAndOpenExtensionActionPopup(pendingArticle, done, options = {}) {
  let finished = false;
  const finish = (result) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    done?.(result);
  };

  const timer = setTimeout(() => {
    finish({
      success: false,
      error:
        "扩展未响应。请在 chrome://extensions 重新加载「点物GEO 文章多平台同步助手」后重试。",
    });
  }, 12_000);

  const stamped = {
    ...pendingArticle,
    _openedAt: Date.now(),
  };

  try {
    // Clear recovered sync first so the popup won't stick to a previous article.
    chrome.storage.local.remove("activeSyncState", () => {
      chrome.storage.local.set({ pendingArticle: stamped }, () => {
        if (chrome.runtime.lastError) {
          console.warn("[dianwu-geo] stash pendingArticle:", chrome.runtime.lastError);
        }
      });
    });
  } catch (err) {
    console.warn("[dianwu-geo] stash pendingArticle failed:", err);
  }

  chrome.runtime.sendMessage(
    {
      type: "OPEN_ACTION_POPUP",
      pendingArticle: stamped,
      preferToolbarPopup: options?.preferToolbarPopup !== false,
    },
    (resp) => {
      const runtimeError = chrome.runtime.lastError?.message;
      if (runtimeError) {
        finish({ success: false, error: runtimeError });
        return;
      }
      if (!resp?.success) {
        finish(
          resp || { success: false, error: "无法打开同步面板，请重新加载扩展" },
        );
        return;
      }
      finish(resp);
    },
  );
}

function mergeManualSyncSource(fromDom, fromSession) {
  if (!fromDom && !fromSession) return null;
  if (!fromDom) return fromSession;
  if (!fromSession) return fromDom;
  return {
    ...fromSession,
    ...fromDom,
    title: fromDom.title || fromSession.title,
    html: fromDom.html || fromDom.content || fromSession.html || fromSession.content,
    content: fromDom.content || fromDom.html || fromSession.content || fromSession.html,
    summary: fromDom.summary || fromDom.desc || fromSession.summary || fromSession.desc,
    desc: fromDom.desc || fromDom.summary || fromSession.desc || fromSession.summary,
    cover: fromDom.cover || fromSession.cover,
  };
}

function handleManualSyncRequest() {
  try {
    const fromDom = extractLocalEditorArticle();
    const fromSession = readPendingArticleFromSession();
    const source = mergeManualSyncSource(fromDom, fromSession);
    if (!source) {
      notifyPageSyncResult({
        success: false,
        error: "未读取到文章内容，请填写标题和正文后重试",
      });
      return;
    }

    const pendingArticle = buildPendingArticle(source);
    if (!pendingArticle) {
      notifyPageSyncResult({
        success: false,
        error: "文章标题无效，请检查标题后重试",
      });
      return;
    }

    stashAndOpenExtensionActionPopup(pendingArticle, (result) => {
      notifyPageSyncResult(result);
    });
  } catch (err) {
    notifyPageSyncResult({
      success: false,
      error: err?.message || String(err),
    });
  }
}

document.addEventListener("dianwu-geo-request-sync", handleManualSyncRequest);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "EXTRACT_ARTICLE") {
    const article = extractLocalEditorArticle();
    if (article) {
      sendResponse({ article });
      return true;
    }
    return;
  }

  try {
    if (message.syncId && currentSyncId && message.syncId !== currentSyncId) {
      return;
    }

    if (message.method === "taskUpdate") {
      sendToWindow({ task: message.task, method: "taskUpdate" });
      return;
    }

    if (message.type === "SYNC_PROGRESS") {
      const result = message.result || message.payload?.result;
      if (result) {
        updateAccountFromResult(result);
        sendTaskUpdate({ accounts: currentAccounts });
      }
    }

    if (message.type === "SYNC_DETAIL_PROGRESS") {
      const progress = message.payload || message;
      const account = currentAccounts.find((a) => a.type === progress.platform);
      if (account) {
        account.status = "uploading";
        account.msg =
          progress.stage === "uploading_images"
            ? `上传图片 ${progress.imageProgress?.current}/${progress.imageProgress?.total}`
            : progress.stage === "saving"
              ? "保存中..."
              : progress.stage;
      }
      sendTaskUpdate({ accounts: currentAccounts });
    }

    if (message.type === "SYNC_COMPLETED" || message.type === "SYNC_COMPLETE") {
      currentSyncId = null;
    }
  } catch (e) {
    console.error("[dianwu-geo] page bridge message error:", e);
  }
});

window.addEventListener("message", (evt) => {
  try {
    if (typeof evt.data !== "string") return;
    const action = JSON.parse(evt.data);
    routeBridgeAction(action);
  } catch (_e) {
    // ignore non-JSON messages
  }
});

function routeBridgeAction(action) {
  if (!action || typeof action !== "object") return;
  if (!shouldHandleBridgeAction(action)) return;

  if (action.method === "dianwu-geo-request-sync") {
    handleManualSyncRequest();
    return;
  }
  if (!action.method) return;

  if (action.method === "getAccounts") {
    chrome.runtime.sendMessage({ type: "CHECK_ALL_AUTH" }, (resp) => {
      if (chrome.runtime.lastError) {
        console.error("[dianwu-geo] getAccounts:", chrome.runtime.lastError);
        sendToWindow({ eventID: action.eventID, result: [] });
        return;
      }

      const accounts = (resp?.platforms || [])
        .filter((p) => p.isAuthenticated)
        .map(mapPlatformToAccount);

      sendToWindow({ eventID: action.eventID, result: accounts });
    });
    return;
  }

  if (action.method === "ping") {
    sendToWindow({ eventID: action.eventID, result: { ok: true } });
    return;
  }

  if (action.method === "openSyncPage") {
    const pendingArticle = buildPendingArticle(action.article || {});
    if (!pendingArticle) {
      sendToWindow({
        eventID: action.eventID,
        result: { success: false, error: "缺少文章标题" },
      });
      return;
    }

    stashAndOpenExtensionActionPopup(
      pendingArticle,
      (result) => {
        sendToWindow({ eventID: action.eventID, result });
      },
      { preferToolbarPopup: action.preferToolbarPopup !== false },
    );
    return;
  }

  if (action.method === "addTask") {
    const { task } = action;
    const { post, accounts } = task;
    const platforms = accounts.map((a) => a.type);

    currentSyncId = `sync_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    currentAccounts = accounts.map((a) => ({
      type: a.type,
      title: a.title,
      displayName: a.displayName,
      icon: a.icon,
      avatar: a.avatar,
      uid: a.uid,
      home: a.home,
      supportTypes: a.supportTypes,
      status: "uploading",
      msg: "准备同步...",
      error: undefined,
      editResp: null,
    }));

    sendTaskUpdate({ accounts: currentAccounts });

    const htmlContent = post.content || "";
    const articleTitle = resolveSyncTitle(post);
    if (!articleTitle) {
      console.error("[dianwu-geo] addTask: missing article title");
      return;
    }
    chrome.runtime.sendMessage(
      {
        type: "SYNC_ARTICLE",
        payload: {
          article: {
            title: articleTitle,
            content: htmlContent,
            html: htmlContent,
            markdown: post.markdown || "",
            cover: post.thumb,
          },
          platforms: platforms,
          skipHistory: true,
          source: "legacy-api",
          syncId: currentSyncId,
        },
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error("[dianwu-geo] addTask:", chrome.runtime.lastError);
        }
      },
    );
    return;
  }

  if (action.method === "magicCall") {
    const { methodName } = action;
    if (methodName === "uploadImage") {
      sendToWindow({
        eventID: action.eventID,
        result: { error: "图片上传 API 暂未在此页面启用" },
      });
    }
  }
}

document.addEventListener(
  "dianwu-geo-bridge-request",
  (event) => {
    const detail = event.detail;
    if (!detail || typeof detail !== "object") return;
    routeBridgeAction(detail);
  },
  true,
);

function announceExtensionReady() {
  try {
    sendToWindow({
      method: "dianwuGeoReady",
      extensionId: chrome.runtime.id,
      result: { ok: true },
    });
  } catch (err) {
    console.warn("[dianwu-geo] announce ready failed:", err);
  }
}

function markExtensionOnDom(extensionId, injectUrl) {
  const root = document.documentElement;
  if (!root) return;
  root.setAttribute("data-dwgeo-extension", "1");
  root.setAttribute("data-dwgeo-extension-id", extensionId);
  root.setAttribute("data-dwgeo-inject-url", injectUrl);
  try {
    document.dispatchEvent(
      new CustomEvent("dianwu-geo-init", {
        detail: { extensionId, injectUrl },
      }),
    );
  } catch (err) {
    console.warn("[dianwu-geo] dispatch dianwu-geo-init failed:", err);
  }
}

function injectViaScriptTag(injectUrl) {
  const script = document.createElement("script");
  script.src = injectUrl;
  script.onload = () => {
    announceExtensionReady();
    script.remove();
  };
  script.onerror = () => {
    console.warn("[dianwu-geo] inject-api.js failed to load");
    announceExtensionReady();
  };
  const root = document.documentElement || document.head || document.body;
  if (root) {
    root.appendChild(script);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      (document.head || document.documentElement).appendChild(script);
    });
  }
}

function injectAPI() {
  const extensionId = chrome.runtime.id;
  const injectUrl = chrome.runtime.getURL("inject-api.js");
  markExtensionOnDom(extensionId, injectUrl);

  chrome.runtime.sendMessage({ type: "INJECT_PAGE_BRIDGE" }, (resp) => {
    if (chrome.runtime.lastError || !resp?.success) {
      injectViaScriptTag(injectUrl);
      return;
    }
    announceExtensionReady();
  });
}

console.info("[dianwu-geo] content script active on", location.href);
announceExtensionReady();
injectAPI();
