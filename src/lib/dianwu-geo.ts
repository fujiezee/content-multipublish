/** Browser bridge for 点物GEO 文章多平台同步助手 Chrome extension (dianwu.ai). */

export const DIANWU_GEO_PRODUCT_NAME = "点物GEO 文章多平台同步助手";

export const PENDING_ARTICLE_STORAGE_KEY = "dianwu-geo-pending-article";

export type DianwuGeoArticle = {
  title: string;
  desc?: string;
  content: string;
  thumb?: string;
};

export type DianwuGeoOpenResult = {
  success?: boolean;
  mode?: string;
  error?: string;
  ok?: boolean;
};

const PLACEHOLDER_THUMB = "/geo-sync/article-placeholder.svg";
const EXTENSION_DIR = "tools/dianwu-geo";

type PageSyncer = {
  openSyncPage: (
    article: Record<string, unknown>,
    cb: (err: string | null, res?: DianwuGeoOpenResult) => void,
  ) => void;
};

type ChromeRuntimeBridge = {
  sendMessage: (
    extensionId: string,
    message: unknown,
    callback: (response: unknown) => void,
  ) => void;
  lastError?: { message?: string };
};

declare global {
  interface Window {
    $syncer?: PageSyncer;
    __DWGEO_EXTENSION_INSTALLED__?: boolean;
    __DWGEO_EXTENSION_ID__?: string;
    chrome?: { runtime?: ChromeRuntimeBridge };
  }
}

let readyListenerAttached = false;

export function getExtensionIdFromDom(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return (
    document.documentElement?.getAttribute("data-dwgeo-extension-id")?.trim() ||
    undefined
  );
}

function syncExtensionGlobalsFromDom() {
  const domId = getExtensionIdFromDom();
  if (domId) {
    window.__DWGEO_EXTENSION_ID__ = domId;
    window.__DWGEO_EXTENSION_INSTALLED__ = true;
  }
  if (document.documentElement?.getAttribute("data-dwgeo-extension") === "1") {
    window.__DWGEO_EXTENSION_INSTALLED__ = true;
  }
}

function getExtensionRuntime(): ChromeRuntimeBridge | null {
  return window.chrome?.runtime ?? null;
}

function toAbsoluteUrl(src: string): string {
  if (src.startsWith("http://") || src.startsWith("https://")) return src;
  if (src.startsWith("//")) return `${window.location.protocol}${src}`;
  if (src.startsWith("/")) return `${window.location.origin}${src}`;
  return src;
}

function extractFirstImageUrl(html: string): string | undefined {
  if (typeof DOMParser === "undefined") return undefined;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const img = doc.querySelector("img[src]");
  const src = img?.getAttribute("src")?.trim();
  if (!src || src.startsWith("data:")) return undefined;
  return toAbsoluteUrl(src);
}

export function resolveArticleCover(article: DianwuGeoArticle): string | undefined {
  const thumb = article.thumb?.trim();
  if (thumb) return toAbsoluteUrl(thumb);
  const fromBody = extractFirstImageUrl(article.content);
  if (fromBody) return fromBody;
  return undefined;
}

/** @deprecated Use resolveArticleCover; placeholder only for legacy SDK dialog. */
export function resolveArticleThumb(article: DianwuGeoArticle): string {
  return (
    resolveArticleCover(article) ??
    `${typeof window !== "undefined" ? window.location.origin : ""}${PLACEHOLDER_THUMB}`
  );
}

function normalizeArticle(article: DianwuGeoArticle) {
  const content = article.content || "<p></p>";
  const title = article.title.trim() || "未命名";
  const cover = resolveArticleCover(article);
  return {
    title,
    desc: article.desc?.trim() || undefined,
    summary: article.desc?.trim() || undefined,
    content,
    html: content,
    thumb: cover,
    cover,
    source: {
      url: window.location.href,
      platform: "local-editor",
    },
  };
}

function stashPendingArticle(article: ReturnType<typeof normalizeArticle>) {
  const stamped = {
    ...article,
    _openedAt: Date.now(),
    source: {
      ...article.source,
      url: window.location.href,
    },
  };
  sessionStorage.setItem(PENDING_ARTICLE_STORAGE_KEY, JSON.stringify(stamped));
}

/** Cache article for the extension content script (call on pointerdown before click). */
export function stashArticleForDianwuGeo(article: DianwuGeoArticle) {
  const normalized = normalizeArticle(article);
  stashPendingArticle(normalized);
  return normalized;
}

function extensionMissingError() {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const originHint =
    host && host !== "localhost" && host !== "127.0.0.1"
      ? `当前地址为 ${window.location.origin}，请改用 http://localhost:3000 打开编辑器。`
      : "请用 http://localhost:3000 打开编辑器。";
  return new Error(
    `未检测到${DIANWU_GEO_PRODUCT_NAME}。请在 Chrome 开发者模式加载 ${EXTENSION_DIR} 并重新加载扩展后重试（${originHint}）`,
  );
}

function extensionNotRespondingError() {
  return new Error(
    `${DIANWU_GEO_PRODUCT_NAME}未响应。请在 chrome://extensions 重新加载扩展，并硬刷新本页（Cmd+Shift+R）后重试。`,
  );
}

export function isDianwuGeoExtensionPresent(): boolean {
  if (typeof window === "undefined") return false;
  syncExtensionGlobalsFromDom();
  return Boolean(
    window.__DWGEO_EXTENSION_INSTALLED__ ||
      window.$syncer?.openSyncPage ||
      window.__DWGEO_EXTENSION_ID__ ||
      getExtensionIdFromDom(),
  );
}

function attachReadyListener() {
  if (readyListenerAttached || typeof window === "undefined") return;
  readyListenerAttached = true;
  window.addEventListener("message", (evt) => {
    if (typeof evt.data !== "string") return;
    try {
      const payload = JSON.parse(evt.data) as {
        method?: string;
        extensionId?: string;
      };
      if (payload.method !== "dianwuGeoReady") return;
      window.__DWGEO_EXTENSION_INSTALLED__ = true;
      if (payload.extensionId) {
        window.__DWGEO_EXTENSION_ID__ = payload.extensionId;
      }
    } catch {
      // ignore
    }
  });
  const observer = new MutationObserver(() => {
    syncExtensionGlobalsFromDom();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      "data-dwgeo-extension",
      "data-dwgeo-extension-id",
      "data-dwgeo-inject-url",
    ],
  });
}

/** Wait briefly for content-script injection (inject-api.js loads async). */
export async function waitForDianwuGeoExtension(maxWaitMs = 4_000): Promise<boolean> {
  if (typeof window === "undefined") return false;
  attachReadyListener();
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (isDianwuGeoExtensionPresent()) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return isDianwuGeoExtensionPresent();
}

function sendExternalExtensionMessage<T>(
  message: Record<string, unknown>,
  timeoutMs = 6_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const extId = window.__DWGEO_EXTENSION_ID__;
    const runtime = getExtensionRuntime();
    if (!extId || !runtime?.sendMessage) {
      reject(new Error("external messaging unavailable"));
      return;
    }

    const timer = window.setTimeout(() => {
      reject(new Error("external messaging timeout"));
    }, timeoutMs);

    try {
      runtime.sendMessage(extId, message, (response) => {
        window.clearTimeout(timer);
        const err = runtime.lastError?.message;
        if (err) {
          reject(new Error(err));
          return;
        }
        const result = response as T & { success?: boolean; error?: string };
        if (result && typeof result === "object" && result.success === false) {
          reject(new Error(result.error || "打开扩展同步面板失败"));
          return;
        }
        resolve(response as T);
      });
    } catch (err) {
      window.clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function parseBridgeMessage(data: string) {
  try {
    return JSON.parse(data) as {
      callReturn?: boolean;
      eventID?: number;
      method?: string;
      result?: DianwuGeoOpenResult;
      success?: boolean;
      error?: string;
      mode?: string;
    };
  } catch {
    return null;
  }
}

function waitForExtensionBridge<T extends DianwuGeoOpenResult>(
  eventID: number,
  timeoutMs = 12_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      fn();
    };

    const timer = window.setTimeout(() => {
      settle(() => reject(extensionNotRespondingError()));
    }, timeoutMs);

    const handlePayload = (payload: ReturnType<typeof parseBridgeMessage>) => {
      if (!payload?.callReturn || payload.eventID !== eventID) return;
      const result = (payload.result ?? payload) as T & {
        success?: boolean;
        error?: string;
      };
      if (result && typeof result === "object" && result.success === false) {
        settle(() => reject(new Error(result.error || "打开扩展同步面板失败")));
        return;
      }
      settle(() => resolve(result as T));
    };

    const onMessage = (evt: MessageEvent) => {
      if (typeof evt.data !== "string") return;
      handlePayload(parseBridgeMessage(evt.data));
    };

    window.addEventListener("message", onMessage);
  });
}

function dispatchBridgeRequest(payload: Record<string, unknown>) {
  window.postMessage(JSON.stringify(payload), "*");
  try {
    document.documentElement.dispatchEvent(
      new CustomEvent("dianwu-geo-bridge-request", {
        bubbles: true,
        detail: payload,
      }),
    );
  } catch {
    // ignore
  }
}

function openViaSyncer(article: ReturnType<typeof normalizeArticle>): Promise<DianwuGeoOpenResult> {
  return new Promise((resolve, reject) => {
    const syncer = window.$syncer;
    if (!syncer?.openSyncPage) {
      reject(new Error("syncer unavailable"));
      return;
    }
    const timer = window.setTimeout(() => {
      reject(extensionNotRespondingError());
    }, 12_000);
    syncer.openSyncPage(article, (err, res) => {
      window.clearTimeout(timer);
      if (err) {
        reject(new Error(typeof err === "string" ? err : "打开扩展同步面板失败"));
        return;
      }
      resolve(res ?? { success: true });
    });
  });
}

function openViaPostMessage(
  article: ReturnType<typeof normalizeArticle>,
): { eventID: number; wait: Promise<DianwuGeoOpenResult> } {
  const eventID = Math.floor(Date.now() + Math.random() * 100_000);
  const wait = waitForExtensionBridge<DianwuGeoOpenResult>(eventID);
  dispatchBridgeRequest({
    method: "openSyncPage",
    eventID,
    article,
    preferToolbarPopup: true,
  });
  return { eventID, wait };
}

async function openDianwuGeoPanel(
  article: ReturnType<typeof normalizeArticle>,
): Promise<DianwuGeoOpenResult> {
  attachReadyListener();

  if (window.$syncer?.openSyncPage) {
    try {
      return await openViaSyncer(article);
    } catch (err) {
      console.warn("[dianwu-geo] $syncer path failed:", err);
    }
  }

  try {
    const { wait } = openViaPostMessage(article);
    return await wait;
  } catch (err) {
    console.warn("[dianwu-geo] postMessage path failed:", err);
  }

  if (window.__DWGEO_EXTENSION_ID__ && getExtensionRuntime()?.sendMessage) {
    try {
      return await sendExternalExtensionMessage<DianwuGeoOpenResult>({
        type: "OPEN_ACTION_POPUP",
        pendingArticle: article,
        preferToolbarPopup: true,
      });
    } catch (err) {
      console.warn("[dianwu-geo] external messaging failed:", err);
    }
  }

  if (!isDianwuGeoExtensionPresent()) {
    throw extensionMissingError();
  }
  throw extensionNotRespondingError();
}

/**
 * Attach listeners then open extension — call on pointerdown to keep user gesture.
 */
export function beginOpenDianwuGeoPanel(article: DianwuGeoArticle) {
  const normalized = normalizeArticle(article);
  stashPendingArticle(normalized);
  attachReadyListener();
  const wait = openDianwuGeoPanel(normalized);
  return { eventID: 0, wait };
}

/** Open the Chrome extension sync panel with the current article. */
export async function syncWithDianwuGeo(article: DianwuGeoArticle) {
  if (typeof window === "undefined") return { success: false as const, error: "no window" };
  const { wait } = beginOpenDianwuGeoPanel(article);
  return wait;
}

/** Quick check that the extension content script is injected. */
export async function pingDianwuGeoExtension(timeoutMs = 1_500): Promise<boolean> {
  if (typeof window === "undefined") return false;
  attachReadyListener();

  if (await waitForDianwuGeoExtension(Math.min(timeoutMs, 2_000))) {
    return true;
  }

  if (window.$syncer) return true;

  try {
    const eventID = Math.floor(Date.now() + Math.random() * 100_000);
    const wait = waitForExtensionBridge<{ ok?: boolean }>(eventID, timeoutMs);
    dispatchBridgeRequest({ method: "ping", eventID });
    await wait;
    return true;
  } catch {
    // fall through
  }

  if (window.__DWGEO_EXTENSION_ID__ && getExtensionRuntime()?.sendMessage) {
    try {
      await sendExternalExtensionMessage<{ ok?: boolean }>({ type: "PING" }, timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

export function formatDianwuGeoOpenMessage(result?: DianwuGeoOpenResult): string {
  if (result?.mode === "action_popup") {
    return `已展开${DIANWU_GEO_PRODUCT_NAME}（浏览器工具栏下拉）。请在面板中勾选平台并同步。`;
  }
  if (result?.mode === "popup_window") {
    return `已打开${DIANWU_GEO_PRODUCT_NAME}同步窗口（右上角）。请在窗口中勾选平台并同步。`;
  }
  if (result?.success) {
    return `已打开${DIANWU_GEO_PRODUCT_NAME}。请在面板中勾选平台并同步。`;
  }
  return `已请求打开${DIANWU_GEO_PRODUCT_NAME}。若未看到窗口，请重新加载扩展后重试。`;
}
