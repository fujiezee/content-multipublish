/** Browser bridge for 点物GEO 文章多平台同步助手 Chrome extension (dianwu.ai). */

import { toAbsoluteMediaUrl } from "@/lib/content/media-urls";
import type { PlatformId } from "@/lib/types";

export const DIANWU_GEO_PRODUCT_NAME = "点物 文章多平台同步助手";

export const PENDING_ARTICLE_STORAGE_KEY = "dianwu-geo-pending-article";

/** Platforms with draft API adapters in tools/dianwu-geo. */
export const EXTENSION_PLATFORM_IDS: readonly PlatformId[] = [
  "zhihu",
  "juejin",
  "toutiao",
  "weibo",
  "bilibili",
  "baijiahao",
  "csdn",
  "yuque",
  "douban",
  "sohu",
  "xueqiu",
  "weixin",
  "woshipm",
  "segmentfault",
  "cnblogs",
  "cto51",
  "imooc",
  "oschina",
  "eastmoney",
  "jianshu",
  "netease",
  "dayu",
  "sohufocus",
  "yidian",
  "smzdm",
  "x",
  "qiehao",
  "dafeng",
  "kuaichuan",
  "sinakandian",
  "dongfang",
  "btime",
  "peoplehao",
  "xinhuahao",
  "zhongqing",
  "tencentcloud",
  "aliyun",
  "huaweicloud",
  "xiaohongshu",
  "douyin",
  "shunqi",
  "shunqi_product",
  "bafang",
] as const;

export const EXTENSION_PLATFORM_ID_SET = new Set<PlatformId>(EXTENSION_PLATFORM_IDS);

export function isExtensionPlatform(id: PlatformId): boolean {
  return EXTENSION_PLATFORM_ID_SET.has(id);
}

/** 只走扩展，未装扩展也不再改走本机 Playwright。 */
export const EXTENSION_REQUIRED_IDS: readonly PlatformId[] = ["douyin", "weixin"];

export function isExtensionRequiredPlatform(id: PlatformId): boolean {
  return EXTENSION_REQUIRED_IDS.includes(id);
}

export type DianwuGeoFamilyVariant = {
  title?: string;
  content?: string;
  html?: string;
  markdown?: string;
  summary?: string;
  cover?: string;
  thumb?: string;
};

export type DianwuGeoArticle = {
  title: string;
  desc?: string;
  content: string;
  thumb?: string;
  cover?: string;
  /** Per platform-family bodies for popup multi-account sync. */
  familyVariants?: Record<string, DianwuGeoFamilyVariant>;
};

export type DianwuGeoOpenResult = {
  success?: boolean;
  mode?: string;
  error?: string;
  ok?: boolean;
};

export type DianwuGeoAccount = {
  type: string;
  title?: string;
  displayName?: string;
  icon?: string;
  avatar?: string;
  uid?: string;
  home?: string;
  supportTypes?: string[];
  status?: string;
  msg?: string;
  error?: string;
  editResp?: { draftLink?: string; url?: string } | null;
};

export type DianwuGeoTaskUpdate = {
  accounts: DianwuGeoAccount[];
};

export type DianwuGeoSyncResultEvent = {
  method?: string;
  platform?: string;
  success?: boolean;
  error?: string;
  postUrl?: string;
  url?: string;
  draftOnly?: boolean;
  awaitingUserPublish?: boolean;
  outcome?: string;
  message?: string;
};

export type DianwuGeoAddTaskResult = {
  success?: boolean;
  error?: string;
  results?: DianwuGeoSyncResultEvent[];
};

export type DianwuGeoSyncState = {
  status?: string;
  results?: DianwuGeoSyncResultEvent[];
  selectedPlatforms?: string[];
  /** Epoch ms when the extension started this sync (activeSyncState.startTime). */
  startTime?: number;
};

/** True when activeSyncState belongs to the platforms we are currently waiting on. */
export function syncStateMatchesPlatforms(
  state: DianwuGeoSyncState | null | undefined,
  platforms: readonly string[],
  opts?: { startedAt?: number },
): boolean {
  if (!state || !platforms.length) return false;

  const selected = state.selectedPlatforms;
  if (Array.isArray(selected) && selected.length > 0) {
    const selectedSet = new Set(
      selected.map((s) => String(s).toLowerCase()),
    );
    if (!platforms.every((p) => selectedSet.has(String(p).toLowerCase()))) {
      return false;
    }
  } else {
    // Legacy / incomplete state: require at least one overlapping result platform
    // so a previous sync's "completed" snapshot cannot finalize unrelated jobs.
    const results = state.results || [];
    const hit = platforms.some((p) =>
      results.some(
        (r) =>
          !!r.platform &&
          String(r.platform).toLowerCase() === String(p).toLowerCase(),
      ),
    );
    if (!hit) return false;
  }

  const startedAt = opts?.startedAt;
  if (
    typeof startedAt === "number" &&
    typeof state.startTime === "number" &&
    state.startTime + 1000 < startedAt
  ) {
    return false;
  }
  return true;
}

/** One entry from extension popup「同步历史」(chrome.storage.local.syncHistory). */
export type DianwuGeoSyncHistoryEntry = {
  id: string;
  title?: string;
  cover?: string;
  timestamp?: number;
  results?: DianwuGeoSyncResultEvent[];
};

const PLACEHOLDER_THUMB = "/geo-sync/article-placeholder.svg";
const EXTENSION_DIR = "tools/dianwu-geo";

type PageSyncer = {
  openSyncPage: (
    article: Record<string, unknown>,
    cb: (err: string | null, res?: DianwuGeoOpenResult) => void,
  ) => void;
  getAccounts?: (
    cb: (err: string | null, accounts?: DianwuGeoAccount[]) => void,
  ) => void;
  getSyncState?: (
    cb: (err: string | null, state?: DianwuGeoSyncState | null) => void,
  ) => void;
  getSyncHistory?: (
    cb: (err: string | null, history?: DianwuGeoSyncHistoryEntry[]) => void,
  ) => void;
  addTask?: (
    task: { post: Record<string, unknown>; accounts: DianwuGeoAccount[] },
    statusHandler: ((task: DianwuGeoTaskUpdate) => void) | null,
    cb?: (err: string | null, res?: DianwuGeoAddTaskResult) => void,
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
    __DWGEO_EXTENSION_VERSION__?: string;
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

export function getInstalledExtensionVersion(): string | null {
  if (typeof window === "undefined") return null;
  const fromWindow = window.__DWGEO_EXTENSION_VERSION__?.trim();
  if (fromWindow) return fromWindow;
  const fromDom = document.documentElement
    ?.getAttribute("data-dwgeo-extension-version")
    ?.trim();
  return fromDom || null;
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
  const version = document.documentElement
    ?.getAttribute("data-dwgeo-extension-version")
    ?.trim();
  if (version) window.__DWGEO_EXTENSION_VERSION__ = version;
}

function getExtensionRuntime(): ChromeRuntimeBridge | null {
  return window.chrome?.runtime ?? null;
}

function pageOrigin(): string {
  return typeof window !== "undefined"
    ? window.location.origin
    : "http://127.0.0.1:3000";
}

function toAbsoluteUrl(src: string): string {
  return toAbsoluteMediaUrl(src, pageOrigin());
}

/** Make local /api/uploads and relative media absolute so extension can fetch+reupload. */
function absolutizeContentMedia(html: string): string {
  const origin = pageOrigin();
  return html.replace(
    /(\s(?:src|href|poster)=["'])([^"']+)(["'])/gi,
    (full, pre: string, url: string, post: string) => {
      const s = url.trim();
      if (
        !s ||
        s.startsWith("data:") ||
        s.startsWith("blob:") ||
        s.startsWith("#")
      ) {
        return full;
      }
      return `${pre}${toAbsoluteMediaUrl(s, origin)}${post}`;
    },
  );
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
  const explicit = article.cover?.trim() || article.thumb?.trim();
  if (explicit) return toAbsoluteUrl(explicit);
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
  const content = absolutizeContentMedia(article.content || "<p></p>");
  const title = article.title.trim() || "未命名";
  const cover = resolveArticleCover({ ...article, content });
  let familyVariants:
    | Record<string, DianwuGeoFamilyVariant>
    | undefined;
  if (article.familyVariants && typeof article.familyVariants === "object") {
    familyVariants = {};
    for (const [key, value] of Object.entries(article.familyVariants)) {
      const html = absolutizeContentMedia(
        value.content || value.html || "",
      );
      familyVariants[key] = {
        ...value,
        content: html,
        html,
        cover: value.cover ? toAbsoluteUrl(value.cover) : undefined,
        thumb: value.thumb ? toAbsoluteUrl(value.thumb) : undefined,
      };
    }
  }
  return {
    title,
    desc: article.desc?.trim() || undefined,
    summary: article.desc?.trim() || undefined,
    content,
    html: content,
    thumb: cover,
    cover,
    ...(familyVariants ? { familyVariants } : {}),
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

/** Push family variants into extension storage (after panel open / async fetch). */
export async function pushDianwuGeoFamilyVariants(
  familyVariants: Record<string, DianwuGeoFamilyVariant> | undefined,
): Promise<void> {
  if (!familyVariants || typeof window === "undefined") return;
  const payload = { type: "SET_FAMILY_VARIANTS", familyVariants };

  try {
    dispatchBridgeRequest({
      method: "setFamilyVariants",
      familyVariants,
    });
  } catch {
    // ignore
  }

  if (window.__DWGEO_EXTENSION_ID__ && getExtensionRuntime()?.sendMessage) {
    try {
      await sendExternalExtensionMessage(payload);
    } catch {
      // ignore — bridge path may still land
    }
  }
}

function extensionMissingError() {
  return new Error(
    `未检测到${DIANWU_GEO_PRODUCT_NAME}。请下载扩展包，在 Chrome 打开 chrome://extensions，开启开发者模式后加载解压文件夹，再刷新本页。`,
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
        version?: string;
      };
      if (payload.method !== "dianwuGeoReady") return;
      window.__DWGEO_EXTENSION_INSTALLED__ = true;
      if (payload.extensionId) {
        window.__DWGEO_EXTENSION_ID__ = payload.extensionId;
      }
      if (payload.version) {
        window.__DWGEO_EXTENSION_VERSION__ = payload.version;
        document.documentElement?.setAttribute(
          "data-dwgeo-extension-version",
          payload.version,
        );
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
      "data-dwgeo-extension-version",
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
  options?: { acceptFailure?: boolean },
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
        if (
          !options?.acceptFailure &&
          result &&
          typeof result === "object" &&
          result.success === false
        ) {
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

function waitForBridgeResult<T>(eventID: number, timeoutMs = 15_000): Promise<T> {
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
    const onMessage = (evt: MessageEvent) => {
      if (typeof evt.data !== "string") return;
      const payload = parseBridgeMessage(evt.data);
      if (!payload?.callReturn || payload.eventID !== eventID) return;
      settle(() => resolve((payload.result ?? payload) as T));
    };
    window.addEventListener("message", onMessage);
  });
}

/** List accounts the extension sees as logged-in (Chrome cookies). */
export async function getDianwuGeoAccounts(
  timeoutMs = 3_000,
): Promise<DianwuGeoAccount[]> {
  if (typeof window === "undefined") return [];
  attachReadyListener();
  await waitForDianwuGeoExtension(1_500);

  if (window.$syncer?.getAccounts) {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => resolve([]), timeoutMs);
      try {
        window.$syncer!.getAccounts!((err, accounts) => {
          window.clearTimeout(timer);
          if (err) {
            resolve([]);
            return;
          }
          resolve(Array.isArray(accounts) ? accounts : []);
        });
      } catch {
        window.clearTimeout(timer);
        resolve([]);
      }
    });
  }

  try {
    const eventID = Math.floor(Date.now() + Math.random() * 100_000);
    const wait = waitForBridgeResult<DianwuGeoAccount[]>(eventID, timeoutMs);
    dispatchBridgeRequest({ method: "getAccounts", eventID });
    const result = await wait;
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

const ADD_TASK_TIMEOUT_MS = 3 * 60_000;

function normalizeAddTaskResults(res: unknown): DianwuGeoSyncResultEvent[] {
  if (!res || typeof res !== "object") return [];
  const results = (res as DianwuGeoAddTaskResult).results;
  return Array.isArray(results) ? results : [];
}

/**
 * Start extension draft sync for given accounts.
 * Resolves when the extension returns final results (or times out).
 * Progress also arrives via subscribeDianwuGeoTaskUpdates / statusHandler.
 */
export async function addDianwuGeoTask(
  task: {
    post: {
      title: string;
      content: string;
      markdown?: string;
      thumb?: string;
      cover?: string;
      desc?: string;
    };
    accounts: DianwuGeoAccount[];
  },
  statusHandler?: (update: DianwuGeoTaskUpdate) => void,
): Promise<DianwuGeoAddTaskResult> {
  if (typeof window === "undefined") {
    throw new Error("no window");
  }
  attachReadyListener();
  if (!(await waitForDianwuGeoExtension(3_000))) {
    throw extensionMissingError();
  }

  const cover = task.post.cover || task.post.thumb;
  const post = {
    title: task.post.title,
    content: task.post.content,
    html: task.post.content,
    markdown: task.post.markdown || "",
    thumb: cover,
    cover,
    desc: task.post.desc,
  };

  if (window.$syncer?.addTask) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        resolve({ success: true, results: [] });
      }, ADD_TASK_TIMEOUT_MS);
      try {
        window.$syncer!.addTask!(
          { post, accounts: task.accounts },
          (update) => statusHandler?.(update),
          (err, res) => {
            window.clearTimeout(timer);
            if (err) {
              reject(
                new Error(typeof err === "string" ? err : "扩展同步任务提交失败"),
              );
              return;
            }
            resolve({
              success: true,
              results: normalizeAddTaskResults(res),
            });
          },
        );
      } catch (err) {
        window.clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  const eventID = Math.floor(Date.now() + Math.random() * 100_000);
  const wait = waitForBridgeResult<DianwuGeoAddTaskResult>(
    eventID,
    ADD_TASK_TIMEOUT_MS,
  );
  dispatchBridgeRequest({
    method: "addTask",
    eventID,
    task: { post, accounts: task.accounts },
  });
  try {
    const result = await wait;
    if (result && typeof result === "object" && result.success === false) {
      throw new Error(result.error || "扩展同步失败");
    }
    return {
      success: true,
      results: normalizeAddTaskResults(result),
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("未响应")) {
      return { success: true, results: [] };
    }
    throw err;
  }
}

/** Listen for extension task progress (per-platform done/failed + draft links). */
export function subscribeDianwuGeoTaskUpdates(
  cb: (update: DianwuGeoTaskUpdate) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onMessage = (evt: MessageEvent) => {
    if (typeof evt.data !== "string") return;
    try {
      const payload = JSON.parse(evt.data) as {
        method?: string;
        task?: DianwuGeoTaskUpdate;
      };
      if (payload.method !== "taskUpdate" || !payload.task?.accounts) return;
      cb(payload.task);
    } catch {
      // ignore
    }
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

function isSyncStatePayload(value: unknown): value is DianwuGeoSyncState {
  if (!value || typeof value !== "object") return false;
  if ("callReturn" in value && !("results" in value) && !("status" in value)) {
    return false;
  }
  return "results" in value || "status" in value || "selectedPlatforms" in value;
}

/** Read active sync state from the extension (same source as the popup UI). */
export async function getDianwuGeoSyncState(
  timeoutMs = 4_000,
): Promise<DianwuGeoSyncState | null> {
  if (typeof window === "undefined") return null;
  attachReadyListener();

  if (window.$syncer?.getSyncState) {
    try {
      const viaSyncer = await new Promise<DianwuGeoSyncState | null>(
        (resolve) => {
          const timer = window.setTimeout(() => resolve(null), timeoutMs);
          try {
            window.$syncer!.getSyncState!((err, state) => {
              window.clearTimeout(timer);
              if (err) {
                resolve(null);
                return;
              }
              resolve(isSyncStatePayload(state) ? state : null);
            });
          } catch {
            window.clearTimeout(timer);
            resolve(null);
          }
        },
      );
      if (viaSyncer) return viaSyncer;
    } catch {
      // fall through
    }
  }

  try {
    const eventID = Math.floor(Date.now() + Math.random() * 100_000);
    const wait = waitForBridgeResult<DianwuGeoSyncState | null>(
      eventID,
      timeoutMs,
    );
    dispatchBridgeRequest({ method: "getSyncState", eventID });
    const result = await wait;
    if (isSyncStatePayload(result)) return result;
  } catch {
    // External messaging fallback
  }

  if (window.__DWGEO_EXTENSION_ID__ && getExtensionRuntime()?.sendMessage) {
    try {
      const resp = await sendExternalExtensionMessage<{
        syncState?: DianwuGeoSyncState;
      }>({ type: "GET_SYNC_STATE" }, timeoutMs);
      return resp?.syncState ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Read extension popup「同步历史」list. */
export async function getDianwuGeoSyncHistory(
  timeoutMs = 4_000,
): Promise<DianwuGeoSyncHistoryEntry[]> {
  if (typeof window === "undefined") return [];
  attachReadyListener();

  if (window.$syncer?.getSyncHistory) {
    try {
      const viaSyncer = await new Promise<DianwuGeoSyncHistoryEntry[] | null>(
        (resolve) => {
          const timer = window.setTimeout(() => resolve(null), timeoutMs);
          try {
            window.$syncer!.getSyncHistory!((err, history) => {
              window.clearTimeout(timer);
              if (err) {
                resolve(null);
                return;
              }
              resolve(Array.isArray(history) ? history : []);
            });
          } catch {
            window.clearTimeout(timer);
            resolve(null);
          }
        },
      );
      if (viaSyncer) return viaSyncer;
    } catch {
      // fall through
    }
  }

  try {
    const eventID = Math.floor(Date.now() + Math.random() * 100_000);
    const wait = waitForBridgeResult<DianwuGeoSyncHistoryEntry[]>(
      eventID,
      timeoutMs,
    );
    dispatchBridgeRequest({ method: "getSyncHistory", eventID });
    const result = await wait;
    if (Array.isArray(result)) return result;
  } catch {
    // External messaging fallback
  }

  if (window.__DWGEO_EXTENSION_ID__ && getExtensionRuntime()?.sendMessage) {
    try {
      const resp = await sendExternalExtensionMessage<{
        syncHistory?: DianwuGeoSyncHistoryEntry[];
      }>({ type: "GET_SYNC_HISTORY" }, timeoutMs);
      return Array.isArray(resp?.syncHistory) ? resp.syncHistory : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Per-platform result events from the content script. */
export function subscribeDianwuGeoSyncResults(
  cb: (result: DianwuGeoSyncResultEvent) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onMessage = (evt: MessageEvent) => {
    if (typeof evt.data !== "string") return;
    try {
      const payload = JSON.parse(evt.data) as DianwuGeoSyncResultEvent;
      if (payload.method !== "dianwuGeoSyncResult") return;
      if (!payload.platform) return;
      cb(payload);
    } catch {
      // ignore
    }
  };

  const onCustom = (evt: Event) => {
    const detail = (evt as CustomEvent).detail as DianwuGeoSyncResultEvent;
    if (!detail?.platform) return;
    cb(detail);
  };

  window.addEventListener("message", onMessage);
  document.addEventListener("dianwu-geo-sync-result", onCustom);
  return () => {
    window.removeEventListener("message", onMessage);
    document.removeEventListener("dianwu-geo-sync-result", onCustom);
  };
}

export function accountDraftUrl(account: DianwuGeoAccount): string | null {
  const link = account.editResp?.draftLink || account.editResp?.url;
  return link?.trim() || null;
}

export function isAccountTerminal(account: DianwuGeoAccount): boolean {
  const s = (account.status || "").toLowerCase();
  return s === "done" || s === "failed" || s === "error" || s === "success";
}

export function isAccountSuccess(account: DianwuGeoAccount): boolean {
  const s = (account.status || "").toLowerCase();
  return s === "done" || s === "success";
}

export type DianwuGeoVideoPublishResult = {
  success?: boolean;
  error?: string;
  postUrl?: string;
  url?: string;
  message?: string;
  awaitingUserPublish?: boolean;
  outcome?: string;
  platform?: string;
};

export async function publishDouyinVideoViaExtension(input: {
  videoUrl: string;
  title: string;
  description?: string;
}): Promise<DianwuGeoVideoPublishResult> {
  attachReadyListener();
  if (!(await waitForDianwuGeoExtension(3_000))) {
    throw extensionMissingError();
  }
  return sendExternalExtensionMessage<DianwuGeoVideoPublishResult>(
    {
      type: "PUBLISH_DOUYIN_VIDEO",
      videoUrl: input.videoUrl,
      title: input.title,
      description: input.description || "",
    },
    4 * 60_000,
    { acceptFailure: true },
  );
}

export type DianwuGeoMusicPublishResult = DianwuGeoVideoPublishResult;

export async function publishDouyinMusicViaExtension(input: {
  audioUrl: string;
  coverUrl?: string;
  title: string;
  lyrics?: string;
  platform?: "qishui" | "douyin";
}): Promise<DianwuGeoMusicPublishResult> {
  attachReadyListener();
  if (!(await waitForDianwuGeoExtension(3_000))) {
    throw extensionMissingError();
  }
  return sendExternalExtensionMessage<DianwuGeoMusicPublishResult>(
    {
      type: "PUBLISH_DOUYIN_MUSIC",
      audioUrl: input.audioUrl,
      coverUrl: input.coverUrl || "",
      title: input.title,
      lyrics: input.lyrics || "",
      platform: input.platform || "qishui",
    },
    4 * 60_000,
    { acceptFailure: true },
  );
}

export type DianwuGeoPodcastPublishResult = DianwuGeoVideoPublishResult;

export async function publishXiaoyuzhouPodcastViaExtension(input: {
  audioUrl: string;
  coverUrl?: string;
  title: string;
  shownotes?: string;
}): Promise<DianwuGeoPodcastPublishResult> {
  attachReadyListener();
  if (!(await waitForDianwuGeoExtension(3_000))) {
    throw extensionMissingError();
  }
  return sendExternalExtensionMessage<DianwuGeoPodcastPublishResult>(
    {
      type: "PUBLISH_XIAOYUZHOU_PODCAST",
      audioUrl: input.audioUrl,
      coverUrl: input.coverUrl || "",
      title: input.title,
      shownotes: input.shownotes || "",
    },
    4 * 60_000,
    { acceptFailure: true },
  );
}
