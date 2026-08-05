import type { Page } from "playwright";
import {
  captureDebugScreenshot,
  clickFirstVisible,
  fillFirstVisible,
} from "@/lib/publishers/browser";
import type { PlatformPublisher } from "@/lib/publishers/types";
import type { PublishContent, PublishResult } from "@/lib/types";

const WRITE_URL = "https://zhuanlan.zhihu.com/write";

function isPublishedUrl(url: string) {
  // Draft editors look like /p/<id>/edit — must NOT count as published
  if (/\/edit(?:\?|$)/i.test(url)) return false;
  if (/\/write(?:\?|$)/i.test(url)) return false;
  return /zhuanlan\.zhihu\.com\/p\/\d+\/?(\?|$)/i.test(url);
}

async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("/signin") || url.includes("/login")) return false;

  const cookies = await page.context().cookies([
    "https://www.zhihu.com",
    "https://zhuanlan.zhihu.com",
  ]);
  return cookies.some((c) => c.name === "z_c0");
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
    ".public-DraftEditor-content",
    ".ProseMirror",
    'div[contenteditable="true"][role="textbox"]',
    ".DraftEditor-editorContainer [contenteditable='true']",
    'div[contenteditable="true"]',
  ];

  let editor = null as ReturnType<Page["locator"]> | null;
  for (const sel of editorSelectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    editor = loc;
    break;
  }
  if (!editor) {
    throw new Error("找不到知乎正文编辑器");
  }

  await editor.click({ timeout: 15_000 });
  await page.waitForTimeout(300);

  // Select all and replace — Draft.js / ProseMirror respond better to paste than innerHTML
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+a`);
  await page.waitForTimeout(100);
  await pasteHtml(page, content.bodyHtml, content.bodyText);
  await page.waitForTimeout(800);

  // Fallback: type plain text if editor still empty-ish
  const textLen = await editor.evaluate((el) => (el.textContent || "").trim().length);
  if (textLen < 5 && content.bodyText) {
    await page.keyboard.press(`${mod}+a`);
    const chunk = content.bodyText.slice(0, 4000);
    await page.keyboard.type(chunk, { delay: 8 });
  }
}

async function completePublishPanel(page: Page) {
  // Zhihu often opens a side/modal panel: topics + 确认发布
  await page.waitForTimeout(800);

  // Optional: add a generic topic if the panel asks and publish is blocked
  const topicBtn = page.locator('button:has-text("添加话题"), button:has-text("绑定话题")');
  if ((await topicBtn.count()) > 0 && (await topicBtn.first().isVisible().catch(() => false))) {
    try {
      await topicBtn.first().click({ timeout: 3000 });
      const input = page.locator(
        'input[placeholder*="搜索话题"], input[placeholder*="话题"]',
      ).first();
      if (await input.isVisible().catch(() => false)) {
        await input.fill("经验分享");
        await page.waitForTimeout(1200);
        const item = page
          .locator(
            ".Popover-content button, .TopicList button, [class*='Topic'] button, [class*='topic'] li, [role='option']",
          )
          .first();
        if (await item.isVisible().catch(() => false)) {
          await item.click();
        } else {
          await page.keyboard.press("Enter");
        }
        await page.waitForTimeout(500);
      }
    } catch {
      // Topics are optional for some accounts
    }
  }

  const confirmSelectors = [
    'button:has-text("确认发布")',
    'button:has-text("确定发布")',
    '.PublishPanel button:has-text("发布")',
    'button.Button--primary:has-text("发布")',
    'button:has-text("发布")',
  ];

  for (const sel of confirmSelectors) {
    const btn = page.locator(sel).last();
    if ((await btn.count()) === 0) continue;
    if (!(await btn.isVisible().catch(() => false))) continue;
    const disabled = await btn.isDisabled().catch(() => false);
    if (disabled) continue;
    await btn.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
    break;
  }
}

async function waitForPublished(page: Page, timeoutMs: number): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const url = page.url();
    if (isPublishedUrl(url)) return url;

    const successToast = page.locator("text=/发布成功|已发布/");
    if ((await successToast.count()) > 0) {
      await page.waitForTimeout(1500);
      if (isPublishedUrl(page.url())) return page.url();
    }

    await page.waitForTimeout(1000);
  }
  return isPublishedUrl(page.url()) ? page.url() : null;
}

async function publish(page: Page, content: PublishContent): Promise<PublishResult> {
  try {
    await page.goto(WRITE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);

    if (!(await isLoggedIn(page))) {
      return {
        success: false,
        error: "知乎未登录或登录已过期，请先在「账号」页重新连接",
        screenshotPath: await captureDebugScreenshot(page, "zhihu-not-login"),
        keepOpen: true,
      };
    }

    // Title
    await fillFirstVisible(
      page,
      [
        'textarea[placeholder*="标题"]',
        'input[placeholder*="标题"]',
        ".WriteIndex-titleInput textarea",
        ".WriteIndex-titleInput input",
        ".PostEditor-titleInput textarea",
        ".InputLike",
      ],
      content.title,
    );
    await page.waitForTimeout(400);

    await fillBody(page, content);
    await page.waitForTimeout(800);

    // First "发布" click (opens panel or submits)
    await clickFirstVisible(page, [
      'button:has-text("发布")',
      'button:has-text("发布文章")',
      ".PublishPanel-stepOneButton",
      'button.Button--primary:has-text("发布")',
    ]);

    await completePublishPanel(page);

    // Auto wait briefly for published URL (not /edit)
    let published = await waitForPublished(page, 20_000);
    if (published) {
      return { success: true, url: published };
    }

    // Still on draft/edit — keep window open for manual confirm, then poll
    await captureDebugScreenshot(page, "zhihu-await-manual");
    published = await waitForPublished(page, 3 * 60_000);
    if (published) {
      return { success: true, url: published };
    }

    return {
      success: false,
      error:
        "知乎未确认发布成功（当前仍是草稿编辑页）。请在打开的浏览器里点「确认发布」，或重新发布",
      screenshotPath: await captureDebugScreenshot(page, "zhihu-not-published"),
      keepOpen: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
      screenshotPath: await captureDebugScreenshot(page, "zhihu-error"),
      keepOpen: true,
    };
  }
}

export const zhihuPublisher: PlatformPublisher = {
  id: "zhihu",
  name: "知乎",
  loginUrl: "https://www.zhihu.com/signin",
  editorUrl: WRITE_URL,
  isLoggedIn,
  publish,
};
