import fs from "fs";
import os from "os";
import path from "path";
import type { BrowserContext, Page } from "playwright";
import { captureDebugScreenshot } from "@/lib/publishers/browser";
import {
  cookiesHaveDouyinSession,
  readDouyinCookies,
} from "@/lib/publishers/douyin";
import { UPLOADS_DIR } from "@/lib/paths";
import type { PublishResult } from "@/lib/types";

/** Bare upload hub. Query params like enter_from / default-tab remount the micro-app. */
const VIDEO_UPLOAD = "https://creator.douyin.com/creator-micro/content/upload";

function openPages(context: BrowserContext): Page[] {
  return context.pages().filter((row) => !row.isClosed());
}

function pickLivePage(context: BrowserContext, preferred?: Page): Page | undefined {
  const open = openPages(context);
  if (preferred && !preferred.isClosed() && /creator\.douyin\.com/i.test(preferred.url())) {
    return preferred;
  }
  const creator = open.filter((row) => /creator\.douyin\.com/i.test(row.url()));
  if (creator.length > 0) return creator.at(-1);
  if (preferred && !preferred.isClosed()) return preferred;
  return open.at(-1);
}

/** Douyin often window.opens /post/video; keep one tab so we don't flash-close the hub. */
async function stayOnOneCreatorTab(context: BrowserContext) {
  await context.addInitScript(() => {
    const raw = window.open.bind(window);
    window.open = (url?: string | URL, target?: string, features?: string) => {
      const href = typeof url === "string" ? url : url ? String(url) : "";
      if (
        href &&
        /creator\.douyin\.com/i.test(href) &&
        /creator-micro\/content\/(upload|post\/video|publish)/i.test(href)
      ) {
        window.location.assign(href);
        return window;
      }
      return raw(url as string, target, features);
    };
    document.addEventListener(
      "click",
      (event) => {
        const node = event.target as Element | null;
        const link = node?.closest?.('a[target="_blank"]');
        if (!link) return;
        const href = link.getAttribute("href") || "";
        if (!/creator-micro\/content\/(upload|post\/video|publish)/i.test(href)) return;
        event.preventDefault();
        window.location.assign((link as HTMLAnchorElement).href);
      },
      true,
    );
  });
}

async function adoptLivePage(context: BrowserContext, preferred?: Page): Promise<Page> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const live = pickLivePage(context, preferred);
    if (live && /creator\.douyin\.com/i.test(live.url())) return live;
    if (live && preferred && live !== preferred) return live;
    await new Promise((r) => setTimeout(r, 250));
  }
  const live = pickLivePage(context, preferred);
  if (!live) throw new Error("抖音窗口已关闭");
  return live;
}

async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (/passport|sso\.|\/login\b|account\/login|scan\/login/i.test(url)) {
    return false;
  }
  if (!cookiesHaveDouyinSession(await readDouyinCookies(page))) return false;
  const login = page.getByText(/扫码登录|请使用抖音APP扫码|打开抖音扫一扫/);
  if (await login.first().isVisible().catch(() => false)) return false;
  return true;
}

export function resolveLocalVideoFile(url: string): string | null {
  const raw = url.trim();
  const named = raw.match(/\/api\/uploads\/([^/?#]+)/i);
  if (named) {
    const name = decodeURIComponent(named[1]);
    if (name && !name.includes("..") && !name.includes("/")) {
      const file = path.join(UPLOADS_DIR, name);
      if (fs.existsSync(file)) return file;
    }
  }
  const uuid = raw.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.mp4/i,
  );
  if (uuid) {
    const file = path.join(UPLOADS_DIR, `${uuid[1]}.mp4`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

export async function materializeVideoFile(url: string): Promise<string> {
  const local = resolveLocalVideoFile(url);
  if (local) return local;
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("找不到成片文件，先确认这集已经合成");
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`下载成片失败 ${res.status}`);
  const dest = path.join(os.tmpdir(), `dw-dy-${Date.now()}.mp4`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function pickVideoFileInput(page: Page) {
  const inputs = page.locator('input[type="file"]');
  const n = await inputs.count();
  let fallback = -1;
  for (let i = 0; i < n; i += 1) {
    const accept = (
      (await inputs.nth(i).getAttribute("accept")) || ""
    ).toLowerCase();
    if (/video\/|\.mp4|\.mov|\.webm/i.test(accept)) return inputs.nth(i);
    if (/image\//i.test(accept)) continue;
    if (fallback < 0) fallback = i;
  }
  if (fallback >= 0) return inputs.nth(fallback);
  return n > 0 ? inputs.first() : null;
}

const TITLE_SEL = [
  'input[placeholder*="填写作品标题"]',
  'input[placeholder*="作品标题"]',
  'input[placeholder*="添加作品标题"]',
  'textarea[placeholder*="作品标题"]',
].join(", ");

const INTRO_SEL = [
  'textarea[placeholder*="作品简介"]',
  'textarea[placeholder*="添加作品简介"]',
  'textarea[placeholder*="填写作品简介"]',
  '[contenteditable="true"][data-placeholder*="简介"]',
  '[contenteditable="true"][placeholder*="简介"]',
  '[data-placeholder="添加作品简介"]',
  '[placeholder="添加作品简介"]',
].join(", ");

function isVideoPublishForm(url: string): boolean {
  return /creator-micro\/content\/post\/video|creator-micro\/content\/publish/i.test(
    url,
  );
}

function isUploadHub(url: string): boolean {
  return /creator-micro\/content\/upload/i.test(url);
}

async function hasTitleField(page: Page): Promise<boolean> {
  return page
    .locator(TITLE_SEL)
    .first()
    .isVisible()
    .catch(() => false);
}

async function closeBlankPages(context: BrowserContext, keep: Page) {
  for (const extra of openPages(context)) {
    if (extra === keep) continue;
    const url = extra.url();
    if (!url || url === "about:blank" || url.startsWith("chrome://")) {
      await extra.close().catch(() => undefined);
    }
  }
}

async function openVideoUpload(page: Page): Promise<Page> {
  const context = page.context();
  const already = openPages(context).find(
    (row) => isVideoPublishForm(row.url()) || isUploadHub(row.url()),
  );
  if (already && (isVideoPublishForm(already.url()) || (await hasTitleField(already)))) {
    await closeBlankPages(context, already);
    return already;
  }
  if (!already || !isUploadHub(already.url())) {
    await page
      .goto(VIDEO_UPLOAD, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      })
      .catch(() => undefined);
  }
  const live = (await adoptLivePage(context, already || page).catch(() => page)) ?? page;
  if (/passport|\/login/i.test(live.url())) return live;
  if (isVideoPublishForm(live.url()) || (await hasTitleField(live))) {
    await closeBlankPages(context, live);
    return live;
  }
  await live
    .locator('input[type="file"]')
    .first()
    .waitFor({ state: "attached", timeout: 30_000 })
    .catch(() => undefined);
  return (await adoptLivePage(context, live).catch(() => live)) ?? live;
}

async function waitUploadReady(page: Page): Promise<Page | null> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    for (const live of openPages(page.context())) {
      if (await hasTitleField(live)) return live;
      const failed = live.getByText(/上传失败|格式不支持|文件过大/);
      if (await failed.first().isVisible().catch(() => false)) return null;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

async function settlePublishForm(page: Page): Promise<Page> {
  await closeBlankPages(page.context(), page);
  await page.waitForTimeout(1200);
  if (await hasTitleField(page)) return page;
  const again = await waitUploadReady(page);
  if (again) {
    await closeBlankPages(again.context(), again);
    return again;
  }
  return page;
}

async function fillTitleOnce(page: Page, title: string): Promise<boolean> {
  if (!title) return false;
  const loc = page.locator(TITLE_SEL).first();
  if (!(await loc.isVisible().catch(() => false))) return false;
  const current = (
    (await loc.inputValue().catch(() => "")) ||
    (await loc.innerText().catch(() => ""))
  ).trim();
  if (looksFilled(current) && current.length >= 2) return true;
  await loc.fill(title).catch(() => undefined);
  return true;
}

function looksFilled(text: string): boolean {
  const t = String(text || "").replace(/\s+/g, "").trim();
  if (!t) return false;
  return !/^(添加作品简介|填写作品简介|作品简介|添加作品描述|简介)$/.test(t);
}

async function fillIntroOnce(page: Page, text: string): Promise<boolean> {
  if (!text) return false;
  await page
    .locator(INTRO_SEL)
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => undefined);
  const loc = page.locator(INTRO_SEL).first();
  if (!(await loc.isVisible().catch(() => false))) return false;
  const current = (
    (await loc.inputValue().catch(() => "")) ||
    (await loc.innerText().catch(() => ""))
  ).trim();
  if (looksFilled(current)) return true;
  const ok = await loc
    .evaluate((el, value) => {
      const node = el as HTMLElement;
      node.focus();
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(
          node.constructor.prototype,
          "value",
        )?.set;
        setter?.call(node, value);
        node.value = value;
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
        return (node.value || "").includes(value.slice(0, 8));
      }
      node.textContent = value;
      node.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: value,
        }),
      );
      return (node.innerText || node.textContent || "").includes(value.slice(0, 8));
    }, text)
    .catch(() => false);
  return Boolean(ok);
}

export async function publishDouyinShortVideo(
  page: Page,
  input: { file: string; title: string; description?: string },
): Promise<PublishResult & { page: Page }> {
  await stayOnOneCreatorTab(page.context());
  page = await openVideoUpload(page);
  if (!(await isLoggedIn(page)) || /passport|\/login/i.test(page.url())) {
    return {
      success: false,
      error:
        "抖音未登录或登录已过期。请在打开的窗口扫码登录，登录成功后关闭窗口，下次会记住登录态",
      screenshotPath: await captureDebugScreenshot(page, "douyin-video-login"),
      keepOpen: true,
      page,
    };
  }

  const alreadyForm =
    isVideoPublishForm(page.url()) || (await hasTitleField(page));
  if (!alreadyForm) {
    const inputEl = await pickVideoFileInput(page);
    if (!inputEl) {
      return {
        success: false,
        error: "找不到抖音视频上传框。请在打开的窗口里把成片拖进去",
        screenshotPath: await captureDebugScreenshot(page, "douyin-video-no-input"),
        keepOpen: true,
        page,
      };
    }
    await inputEl.setInputFiles(input.file);
  }
  const form = alreadyForm ? page : await waitUploadReady(page);
  if (!form) {
    return {
      success: false,
      error: "视频还没传完或上传失败。请在打开的窗口里核对后点发布",
      screenshotPath: await captureDebugScreenshot(page, "douyin-video-upload"),
      keepOpen: true,
      page,
    };
  }
  page = await settlePublishForm(form);

  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 30);
  const desc = (input.description || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n")
    .trim()
    .slice(0, 300);
  const titled = await fillTitleOnce(page, title).catch(() => false);
  const introFilled = await fillIntroOnce(page, desc).catch(() => false);
  console.log("[douyin-video] filled meta", { titled, introFilled });

  return {
    success: true,
    awaitingUserPublish: true,
    keepOpen: true,
    error: "视频已传到抖音。请在打开的窗口核对后点「发布」；完成后请关闭窗口",
    screenshotPath: await captureDebugScreenshot(page, "douyin-video-ready"),
    page,
  };
}
