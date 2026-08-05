import type { Page } from "playwright";
import {
  captureDebugScreenshot,
  clickFirstVisible,
} from "@/lib/publishers/browser";
import type { PlatformPublisher } from "@/lib/publishers/types";
import type { PublishContent, PublishResult } from "@/lib/types";

const WRITER_URL = "https://www.jianshu.com/writer#/";
const LOGIN_URL = "https://www.jianshu.com/sign_in";

/** Real JianShu auth cookies (not analytics / csrf). */
const AUTH_COOKIE_NAMES = ["remember_user_token", "_m7e_session"];

function isWriterUrl(url: string) {
  return /jianshu\.com\/writer/i.test(url);
}

function isPublishedUrl(url: string) {
  if (isWriterUrl(url)) return false;
  if (/sign_in|sign_up|login/i.test(url)) return false;
  return /jianshu\.com\/p\/[a-zA-Z0-9]+/i.test(url);
}

async function hasAuthCookies(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies([
    "https://www.jianshu.com",
    "https://jianshu.com",
  ]);
  return cookies.some((c) => AUTH_COOKIE_NAMES.includes(c.name) && Boolean(c.value));
}

async function hasWriterChrome(page: Page): Promise<boolean> {
  const create = page.locator("text=新建文章");
  const publish = page.locator("text=发布文章");
  if ((await create.count()) > 0 && (await create.first().isVisible().catch(() => false))) {
    return true;
  }
  if ((await publish.count()) > 0 && (await publish.first().isVisible().catch(() => false))) {
    return true;
  }
  return false;
}

// Strict login: require writer UI or remember_user_token / _m7e_session.
async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (/\/sign_in|\/sign_up/i.test(url)) return false;

  if (await hasWriterChrome(page)) return true;

  // On homepage after QR login: auth cookies present and left sign-in
  if (await hasAuthCookies(page)) {
    if (/jianshu\.com\/?(\?|$|#)/i.test(url) || isWriterUrl(url)) return true;
    if (!/sign_in|sign_up/i.test(url)) return true;
  }

  return false;
}

async function ensureNewArticle(page: Page) {
  const create = page.locator("text=新建文章").first();
  if ((await create.count()) > 0 && (await create.isVisible().catch(() => false))) {
    await create.click({ timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
  }
  // New JianShu writer: rich editor .kalamu-area + title input
  await page
    .locator('.kalamu-area, textarea#arthur-editor, .CodeMirror, [contenteditable="true"]')
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => undefined);
  await page
    .locator(
      'input[type="text"]:not([placeholder*="文集"]), input[placeholder*="标题"], #root input[type="text"]',
    )
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => undefined);

  // New notes default to today's date as title — wait for that to settle
  // before we overwrite, otherwise JianShu's init will clobber our title.
  await page.waitForTimeout(800);
}

function looksLikeAutoDateTitle(value: string) {
  return /^\d{4}-\d{1,2}-\d{1,2}$/.test(value.trim());
}

async function readArticleTitle(page: Page): Promise<string> {
  return page.evaluate(() => {
    const inputs = [
      ...document.querySelectorAll('input[type="text"]'),
    ] as HTMLInputElement[];
    const candidates = inputs.filter((el) => {
      if ((el.placeholder || "").includes("文集")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 200 && r.height > 20;
    });
    const el =
      candidates.sort(
        (a, b) =>
          b.getBoundingClientRect().width - a.getBoundingClientRect().width,
      )[0] || null;
    return (el?.value || "").trim();
  });
}

async function focusArticleTitleInput(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const inputs = [
      ...document.querySelectorAll('input[type="text"]'),
    ] as HTMLInputElement[];
    const candidates = inputs.filter((el) => {
      if ((el.placeholder || "").includes("文集")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 200 && r.height > 20 && r.top < 140;
    });
    const el =
      candidates.sort(
        (a, b) =>
          b.getBoundingClientRect().width - a.getBoundingClientRect().width,
      )[0] ||
      inputs.find((i) => !(i.placeholder || "").includes("文集"));
    if (!el) return false;
    el.focus();
    el.click();
    el.select();
    return true;
  });
}

/**
 * JianShu defaults new notes to YYYY-MM-DD. Must drive the real input with
 * keyboard events so React state updates; DOM-only value writes get reverted.
 */
async function fillTitle(page: Page, title: string) {
  const value = title.slice(0, 80);
  const mod = process.platform === "darwin" ? "Meta" : "Control";

  for (let attempt = 0; attempt < 3; attempt++) {
    const focused = await focusArticleTitleInput(page);
    if (!focused) break;

    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(120);
    await page.keyboard.type(value, { delay: 20 });
    await page.waitForTimeout(300);

    // Blur so JianShu commits / autosaves the title (not the date default)
    await page.locator(".kalamu-area").first().click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(600);

    const current = await readArticleTitle(page);
    if (
      current === value ||
      (current.includes(value.slice(0, Math.min(8, value.length))) &&
        !looksLikeAutoDateTitle(current))
    ) {
      return;
    }
    await page.waitForTimeout(400);
  }

  const finalTitle = await readArticleTitle(page);
  if (!finalTitle || looksLikeAutoDateTitle(finalTitle)) {
    throw new Error(
      `简书标题未能写入（当前仍是「${finalTitle || "空"}」）。请手动改标题后点发布`,
    );
  }
}

async function writeClipboard(
  page: Page,
  html: string,
  plain: string,
) {
  await page.evaluate(
    async ({ htmlContent, plainContent }) => {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([htmlContent], { type: "text/html" }),
            "text/plain": new Blob([plainContent || htmlContent], {
              type: "text/plain",
            }),
          }),
        ]);
      } catch {
        await navigator.clipboard.writeText(plainContent || htmlContent);
      }
    },
    { htmlContent: html, plainContent: plain },
  );
}

/** JianShu writer now uses Kalamu rich editor (.kalamu-area), not Markdown textarea. */
async function fillBody(page: Page, content: PublishContent) {
  const html = content.bodyHtml || `<p>${content.bodyText || ""}</p>`;
  const plain = content.bodyText || content.bodyMarkdown || "";
  const mod = process.platform === "darwin" ? "Meta" : "Control";

  const kalamu = page.locator(".kalamu-area").first();
  try {
    await kalamu.waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    // fall through to legacy selectors
  }

  if ((await kalamu.count()) > 0 && (await kalamu.isVisible().catch(() => false))) {
    await kalamu.click({ timeout: 10_000 });
    await page.waitForTimeout(200);
    await page.keyboard.press(`${mod}+a`);
    await writeClipboard(page, html, plain);
    await page.keyboard.press(`${mod}+v`);
    await page.waitForTimeout(700);

    let textLen = await kalamu
      .evaluate((el) => (el.textContent || "").replace(/\s+/g, "").length)
      .catch(() => 0);

    if (textLen < 5) {
      await kalamu.evaluate((el, h) => {
        el.focus();
        el.innerHTML = h;
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, html);
      await page.waitForTimeout(400);
      textLen = await kalamu
        .evaluate((el) => (el.textContent || "").replace(/\s+/g, "").length)
        .catch(() => 0);
    }

    if (textLen < 5 && plain) {
      await kalamu.click();
      await page.keyboard.press(`${mod}+a`);
      await page.keyboard.type(plain.slice(0, 8000), { delay: 3 });
      textLen = await kalamu
        .evaluate((el) => (el.textContent || "").replace(/\s+/g, "").length)
        .catch(() => 0);
    }

    if (textLen < 5) {
      throw new Error("简书正文未能写入（Kalamu 编辑器）");
    }
    return;
  }

  // Legacy Markdown / CodeMirror writer
  const textarea = page
    .locator(
      'textarea#arthur-editor, textarea.arthur-editor, textarea[placeholder*="Markdown"]',
    )
    .first();
  if (
    (await textarea.count()) > 0 &&
    (await textarea.isVisible().catch(() => false))
  ) {
    await textarea.click({ timeout: 10_000 });
    await textarea.fill(content.bodyMarkdown || plain);
    return;
  }

  const anyArea = page.locator("textarea").last();
  if (
    (await anyArea.count()) > 0 &&
    (await anyArea.isVisible().catch(() => false))
  ) {
    await anyArea.click();
    await anyArea.fill(content.bodyMarkdown || plain);
    return;
  }

  const editable = page
    .locator(
      '.CodeMirror textarea, .ProseMirror, div[contenteditable="true"]',
    )
    .first();
  await editable.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  if ((await editable.count()) === 0) {
    throw new Error("找不到简书正文编辑器");
  }
  await editable.click({ timeout: 10_000 });
  await page.keyboard.press(`${mod}+a`);
  await writeClipboard(page, html, plain);
  await page.keyboard.press(`${mod}+v`);
}

async function clickPublish(page: Page) {
  await clickFirstVisible(page, [
    'a:has-text("发布文章")',
    'button:has-text("发布文章")',
    '//a[normalize-space(.)="发布文章"]',
    'button:has-text("发布")',
  ]);
  await page.waitForTimeout(1000);

  const confirm = page.locator(
    'button:has-text("确定"), button:has-text("确认"), a:has-text("确定")',
  );
  if ((await confirm.count()) > 0 && (await confirm.first().isVisible().catch(() => false))) {
    await confirm.first().click().catch(() => undefined);
  }
}

async function waitForPublished(page: Page, timeoutMs: number): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const p of page.context().pages()) {
      const u = p.url();
      if (isPublishedUrl(u)) return u;
    }
    const toast = page.locator("text=/发布成功|已发布/");
    if ((await toast.count()) > 0) {
      await page.waitForTimeout(1500);
      for (const p of page.context().pages()) {
        if (isPublishedUrl(p.url())) return p.url();
      }
    }
    await page.waitForTimeout(1000);
  }
  for (const p of page.context().pages()) {
    if (isPublishedUrl(p.url())) return p.url();
  }
  return null;
}

async function publish(page: Page, content: PublishContent): Promise<PublishResult> {
  try {
    await page.goto(WRITER_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);

    if (/sign_in|sign_up/i.test(page.url()) || !(await isLoggedIn(page))) {
      return {
        success: false,
        error: "简书未登录或登录已过期，请先在「账号」页重新连接",
        screenshotPath: await captureDebugScreenshot(page, "jianshu-not-login"),
        keepOpen: true,
      };
    }

    await ensureNewArticle(page);
    await fillTitle(page, content.title);
    await page.waitForTimeout(400);
    await fillBody(page, content);
    await page.waitForTimeout(800);

    // JianShu often resets title back to YYYY-MM-DD after body edits / autosave
    await fillTitle(page, content.title);
    const titleNow = await readArticleTitle(page);
    if (looksLikeAutoDateTitle(titleNow) || !titleNow) {
      await fillTitle(page, content.title);
    }
    await page.waitForTimeout(400);

    await clickPublish(page);

    let published = await waitForPublished(page, 25_000);
    if (published) {
      return { success: true, url: published };
    }

    await captureDebugScreenshot(page, "jianshu-await-manual");
    published = await waitForPublished(page, 3 * 60_000);
    if (published) {
      return { success: true, url: published };
    }

    return {
      success: false,
      error: "简书未确认发布成功。请在打开的窗口检查后点「发布文章」",
      screenshotPath: await captureDebugScreenshot(page, "jianshu-not-published"),
      keepOpen: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
      screenshotPath: await captureDebugScreenshot(page, "jianshu-error"),
      keepOpen: true,
    };
  }
}

export const jianshuPublisher: PlatformPublisher = {
  id: "jianshu",
  name: "简书",
  loginUrl: LOGIN_URL,
  editorUrl: WRITER_URL,
  isLoggedIn,
  publish,
};

export { hasAuthCookies as jianshuHasAuthCookies };
