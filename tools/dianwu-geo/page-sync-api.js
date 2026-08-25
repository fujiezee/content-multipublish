/**
 * Injects window.$syncer for local editor / dianwu.ai pages (article-syncjs SDK).
 * Based on Wechatsync v2 content/api.ts — talks to extension via postMessage bridge.
 */

const PRODUCT_TITLE = "点物GEO 文章多平台同步助手";
const PENDING_ARTICLE_STORAGE_KEY = "dianwu-geo-pending-article";
const CONTEXT_DEAD =
  "扩展已更新，请刷新本页后再同步（重新加载扩展后必须刷新编辑器页）";

function extensionAlive() {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime) return false;
    void chrome.runtime.id;
    return typeof chrome.runtime.sendMessage === "function";
  } catch {
    return false;
  }
}

function isContextDeadError(err) {
  const msg = err instanceof Error ? err.message : String(err || "");
  return /Extension context invalidated|context invalidated/i.test(msg);
}

function deadBridgeResult(method) {
  if (method === "getAccounts" || method === "getSyncHistory") return [];
  if (method === "getSyncState") return null;
  return { success: false, error: CONTEXT_DEAD };
}

function replyDead(action) {
  if (action?.eventID == null) return;
  try {
    sendToWindow({
      eventID: action.eventID,
      result: deadBridgeResult(action.method),
    });
  } catch {
    // ignore
  }
}

/** Run chrome.* without throwing after the extension was reloaded. */
function safeChromeCall(fn, onDead) {
  try {
    fn();
  } catch (err) {
    if (isContextDeadError(err)) {
      onDead?.();
      return;
    }
    throw err;
  }
}

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
  // Content-script postMessage reaches page listeners; do NOT inject inline
  // <script> — localhost CSP blocks unsafe-inline.
  window.postMessage(JSON.stringify(msg), "*");
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
  const rawHtml =
    bodyEl?.innerHTML?.trim() || pending?.content || pending?.html || "";
  if (!articleTitle || !rawHtml) return null;

  const origin = window.location.origin;
  const html = rawHtml.replace(
    /(\s(?:src|href|poster)=["'])([^"']+)(["'])/gi,
    (full, pre, url, post) => {
      const s = String(url || "").trim();
      if (
        !s ||
        s.startsWith("data:") ||
        s.startsWith("blob:") ||
        s.startsWith("#") ||
        /^https?:\/\//i.test(s)
      ) {
        return full;
      }
      if (s.startsWith("//")) return `${pre}${window.location.protocol}${s}${post}`;
      if (s.startsWith("/")) return `${pre}${origin}${s}${post}`;
      return `${pre}${origin}/${s.replace(/^\.\//, "")}${post}`;
    },
  );

  const coverFromAttr = coverEl?.getAttribute("data-dwgeo-article-cover")?.trim();
  let cover = coverFromAttr || undefined;
  if (cover?.startsWith("/")) {
    cover = `${origin}${cover}`;
  }
  if (!cover) {
    const firstImg = bodyEl?.querySelector("img[src]");
    const src = firstImg?.getAttribute("src")?.trim();
    if (src && !src.startsWith("data:") && !src.includes("article-placeholder")) {
      cover = src.startsWith("/")
        ? `${origin}${src}`
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
  account.error = result.success ? undefined : result.error;
  account.msg = result.success
    ? result.message || (result.awaitingUserPublish ? "已填入，请确认后点发布" : undefined)
    : undefined;
  account.editResp = result.success
    ? { draftLink: result.postUrl || result.url }
    : null;
}

function notifyAccountResult(result) {
  if (!result?.platform) return;
  notifyPageSyncResult({
    platform: result.platform,
    success: !!result.success,
    error: result.error,
    postUrl: result.postUrl || result.url,
    url: result.url || result.postUrl,
    draftOnly: result.draftOnly,
    awaitingUserPublish: result.awaitingUserPublish,
    outcome: result.outcome,
    message: result.message,
  });
}

/**
 * Apply sync results to currentAccounts and notify the page.
 * SW broadcasts SYNC_PROGRESS via runtime.sendMessage (not received by content
 * scripts); final SYNC_ARTICLE response + storage activeSyncState are reliable.
 */
function applySyncResults(results, { finalize = false } = {}) {
  const list = Array.isArray(results) ? results : [];
  for (const result of list) {
    updateAccountFromResult(result);
    notifyAccountResult(result);
  }
  if (finalize) {
    for (const acc of currentAccounts) {
      if (acc.status === "uploading") {
        acc.status = "failed";
        acc.error = acc.error || "未收到同步结果";
        notifyAccountResult({
          platform: acc.type,
          success: false,
          error: acc.error,
        });
      }
    }
  }
  sendTaskUpdate({ accounts: currentAccounts });
}

function failAllAccounts(error) {
  const msg = error || "扩展同步失败";
  for (const acc of currentAccounts) {
    acc.status = "failed";
    acc.error = msg;
    acc.msg = undefined;
    notifyAccountResult({
      platform: acc.type,
      success: false,
      error: msg,
    });
  }
  sendTaskUpdate({ accounts: currentAccounts });
}

// Progressive updates via storage (SYNC_PROGRESS does not reach content scripts)
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    try {
      if (!extensionAlive()) return;
      if (area !== "local" || !changes.activeSyncState) return;
      const state = changes.activeSyncState.newValue;
      if (!state || !Array.isArray(state.results)) return;

      if (currentSyncId || currentAccounts.length) {
        applySyncResults(state.results, {
          finalize: state.status === "completed",
        });
      } else if (state.status === "completed" && state.results.length) {
        for (const result of state.results) {
          notifyAccountResult(result);
        }
      }

      if (state.status === "completed") {
        currentSyncId = null;
      }
    } catch (err) {
      if (!isContextDeadError(err)) {
        console.warn("[dianwu-geo] storage listener:", err);
      }
    }
  });
} catch (err) {
  if (!isContextDeadError(err)) {
    console.warn("[dianwu-geo] storage listener bind:", err);
  }
}

function buildPendingArticle(post) {
  const htmlContent = post.content || post.html || "";
  const articleTitle = resolveSyncTitle(post);
  if (!articleTitle) return null;

  const cover = pickArticleCover(post);
  const familyVariants =
    post.familyVariants && typeof post.familyVariants === "object"
      ? post.familyVariants
      : undefined;

  return {
    title: articleTitle,
    content: htmlContent,
    html: htmlContent,
    markdown: post.markdown || "",
    summary: post.desc || post.summary || undefined,
    ...(cover ? { cover } : {}),
    ...(familyVariants ? { familyVariants } : {}),
    source: post.source || {
      url: window.location.href,
      platform: "local-editor",
    },
  };
}

function pickArticleCover(post) {
  const raw =
    post.cover ||
    post.thumb ||
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
  // postMessage is enough for the editor page; avoid inline script (CSP).
  window.postMessage(JSON.stringify(payload), "*");
  try {
    document.dispatchEvent(
      new CustomEvent("dianwu-geo-sync-result", { detail: payload }),
    );
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
    const familyVariants =
      stamped.familyVariants && typeof stamped.familyVariants === "object"
        ? stamped.familyVariants
        : {};
    if (extensionAlive()) {
      chrome.storage.local.remove("activeSyncState", () => {
        if (!extensionAlive()) return;
        chrome.storage.local.set(
          {
            pendingArticle: stamped,
            dwgeoFamilyVariants: familyVariants,
          },
          () => {
            if (chrome.runtime.lastError) {
              console.warn(
                "[dianwu-geo] stash pendingArticle:",
                chrome.runtime.lastError,
              );
            }
          },
        );
      });
    }
  } catch (err) {
    if (!isContextDeadError(err)) {
      console.warn("[dianwu-geo] stash pendingArticle failed:", err);
    }
  }

  if (!extensionAlive()) {
    finish({ success: false, error: CONTEXT_DEAD });
    return;
  }

  try {
    chrome.runtime.sendMessage(
      {
        type: "OPEN_ACTION_POPUP",
        pendingArticle: stamped,
        preferToolbarPopup: options?.preferToolbarPopup !== false,
      },
      (resp) => {
        try {
          const runtimeError = chrome.runtime.lastError?.message;
          if (runtimeError) {
            finish({
              success: false,
              error: isContextDeadError(runtimeError)
                ? CONTEXT_DEAD
                : runtimeError,
            });
            return;
          }
          if (!resp?.success) {
            finish(
              resp || { success: false, error: "无法打开同步面板，请重新加载扩展" },
            );
            return;
          }
          finish(resp);
        } catch (err) {
          finish({
            success: false,
            error: isContextDeadError(err) ? CONTEXT_DEAD : String(err),
          });
        }
      },
    );
  } catch (err) {
    finish({
      success: false,
      error: isContextDeadError(err) ? CONTEXT_DEAD : String(err),
    });
  }
}

function mergeManualSyncSource(fromDom, fromSession) {
  if (!fromDom && !fromSession) return null;
  if (!fromDom) return fromSession;
  if (!fromSession) return fromDom;

  const sessionHtml = fromSession.html || fromSession.content;
  const domHtml = fromDom.html || fromDom.content;
  const useSessionBody = Boolean(
    fromSession._openedAt && sessionHtml?.trim(),
  );
  const html = useSessionBody
    ? sessionHtml
    : domHtml || sessionHtml;
  const content = useSessionBody
    ? fromSession.content || fromSession.html
    : fromDom.content || fromDom.html || fromSession.content || fromSession.html;

  return {
    ...fromSession,
    ...fromDom,
    title: fromDom.title || fromSession.title,
    html,
    content,
    summary: fromDom.summary || fromDom.desc || fromSession.summary || fromSession.desc,
    desc: fromDom.desc || fromDom.summary || fromSession.desc || fromSession.summary,
    cover: fromSession.cover || fromDom.cover,
    thumb: fromSession.thumb || fromSession.cover || fromDom.thumb || fromDom.cover,
    familyVariants:
      fromSession.familyVariants || fromDom.familyVariants || undefined,
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

try {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (!extensionAlive()) return;
      if (message.type === "EXTRACT_ARTICLE") {
        const article = extractLocalEditorArticle();
        if (article) {
          sendResponse({ article });
          return true;
        }
        return;
      }

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
          notifyPageSyncResult({
            platform: result.platform,
            success: !!result.success,
            error: result.error,
            postUrl: result.postUrl || result.url,
            url: result.url || result.postUrl,
            draftOnly: result.draftOnly,
            awaitingUserPublish: result.awaitingUserPublish,
            outcome: result.outcome,
            message: result.message,
          });
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
        const results =
          message.results ||
          message.payload?.results ||
          message.payload?.data?.results;
        if (Array.isArray(results) && results.length) {
          applySyncResults(results, { finalize: true });
          currentSyncId = null;
        } else {
          safeChromeCall(() => {
            chrome.storage.local.get("activeSyncState", (data) => {
              try {
                if (!extensionAlive()) return;
                const state = data?.activeSyncState;
                if (state?.results?.length) {
                  applySyncResults(state.results, { finalize: true });
                }
                currentSyncId = null;
              } catch (err) {
                if (!isContextDeadError(err)) throw err;
              }
            });
          });
        }
      }
    } catch (e) {
      if (!isContextDeadError(e)) {
        console.error("[dianwu-geo] page bridge message error:", e);
      }
    }
  });
} catch (err) {
  if (!isContextDeadError(err)) {
    console.warn("[dianwu-geo] onMessage bind:", err);
  }
}

window.addEventListener("message", (evt) => {
  try {
    if (typeof evt.data !== "string") return;
    const action = JSON.parse(evt.data);
    routeBridgeAction(action);
  } catch (err) {
    if (!isContextDeadError(err)) return;
  }
});

function routeBridgeAction(action) {
  try {
    routeBridgeActionInner(action);
  } catch (err) {
    if (isContextDeadError(err)) {
      replyDead(action);
      return;
    }
    console.warn("[dianwu-geo] routeBridgeAction:", err);
  }
}

function routeBridgeActionInner(action) {
  if (!action || typeof action !== "object") return;
  if (!shouldHandleBridgeAction(action)) return;

  if (action.method === "dianwu-geo-request-sync") {
    handleManualSyncRequest();
    return;
  }
  if (!action.method) return;

  if (!extensionAlive()) {
    if (action.eventID != null) {
      sendToWindow({
        eventID: action.eventID,
        result:
          action.method === "getAccounts" ||
          action.method === "getSyncHistory"
            ? []
            : action.method === "getSyncState"
              ? null
              : { success: false, error: CONTEXT_DEAD },
      });
    }
    return;
  }

  if (action.method === "getAccounts") {
    safeChromeCall(
      () => {
        chrome.runtime.sendMessage({ type: "CHECK_ALL_AUTH" }, (resp) => {
          try {
            if (chrome.runtime.lastError) {
              sendToWindow({ eventID: action.eventID, result: [] });
              return;
            }
            const accounts = (resp?.platforms || [])
              .filter((p) => p.isAuthenticated)
              .map(mapPlatformToAccount);
            sendToWindow({ eventID: action.eventID, result: accounts });
          } catch (err) {
            if (isContextDeadError(err)) {
              replyDead(action);
              return;
            }
            throw err;
          }
        });
      },
      () => replyDead(action),
    );
    return;
  }

  if (action.method === "ping") {
    sendToWindow({ eventID: action.eventID, result: { ok: true } });
    return;
  }

  if (action.method === "setFamilyVariants") {
    const familyVariants =
      action.familyVariants && typeof action.familyVariants === "object"
        ? action.familyVariants
        : {};
    safeChromeCall(
      () => {
        chrome.runtime.sendMessage(
          { type: "SET_FAMILY_VARIANTS", familyVariants },
          () => {
            try {
              if (chrome.runtime.lastError) {
                console.warn(
                  "[dianwu-geo] setFamilyVariants:",
                  chrome.runtime.lastError.message,
                );
              }
              if (action.eventID != null) {
                sendToWindow({
                  eventID: action.eventID,
                  result: { success: true },
                });
              }
            } catch (err) {
              if (isContextDeadError(err)) {
                replyDead(action);
                return;
              }
              throw err;
            }
          },
        );
      },
      () => replyDead(action),
    );
    return;
  }

  if (action.method === "getSyncState") {
    // Same source as the popup "同步完成" UI — read storage directly.
    safeChromeCall(
      () => {
        chrome.storage.local.get("activeSyncState", (data) => {
          try {
            if (!extensionAlive()) {
              sendToWindow({ eventID: action.eventID, result: null });
              return;
            }
            sendToWindow({
              eventID: action.eventID,
              result: data?.activeSyncState || null,
            });
          } catch (err) {
            if (!isContextDeadError(err)) throw err;
            sendToWindow({ eventID: action.eventID, result: null });
          }
        });
      },
      () => sendToWindow({ eventID: action.eventID, result: null }),
    );
    return;
  }

  if (action.method === "getSyncHistory") {
    safeChromeCall(
      () => {
        chrome.storage.local.get("syncHistory", (data) => {
          try {
            sendToWindow({
              eventID: action.eventID,
              result: Array.isArray(data?.syncHistory) ? data.syncHistory : [],
            });
          } catch (err) {
            if (!isContextDeadError(err)) throw err;
            sendToWindow({ eventID: action.eventID, result: [] });
          }
        });
      },
      () => sendToWindow({ eventID: action.eventID, result: [] }),
    );
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
    const eventID = action.eventID;

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
      failAllAccounts("缺少文章标题");
      if (eventID != null) {
        sendToWindow({
          eventID,
          result: { success: false, error: "缺少文章标题" },
        });
      }
      return;
    }

    const syncPayload = {
      type: "SYNC_ARTICLE",
      payload: {
        article: {
          title: articleTitle,
          content: htmlContent,
          html: htmlContent,
          markdown: post.markdown || "",
          cover: post.cover || post.thumb,
          thumb: post.cover || post.thumb,
        },
        platforms,
        skipHistory: true,
        source: "legacy-api",
        syncId: currentSyncId,
      },
    };

    const finish = (results, error) => {
      if (error) {
        failAllAccounts(error);
        if (eventID != null) {
          sendToWindow({
            eventID,
            result: { success: false, error },
          });
        }
      } else {
        applySyncResults(results || [], { finalize: true });
        if (eventID != null) {
          sendToWindow({
            eventID,
            result: { success: true, results: results || [] },
          });
        }
      }
      currentSyncId = null;
    };

    const stateMatchesCurrent = (state) => {
      if (!state) return false;
      const selected = state.selectedPlatforms;
      if (Array.isArray(selected) && selected.length) {
        const set = new Set(selected.map((s) => String(s).toLowerCase()));
        return platforms.every((p) => set.has(String(p).toLowerCase()));
      }
      const results = state.results || [];
      return platforms.some((p) =>
        results.some(
          (r) =>
            r?.platform &&
            String(r.platform).toLowerCase() === String(p).toLowerCase(),
        ),
      );
    };

    const readMatchingResults = (onMiss) => {
      safeChromeCall(
        () => {
          chrome.storage.local.get("activeSyncState", (data) => {
            try {
              const state = data?.activeSyncState;
              if (stateMatchesCurrent(state) && state?.results?.length) {
                finish(state.results);
              } else {
                onMiss();
              }
            } catch (err) {
              if (isContextDeadError(err)) {
                finish([], CONTEXT_DEAD);
                return;
              }
              throw err;
            }
          });
        },
        () => finish([], CONTEXT_DEAD),
      );
    };

    // Drop stale "completed" snapshot so the editor poll cannot finalize the
    // wrong platforms before SYNC_ARTICLE writes the new syncing state.
    safeChromeCall(
      () => {
        chrome.storage.local.remove("activeSyncState", () => {
          try {
            chrome.runtime.sendMessage(syncPayload, (resp) => {
              try {
                if (chrome.runtime.lastError) {
                  const err = chrome.runtime.lastError.message || "扩展同步失败";
                  const dead = isContextDeadError(err);
                  if (!dead) console.error("[dianwu-geo] addTask:", err);
                  readMatchingResults(() =>
                    finish([], dead ? CONTEXT_DEAD : err),
                  );
                  return;
                }
                if (resp?.error) {
                  readMatchingResults(() => finish([], String(resp.error)));
                  return;
                }

                const fromResp = resp?.results;
                if (Array.isArray(fromResp) && fromResp.length) {
                  finish(fromResp);
                  return;
                }
                readMatchingResults(() => finish([]));
              } catch (err) {
                if (isContextDeadError(err)) {
                  finish([], CONTEXT_DEAD);
                  return;
                }
                throw err;
              }
            });
          } catch (err) {
            if (isContextDeadError(err)) {
              finish([], CONTEXT_DEAD);
              return;
            }
            throw err;
          }
        });
      },
      () => finish([], CONTEXT_DEAD),
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
    try {
      const detail = event.detail;
      if (!detail || typeof detail !== "object") return;
      routeBridgeAction(detail);
    } catch (err) {
      if (!isContextDeadError(err)) {
        console.warn("[dianwu-geo] bridge-request:", err);
      }
    }
  },
  true,
);

function extensionVersion() {
  try {
    return chrome.runtime.getManifest().version || "";
  } catch {
    return "";
  }
}

function announceExtensionReady() {
  try {
    if (!extensionAlive()) return;
    sendToWindow({
      method: "dianwuGeoReady",
      extensionId: chrome.runtime.id,
      version: extensionVersion(),
      result: { ok: true },
    });
  } catch (err) {
    if (!isContextDeadError(err)) {
      console.warn("[dianwu-geo] announce ready failed:", err);
    }
  }
}

function markExtensionOnDom(extensionId, injectUrl) {
  const root = document.documentElement;
  if (!root) return;
  const version = extensionVersion();
  root.setAttribute("data-dwgeo-extension", "1");
  root.setAttribute("data-dwgeo-extension-id", extensionId);
  root.setAttribute("data-dwgeo-inject-url", injectUrl);
  if (version) root.setAttribute("data-dwgeo-extension-version", version);
  try {
    document.dispatchEvent(
      new CustomEvent("dianwu-geo-init", {
        detail: { extensionId, injectUrl, version },
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
  if (!extensionAlive()) return;
  try {
    const extensionId = chrome.runtime.id;
    const injectUrl = chrome.runtime.getURL("inject-api.js");
    markExtensionOnDom(extensionId, injectUrl);

    chrome.runtime.sendMessage({ type: "INJECT_PAGE_BRIDGE" }, (resp) => {
      try {
        if (!extensionAlive() || chrome.runtime.lastError || !resp?.success) {
          injectViaScriptTag(injectUrl);
          return;
        }
        announceExtensionReady();
      } catch (err) {
        if (!isContextDeadError(err)) {
          console.warn("[dianwu-geo] inject callback:", err);
        }
        injectViaScriptTag(injectUrl);
      }
    });
  } catch (err) {
    if (!isContextDeadError(err)) {
      console.warn("[dianwu-geo] injectAPI:", err);
    }
  }
}

console.info("[dianwu-geo] content script active on", location.href);
announceExtensionReady();
injectAPI();
