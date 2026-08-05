import fs from "fs";
import path from "path";
import type { Page } from "playwright";
import {
  captureDebugScreenshot,
  clickFirstVisible,
} from "@/lib/publishers/browser";
import type { PlatformPublisher } from "@/lib/publishers/types";
import { DATA_DIR, UPLOADS_DIR } from "@/lib/paths";
import type { PublishContent, PublishResult } from "@/lib/types";

const EDITOR_URL = "https://mp.toutiao.com/profile_v4/graphic/publish";
const LOGIN_URL = "https://mp.toutiao.com/auth/page/login";

function isEditorUrl(url: string) {
  return /mp\.toutiao\.com\/profile_v4\/graphic\/publish/i.test(url);
}

function isPublishedUrl(url: string) {
  if (isEditorUrl(url)) return false;
  if (/login|passport|sso/i.test(url)) return false;
  return (
    /mp\.toutiao\.com\/profile_v4\/graphic\/(articles|content|list)/i.test(
      url,
    ) ||
    /mp\.toutiao\.com\/profile_v4\/(index|overview|analysis)/i.test(url) ||
    /www\.toutiao\.com\/article\//i.test(url) ||
    /www\.toutiao\.com\/i\d+/i.test(url)
  );
}

async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (/\/auth\/page\/login|passport\.toutiao|sso\.toutiao/i.test(url)) {
    return false;
  }

  const cookies = await page.context().cookies([
    "https://mp.toutiao.com",
    "https://www.toutiao.com",
    "https://sso.toutiao.com",
  ]);
  const hasAuth = cookies.some(
    (c) =>
      /sessionid|sid_tt|uid_tt|toutiao_sso_user|passport_csrf_token/i.test(
        c.name,
      ) && Boolean(c.value),
  );

  if (isEditorUrl(url)) {
    const title = page.locator(
      'textarea[placeholder*="标题"], textarea[placeholder*="2"], textarea[placeholder*="30"]',
    );
    if (
      (await title.count()) > 0 &&
      (await title.first().isVisible().catch(() => false))
    ) {
      return true;
    }
  }

  return hasAuth && /mp\.toutiao\.com/i.test(url);
}

async function dismissOverlays(page: Page) {
  const closes = page.locator(
    'button:has-text("我知道了"), button:has-text("关闭"), button:has-text("跳过"), [aria-label="关闭"], .byte-modal-close, .syl-dialog-close',
  );
  const n = await closes.count();
  for (let i = 0; i < Math.min(n, 4); i++) {
    await closes
      .nth(i)
      .click({ timeout: 1500 })
      .catch(() => undefined);
  }
}

async function fillTitle(page: Page, title: string) {
  const value = title.slice(0, 30);
  const selectors = [
    'textarea[placeholder*="请输入文章标题"]',
    'textarea[placeholder*="标题（2"]',
    'textarea[placeholder*="2～30"]',
    'textarea[placeholder*="2~30"]',
    'textarea[placeholder*="标题"]',
    'input[placeholder*="请输入文章标题"]',
    'input[placeholder*="标题"]',
  ];

  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.click({ timeout: 5000 });
    await loc.fill("");
    await loc.fill(value);
    const current = ((await loc.inputValue().catch(() => "")) || "").trim();
    if (current.includes(value.slice(0, Math.min(6, value.length)))) {
      await page.waitForTimeout(300);
      return;
    }
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.type(value, { delay: 15 });
    return;
  }

  // Fallback: first visible textarea near top
  const area = page.locator("textarea").first();
  await area.waitFor({ state: "visible", timeout: 15_000 });
  await area.fill(value);
}

async function writeClipboard(page: Page, html: string, plain: string) {
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

async function fillBody(page: Page, content: PublishContent) {
  const html = content.bodyHtml || `<p>${content.bodyText || ""}</p>`;
  const plain = content.bodyText || content.bodyMarkdown || "";
  const mod = process.platform === "darwin" ? "Meta" : "Control";

  await page.waitForSelector(".ProseMirror", { timeout: 30_000 });
  const editor = page.locator(".ProseMirror").first();
  await editor.click({ timeout: 10_000 });
  await page.waitForTimeout(200);

  // Prefer insertHTML / paste event inside ProseMirror
  const injected = await page.evaluate((h) => {
    const el = document.querySelector(".ProseMirror") as HTMLElement | null;
    if (!el) return false;
    el.focus();
    try {
      const ok = document.execCommand("insertHTML", false, h);
      if (ok && (el.textContent || "").trim().length > 0) return true;
    } catch {
      // continue
    }
    try {
      const dt = new DataTransfer();
      dt.setData("text/html", h);
      dt.setData("text/plain", h.replace(/<[^>]+>/g, " "));
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    } catch {
      // continue
    }
    return (el.textContent || "").trim().length > 0;
  }, html);

  if (!injected) {
    await page.keyboard.press(`${mod}+a`);
    await writeClipboard(page, html, plain);
    await page.keyboard.press(`${mod}+v`);
  }

  await page.waitForTimeout(800);

  let textLen = await editor
    .evaluate((el) => (el.textContent || "").replace(/\s+/g, "").length)
    .catch(() => 0);

  if (textLen < 5 && plain) {
    await editor.click();
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.type(plain.slice(0, 6000), { delay: 4 });
    textLen = await editor
      .evaluate((el) => (el.textContent || "").replace(/\s+/g, "").length)
      .catch(() => 0);
  }

  if (textLen < 5) {
    throw new Error("头条号正文未能写入");
  }

  // Nudge autosave
  await page.keyboard.type(" ", { delay: 10 }).catch(() => undefined);
  await page.keyboard.press("Backspace").catch(() => undefined);
  await page.waitForTimeout(1000);
}

function resolveCoverFile(coverPath: string | null): string | null {
  if (!coverPath) return null;
  const candidates = [
    coverPath,
    path.join(process.cwd(), coverPath.replace(/^\//, "")),
    path.join(DATA_DIR, coverPath.replace(/^\/?data\//, "")),
    path.join(UPLOADS_DIR, path.basename(coverPath)),
    path.join(
      UPLOADS_DIR,
      coverPath.replace(/^\/?api\/uploads\//, "").replace(/^\//, ""),
    ),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

async function handleCover(page: Page, coverPath: string | null) {
  const file = resolveCoverFile(coverPath);

  // Prefer "无封面" when no local file — keeps publish unblocked
  if (!file) {
    const noCover = page.getByText("无封面", { exact: false }).first();
    if (
      (await noCover.count()) > 0 &&
      (await noCover.isVisible().catch(() => false))
    ) {
      await noCover.click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(400);
    }
    return;
  }

  const addByClass = page.locator("div.article-cover-add, .article-cover-add").first();
  const addByText = page.getByText(/上传封面|添加封面/).first();
  if ((await addByClass.count()) > 0 && (await addByClass.isVisible().catch(() => false))) {
    await addByClass.click({ timeout: 4000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  } else if (
    (await addByText.count()) > 0 &&
    (await addByText.isVisible().catch(() => false))
  ) {
    await addByText.click({ timeout: 4000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  }

  const fileInput = page.locator('input[type="file"]').last();
  if ((await fileInput.count()) > 0) {
    await fileInput.setInputFiles(file).catch(() => undefined);
    await page.waitForTimeout(2000);
    for (const sel of [
      'button:has-text("确定")',
      'button:has-text("完成")',
      'button:has-text("确认")',
    ]) {
      const btn = page.locator(sel).last();
      if ((await btn.count()) === 0) continue;
      if (!(await btn.isVisible().catch(() => false))) continue;
      await btn.click({ timeout: 3000 }).catch(() => undefined);
      break;
    }
  }
}

async function clickPublishFlow(page: Page) {
  await dismissOverlays(page);

  const primary = [
    'button:has-text("预览并发布")',
    'button:has-text("发布")',
    '.publish-btn button',
    'button:has-text("发表")',
  ];
  await clickFirstVisible(page, primary);
  await page.waitForTimeout(1500);
  await dismissOverlays(page);

  const confirms = [
    'button:has-text("确认发布")',
    'button:has-text("确定发布")',
    'button:has-text("确认并发布")',
    'button:has-text("确认")',
    'button:has-text("确定")',
    'button:has-text("发布")',
  ];
  for (const sel of confirms) {
    const btn = page.locator(sel).last();
    if ((await btn.count()) === 0) continue;
    if (!(await btn.isVisible().catch(() => false))) continue;
    if (await btn.isDisabled().catch(() => false)) continue;
    await btn.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    break;
  }
}

async function hasSuccessToast(page: Page) {
  const toast = page.locator(
    "text=/发布成功|提交成功|已发布|审核中|发布完成/",
  );
  return (await toast.count()) > 0;
}

async function waitForPublished(
  page: Page,
  timeoutMs: number,
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const p of page.context().pages()) {
      if (isPublishedUrl(p.url())) return p.url();
    }
    if (await hasSuccessToast(page)) {
      await page.waitForTimeout(1500);
      for (const p of page.context().pages()) {
        if (isPublishedUrl(p.url())) return p.url();
      }
      if (!isEditorUrl(page.url())) return page.url();
    }
    await page.waitForTimeout(1000);
  }
  for (const p of page.context().pages()) {
    if (isPublishedUrl(p.url())) return p.url();
  }
  return null;
}

async function publish(
  page: Page,
  content: PublishContent,
): Promise<PublishResult> {
  try {
    await page.goto(EDITOR_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(3000);
    await dismissOverlays(page);

    if (
      /auth\/page\/login|passport|sso/i.test(page.url()) ||
      !(await isLoggedIn(page))
    ) {
      return {
        success: false,
        error: "头条号未登录或登录已过期，请先在「账号」页重新连接",
        screenshotPath: await captureDebugScreenshot(page, "toutiao-not-login"),
        keepOpen: true,
      };
    }

    // Ensure publish editor chrome
    await page
      .waitForSelector(
        'textarea[placeholder*="标题"], .ProseMirror, textarea',
        { timeout: 30_000 },
      )
      .catch(() => undefined);

    await fillTitle(page, content.title);
    await page.waitForTimeout(400);

    await fillBody(page, content);
    await page.waitForTimeout(600);

    await handleCover(page, content.coverPath).catch(() => undefined);
    await page.waitForTimeout(500);

    await clickPublishFlow(page);

    let published = await waitForPublished(page, 25_000);
    if (published) {
      return { success: true, url: published };
    }

    if (await hasSuccessToast(page)) {
      return { success: true, url: page.url() };
    }

    await captureDebugScreenshot(page, "toutiao-await-manual");
    published = await waitForPublished(page, 3 * 60_000);
    if (published) {
      return { success: true, url: published };
    }

    if (await hasSuccessToast(page)) {
      return { success: true, url: page.url() };
    }

    return {
      success: false,
      error:
        "头条号未确认发布成功。请在打开的窗口补全封面/声明后点「预览并发布」；完成后请关闭该窗口，才会开始下一个平台",
      screenshotPath: await captureDebugScreenshot(
        page,
        "toutiao-not-published",
      ),
      keepOpen: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `${message}（完成后请关闭窗口，才会开始下一个平台）`,
      screenshotPath: await captureDebugScreenshot(page, "toutiao-error"),
      keepOpen: true,
    };
  }
}

export const toutiaoPublisher: PlatformPublisher = {
  id: "toutiao",
  name: "头条号",
  loginUrl: LOGIN_URL,
  editorUrl: EDITOR_URL,
  isLoggedIn,
  publish,
};
