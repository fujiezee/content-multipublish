import type { Page } from "playwright";
import {
  captureDebugScreenshot,
  clickFirstVisible,
  fillFirstVisible,
} from "@/lib/publishers/browser";
import type { PlatformPublisher } from "@/lib/publishers/types";
import type { PublishContent, PublishResult } from "@/lib/types";

const EDITOR_URL = "https://card.weibo.com/article/v3/editor";

function isEditorUrl(url: string) {
  return (
    /card\.weibo\.com\/article\/v3\/editor/i.test(url) ||
    /#\/draft\//i.test(url) ||
    /\/editor/i.test(url)
  );
}

/** Real published article pages — never the editor/draft. */
function isPublishedUrl(url: string) {
  if (isEditorUrl(url)) return false;
  if (/passport|login/i.test(url)) return false;
  return (
    /weibo\.com\/ttarticle\/p\/show/i.test(url) ||
    /weibo\.com\/ttarticle\/p\/\d+/i.test(url) ||
    /card\.weibo\.com\/article\/m\/show/i.test(url) ||
    /weibo\.com\/\d+\/[A-Za-z0-9]+/i.test(url)
  );
}

async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("login") || url.includes("passport")) return false;

  const cookies = await page.context().cookies([
    "https://weibo.com",
    "https://card.weibo.com",
  ]);
  return cookies.some(
    (c) => c.name === "SUB" || c.name === "SUBP" || c.name === "SSOLoginState",
  );
}

async function pasteHtml(page: Page, html: string, plain: string) {
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
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+v`);
}

async function fillBody(page: Page, content: PublishContent) {
  const editorSelectors = [
    ".ProseMirror",
    ".ql-editor",
    ".WBE_Editor",
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
  ];

  let editor = null as Awaited<ReturnType<Page["locator"]>> | null;
  for (const sel of editorSelectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    editor = loc;
    break;
  }
  if (!editor) throw new Error("找不到微博正文编辑器");

  await editor.click({ timeout: 15_000 });
  if (!(await safeWait(page, 300))) {
    throw new Error("微博浏览器窗口已关闭，请重新发布");
  }
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+a`);
  await safeWait(page, 100);
  await pasteHtml(page, content.bodyHtml, content.bodyText);
  if (!(await safeWait(page, 800))) {
    throw new Error("微博浏览器窗口已关闭，请重新发布");
  }

  const textLen = await editor.evaluate((el) => (el.textContent || "").trim().length);
  if (textLen < 5 && content.bodyText) {
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.type(content.bodyText.slice(0, 4000), { delay: 5 });
  }
}

async function fillSummaryIfPresent(page: Page, summary: string) {
  const text = summary.slice(0, 44);
  if (!text) return;
  try {
    await fillFirstVisible(
      page,
      [
        'textarea[placeholder*="导语"]',
        'input[placeholder*="导语"]',
        'textarea[placeholder*="摘要"]',
        'textarea[placeholder*="简介"]',
      ],
      text,
    );
  } catch {
    // summary field may appear only on step 2
  }
}

async function safeWait(page: Page, ms: number) {
  if (page.isClosed()) return false;
  try {
    await page.waitForTimeout(ms);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/has been closed|Target closed|Target page/i.test(msg)) return false;
    throw err;
  }
}

async function clickPublishFlow(page: Page, summary: string) {
  // Current UI: bottom bar is 保存草稿 / 预览 / 下一步 — then another 发布
  const nextBtn = page
    .getByRole("button", { name: "下一步", exact: true })
    .or(page.locator('button:has-text("下一步")'))
    .last();
  if (
    (await nextBtn.count()) > 0 &&
    (await nextBtn.isVisible().catch(() => false))
  ) {
    await nextBtn.click({ timeout: 10_000 }).catch(() => undefined);
  } else {
    await clickFirstVisible(page, [
      'button:has-text("下一步")',
      'button:has-text("发布")',
      'button:has-text("发表")',
      'a:has-text("发布")',
      ".publish-btn",
    ]);
  }
  if (!(await safeWait(page, 1500))) {
    throw new Error("微博浏览器窗口已关闭，请重新发布");
  }

  // Step 2: cover / summary / final publish
  await fillSummaryIfPresent(page, summary);

  const finalSelectors = [
    'button:has-text("发布")',
    'button:has-text("确认发布")',
    'button:has-text("发表")',
    'button:has-text("完成")',
    'button:has-text("下一步")',
  ];

  for (const sel of finalSelectors) {
    if (page.isClosed()) throw new Error("微博浏览器窗口已关闭，请重新发布");
    const btn = page.locator(sel).last();
    if ((await btn.count()) === 0) continue;
    if (!(await btn.isVisible().catch(() => false))) continue;
    if (await btn.isDisabled().catch(() => false)) continue;
    await btn.click({ timeout: 5000 }).catch(() => undefined);
    if (!(await safeWait(page, 1200))) {
      throw new Error("微博浏览器窗口已关闭，请重新发布");
    }
  }

  // Confirm dialogs
  const confirm = page.locator(
    'button:has-text("确定"), button:has-text("确认"), button:has-text("确认发布")',
  );
  if (
    (await confirm.count()) > 0 &&
    (await confirm.first().isVisible().catch(() => false))
  ) {
    await confirm.first().click().catch(() => undefined);
  }
}

async function waitForPublished(
  page: Page,
  timeoutMs: number,
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) {
      throw new Error(
        "微博浏览器窗口已关闭（可能被账号检测关掉了）。请再点一次发布，发布期间不要点「检测」账号",
      );
    }
    let url = "";
    try {
      url = page.url();
    } catch {
      throw new Error("微博浏览器窗口已关闭，请重新发布");
    }
    if (isPublishedUrl(url)) return url;

    const toast = page.locator("text=/发布成功|发表成功|已发布/");
    if ((await toast.count().catch(() => 0)) > 0) {
      if (!(await safeWait(page, 1500))) {
        throw new Error("微博浏览器窗口已关闭，请重新发布");
      }
      if (isPublishedUrl(page.url())) return page.url();
      const now = page.url();
      if (!isEditorUrl(now) && /card\.weibo\.com|weibo\.com/.test(now)) {
        return now;
      }
    }

    if (!(await safeWait(page, 1000))) {
      throw new Error(
        "微博浏览器窗口已关闭（可能被账号检测关掉了）。请再点一次发布，发布期间不要点「检测」账号",
      );
    }
  }

  if (page.isClosed()) return null;
  const url = page.url();
  if (isPublishedUrl(url)) return url;
  if (!isEditorUrl(url) && /ttarticle|\/p\/show/.test(url)) return url;
  return null;
}

async function publish(page: Page, content: PublishContent): Promise<PublishResult> {
  try {
    await page.goto(`${EDITOR_URL}#/draft/0`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    if (!(await safeWait(page, 2500))) {
      return {
        success: false,
        error: "微博浏览器窗口已关闭，请重新发布",
        keepOpen: false,
      };
    }

    if (
      page.url().includes("login") ||
      page.url().includes("passport") ||
      !(await isLoggedIn(page))
    ) {
      return {
        success: false,
        error: "微博未登录或登录已过期，请先在「账号」页重新连接",
        screenshotPath: await captureDebugScreenshot(page, "weibo-not-login"),
        keepOpen: true,
      };
    }

    // Dismiss title-length tip if present
    await page
      .locator('[class*="warn"] button, [class*="alert"] button, button:has-text("×")')
      .first()
      .click({ timeout: 800 })
      .catch(() => undefined);

    // Ensure we're in a writable article (new or existing draft)
    const writeBtn = page.locator(
      'button:has-text("写文章"), a:has-text("写文章")',
    );
    if (
      (await writeBtn.count()) > 0 &&
      (await writeBtn.first().isVisible().catch(() => false))
    ) {
      const hasEditor = await page
        .locator('.ProseMirror, div[contenteditable="true"]')
        .first()
        .isVisible()
        .catch(() => false);
      if (!hasEditor) {
        await writeBtn.first().click().catch(() => undefined);
        await safeWait(page, 1500);
      }
    }

    await fillFirstVisible(
      page,
      [
        'textarea[placeholder*="标题"]',
        'input[placeholder*="标题"]',
        'textarea[placeholder*="请输入标题"]',
        'input[placeholder*="请输入标题"]',
        ".title-input input",
        ".title-input textarea",
        ".article-title input",
        'input[maxlength="32"]',
        'textarea[maxlength="32"]',
      ],
      content.title.slice(0, 32),
    );
    await safeWait(page, 400);

    await fillBody(page, content);
    await fillSummaryIfPresent(page, content.summary);
    await safeWait(page, 800);

    await clickPublishFlow(page, content.summary);

    let published = await waitForPublished(page, 25_000);
    if (published) {
      return { success: true, url: published };
    }

    // Still on editor — keep open for manual 下一步 / 发布
    await captureDebugScreenshot(page, "weibo-await-manual");
    published = await waitForPublished(page, 3 * 60_000);
    if (published) {
      return { success: true, url: published };
    }

    return {
      success: false,
      error:
        "微博未确认发布成功（仍在编辑页）。请在打开的窗口点「下一步」完成封面/导语后发布",
      screenshotPath: await captureDebugScreenshot(page, "weibo-not-published"),
      keepOpen: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
      screenshotPath: await captureDebugScreenshot(page, "weibo-error"),
      keepOpen: true,
    };
  }
}

export const weiboPublisher: PlatformPublisher = {
  id: "weibo",
  name: "微博",
  loginUrl: "https://weibo.com/login.php",
  editorUrl: EDITOR_URL,
  isLoggedIn,
  publish,
};
