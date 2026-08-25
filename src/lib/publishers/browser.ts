import fs from "fs";
import os from "os";
import path from "path";
import type { Browser, BrowserContext, Page } from "playwright";
import { DEBUG_DIR, ensureDataDirs, sessionPath } from "@/lib/paths";
import type { PlatformId } from "@/lib/types";

async function loadChromium() {
  if (process.env.CLOUDFLARE === "1") {
    throw new Error("云端发稿请用点物助手，本机浏览器自动化不可用");
  }
  const { chromium } = await import("playwright");
  return chromium;
}

// Keep headed / headless browsers separate — never close one to launch the other.
// Otherwise a background session check (headless) kills an in-flight publish window.
let headedBrowser: Browser | null = null;
let headlessBrowser: Browser | null = null;

function ensureBrowsersPath() {
  // Cursor / some sandboxes point PLAYWRIGHT_BROWSERS_PATH at an empty cache.
  // Clear that so Playwright uses its default user cache.
  const current = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (current?.includes("cursor-sandbox-cache")) {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
}

function systemChromePath(): string | null {
  const home = os.homedir();
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        ]
      : process.platform === "win32"
        ? [
            path.join(
              process.env.PROGRAMFILES ?? "C:\\Program Files",
              "Google",
              "Chrome",
              "Application",
              "chrome.exe",
            ),
            path.join(
              process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
              "Google",
              "Chrome",
              "Application",
              "chrome.exe",
            ),
            path.join(
              home,
              "AppData",
              "Local",
              "Google",
              "Chrome",
              "Application",
              "chrome.exe",
            ),
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/snap/bin/chromium",
          ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

async function launchBrowser(headless: boolean): Promise<Browser> {
  ensureBrowsersPath();
  const common = {
    headless,
    slowMo: headless ? 0 : 80,
    args: ["--disable-blink-features=AutomationControlled"],
  };
  try {
    const chrome = systemChromePath();
    const chromium = await loadChromium();
    if (chrome) {
      return await chromium.launch({ ...common, executablePath: chrome });
    }
    return await chromium.launch(common);
  } catch (err) {
    const chromium = await loadChromium();
    return chromium.launch(common).catch(() => {
      throw err;
    });
  }
}

export async function getBrowser(headless = false): Promise<Browser> {
  if (headless) {
    if (headlessBrowser?.isConnected()) return headlessBrowser;
    headlessBrowser = await launchBrowser(true);
    return headlessBrowser;
  }
  if (headedBrowser?.isConnected()) return headedBrowser;
  headedBrowser = await launchBrowser(false);
  return headedBrowser;
}

export async function closeBrowser() {
  if (headedBrowser) {
    await headedBrowser.close().catch(() => undefined);
    headedBrowser = null;
  }
  if (headlessBrowser) {
    await headlessBrowser.close().catch(() => undefined);
    headlessBrowser = null;
  }
}

export async function openContext(
  platform: PlatformId,
  options: { headless?: boolean; useSession?: boolean } = {},
): Promise<{ browser: Browser; context: BrowserContext }> {
  ensureDataDirs();
  const browser = await getBrowser(options.headless ?? false);
  const stateFile = sessionPath(platform);
  const useSession = options.useSession !== false && fs.existsSync(stateFile);

  const context = await browser.newContext({
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1360, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    storageState: useSession ? stateFile : undefined,
  });

  return { browser, context };
}

/** Own Chrome process — do not share the headed singleton (HMR leftovers close tabs). */
export async function openDetachedHeadedContext(
  platform: PlatformId,
  options: { useSession?: boolean } = {},
): Promise<{ browser: Browser; context: BrowserContext }> {
  ensureDataDirs();
  delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  const chrome = systemChromePath();
  const chromium = await loadChromium();
  const browser = await chromium.launch({
    headless: false,
    executablePath: chrome || undefined,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const stateFile = sessionPath(platform);
  const useSession = options.useSession !== false && fs.existsSync(stateFile);
  const context = await browser.newContext({
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1360, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    storageState: useSession ? stateFile : undefined,
  });
  return { browser, context };
}

export async function saveSession(platform: PlatformId, context: BrowserContext) {
  ensureDataDirs();
  const file = sessionPath(platform);
  // indexedDB helps some SPAs (incl. JianShu writer) restore client auth state
  await context.storageState({ path: file, indexedDB: true }).catch(async () => {
    await context.storageState({ path: file });
  });
  return file;
}

export async function captureDebugScreenshot(
  page: Page,
  label: string,
): Promise<string> {
  ensureDataDirs();
  const file = path.join(
    DEBUG_DIR,
    `${Date.now()}-${label.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`,
  );
  await page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
  return file;
}

export async function waitForManualLogin(
  page: Page,
  isLoggedIn: (page: Page) => Promise<boolean>,
  timeoutMs = 5 * 60 * 1000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (page.isClosed()) return false;
      if (await isLoggedIn(page)) return true;
    } catch (err) {
      // Navigations during QR login often destroy the execution context
      const msg = err instanceof Error ? err.message : String(err);
      if (!/Execution context was destroyed|Target closed|has been closed/i.test(msg)) {
        throw err;
      }
    }
    await page.waitForTimeout(1500).catch(() => undefined);
  }
  return false;
}

export async function setContentEditable(page: Page, selector: string, html: string) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: 30_000 });
  await el.click();
  await page.evaluate(
    ({ sel, content }) => {
      const node = document.querySelector(sel) as HTMLElement | null;
      if (!node) throw new Error(`找不到编辑器: ${sel}`);
      node.focus();
      node.innerHTML = content;
      node.dispatchEvent(new InputEvent("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { sel: selector, content: html },
  );
}

export async function fillFirstVisible(
  page: Page,
  selectors: string[],
  value: string,
) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.click({ timeout: 5000 }).catch(() => undefined);
    await loc.fill(value);
    return sel;
  }
  throw new Error(`找不到可填写的输入框: ${selectors.join(", ")}`);
}

export async function clickFirstVisible(page: Page, selectors: string[]) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.click({ timeout: 10_000 });
    return sel;
  }
  throw new Error(`找不到可点击的按钮: ${selectors.join(", ")}`);
}
