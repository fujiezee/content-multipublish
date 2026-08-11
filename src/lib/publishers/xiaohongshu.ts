import type { Page } from "playwright";
import {
  captureDebugScreenshot,
  clickFirstVisible,
} from "@/lib/publishers/browser";
import {
  dismissCommonOverlays,
  hasCookieMatch,
} from "@/lib/publishers/helpers";
import type { PlatformPublisher } from "@/lib/publishers/types";
import type { PublishContent, PublishResult } from "@/lib/types";

/** 长文入口（与现网创作者中心一致） */
const EDITOR_ARTICLE =
  "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article";
const LOGIN = "https://creator.xiaohongshu.com/login";

const TITLE_EDITOR = 'textarea[placeholder="输入标题"]';
const TITLE_POST_LAYOUT = 'input[placeholder="填写标题会有更多赞哦"]';
const BODY_EDITOR = "div.tiptap.ProseMirror";

function isClosedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /has been closed|Target closed|Target page|Browser has been closed/i.test(
    msg,
  );
}

async function safeWait(page: Page, ms: number): Promise<boolean> {
  if (page.isClosed()) return false;
  try {
    await page.waitForTimeout(ms);
    return true;
  } catch (err) {
    if (isClosedError(err)) return false;
    throw err;
  }
}

async function isLoggedIn(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;
  if (/\/login|passport|sso/i.test(page.url())) return false;
  return hasCookieMatch(
    page,
    [
      "https://creator.xiaohongshu.com",
      "https://www.xiaohongshu.com",
      "https://edith.xiaohongshu.com",
    ],
    /web_session|xsec|customer-sso-sid|a1|webId/i,
  );
}

async function clickExactText(page: Page, text: string, timeoutMs = 2000) {
  if (page.isClosed()) return false;
  const candidates = [
    page.getByRole("tab", { name: text, exact: true }),
    page.getByRole("button", { name: text, exact: true }),
    page.getByText(text, { exact: true }),
  ];
  for (const loc of candidates) {
    const first = loc.first();
    if ((await first.count().catch(() => 0)) === 0) continue;
    if (!(await first.isVisible().catch(() => false))) continue;
    try {
      await first.click({ timeout: timeoutMs });
      return true;
    } catch {
      // try next locator
    }
  }
  return false;
}

async function editorReady(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;
  const title = page.locator(TITLE_EDITOR).first();
  const body = page.locator(BODY_EDITOR).first();
  const titleOk =
    (await title.count().catch(() => 0)) > 0 &&
    (await title.isVisible().catch(() => false));
  const bodyOk =
    (await body.count().catch(() => 0)) > 0 &&
    (await body.isVisible().catch(() => false));
  return titleOk && bodyOk;
}

/** Leave upload-image landing and enter long-form editor. */
async function enterLongFormEditor(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;
  await dismissCommonOverlays(page);

  if (await editorReady(page)) return true;

  // Prefer exact text — avoid `div:has-text` matching huge parents
  await clickExactText(page, "写长文");
  if (!(await safeWait(page, 800))) return false;
  await clickExactText(page, "长文");
  if (!(await safeWait(page, 600))) return false;

  await clickExactText(page, "新的创作");
  await clickExactText(page, "新建长文");
  await clickExactText(page, "开始创作");
  if (!(await safeWait(page, 1200))) return false;

  await clickFirstVisible(page, [
    'button:has-text("新的创作")',
    'div.creator-button:has-text("新的创作")',
  ]).catch(() => undefined);

  await dismissCommonOverlays(page);
  return editorReady(page);
}

async function waitForLongFormEditor(
  page: Page,
  timeoutMs = 18_000,
): Promise<boolean> {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) return false;
    if (await editorReady(page)) return true;
    attempt += 1;
    // Re-nudge entry every few seconds — UI often needs a second click
    if (attempt % 4 === 0) {
      await enterLongFormEditor(page);
    }
    if (!(await safeWait(page, 500))) return false;
  }
  return false;
}

async function insertHtmlIntoEditor(page: Page, html: string) {
  await page.evaluate(
    ({ selector, htmlContent }) => {
      const editor = document.querySelector(selector) as HTMLElement | null;
      if (!editor) throw new Error(`Editor not found: ${selector}`);
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (typeof document.execCommand === "function") {
        document.execCommand("selectAll", false);
        document.execCommand("insertHTML", false, htmlContent);
      } else {
        editor.innerHTML = htmlContent;
        editor.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText" }),
        );
      }
    },
    { selector: BODY_EDITOR, htmlContent: html },
  );
}

async function fillLongForm(page: Page, content: PublishContent) {
  const title = content.title.slice(0, 20);
  const plain = content.bodyText || content.bodyMarkdown || content.title;
  const html = content.bodyHtml || `<p>${plain}</p>`;

  const titleBox = page.locator(TITLE_EDITOR).first();
  await titleBox.click({ timeout: 8000 });
  await titleBox.fill(title);

  const body = page.locator(BODY_EDITOR).first();
  await body.click({ timeout: 8000 });
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press("Backspace");
  if (!(await safeWait(page, 150))) return;

  try {
    await insertHtmlIntoEditor(page, html);
  } catch {
    await page.keyboard.type(plain.slice(0, 5000), { delay: 2 });
  }
}

async function maybeOneClickLayout(page: Page) {
  const clicked = await clickExactText(page, "一键排版", 3000);
  if (!clicked) return;
  // Layout can take a while; poll instead of a single long waitForTimeout
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    if (page.isClosed()) return;
    const url = page.url();
    if (/publish\/update/i.test(url)) return;
    const postTitle = page.locator(TITLE_POST_LAYOUT).first();
    if (
      (await postTitle.count().catch(() => 0)) > 0 &&
      (await postTitle.isVisible().catch(() => false))
    ) {
      return;
    }
    if (await page.getByText("图片编辑").first().isVisible().catch(() => false)) {
      return;
    }
    if (!(await safeWait(page, 1000))) return;
  }
}

async function publish(
  page: Page,
  content: PublishContent,
): Promise<PublishResult> {
  try {
    await page.goto(EDITOR_ARTICLE, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    if (!(await safeWait(page, 800))) {
      return {
        success: false,
        error: "小红书窗口已关闭，请重新同步",
        keepOpen: false,
      };
    }
    await dismissCommonOverlays(page);

    if (!(await isLoggedIn(page)) || /\/login/i.test(page.url())) {
      return {
        success: false,
        error: "小红书未登录或登录已过期，请先在「账号」页扫码连接",
        screenshotPath: await captureDebugScreenshot(
          page,
          "xiaohongshu-not-login",
        ),
        keepOpen: true,
      };
    }

    await enterLongFormEditor(page);
    const ready = await waitForLongFormEditor(page, 18_000);
    if (!ready) {
      if (page.isClosed()) {
        return {
          success: false,
          error: "小红书窗口已关闭，请重新同步",
          keepOpen: false,
        };
      }
      return {
        success: false,
        error:
          "未进入小红书长文编辑器（可能停在上传图文页或账号未开通写长文）。请在打开的窗口点「写长文」→「新的创作」后手动粘贴；完成后请关闭窗口",
        screenshotPath: await captureDebugScreenshot(
          page,
          "xiaohongshu-no-editor",
        ),
        keepOpen: true,
      };
    }

    await fillLongForm(page, content);
    if (!(await safeWait(page, 400))) {
      return {
        success: false,
        error: "小红书窗口已关闭，请重新同步",
        keepOpen: false,
      };
    }

    await maybeOneClickLayout(page);
    if (page.isClosed()) {
      return {
        success: false,
        error: "小红书窗口已关闭，请重新同步",
        keepOpen: false,
      };
    }

    // Post-layout: refresh title if the field appears
    const postTitle = page.locator(TITLE_POST_LAYOUT).first();
    if (
      (await postTitle.count().catch(() => 0)) > 0 &&
      (await postTitle.isVisible().catch(() => false))
    ) {
      await postTitle.fill(content.title.slice(0, 20)).catch(() => undefined);
    }

    // Do not auto-click 发布 — leave for user (cover / tags / visibility)
    return {
      success: false,
      error:
        "小红书已填入标题与正文。请在打开的窗口确认排版/封面后点「发布」；完成后请关闭窗口，才会开始下一个平台",
      screenshotPath: await captureDebugScreenshot(
        page,
        "xiaohongshu-await-manual",
      ),
      keepOpen: true,
    };
  } catch (err) {
    if (isClosedError(err) || page.isClosed()) {
      return {
        success: false,
        error: "小红书窗口已关闭，请重新同步",
        keepOpen: false,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `${message}（完成后请关闭窗口，才会开始下一个平台）`,
      screenshotPath: await captureDebugScreenshot(page, "xiaohongshu-error"),
      keepOpen: true,
    };
  }
}

export const xiaohongshuPublisher: PlatformPublisher = {
  id: "xiaohongshu",
  name: "小红书",
  loginUrl: LOGIN,
  editorUrl: EDITOR_ARTICLE,
  isLoggedIn,
  publish,
};
