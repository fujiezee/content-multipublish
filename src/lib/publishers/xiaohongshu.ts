import type { Page } from "playwright";
import {
  captureDebugScreenshot,
  clickFirstVisible,
} from "@/lib/publishers/browser";
import {
  dismissCommonOverlays,
  fillBySelectors,
  hasCookieMatch,
  pasteIntoFirst,
} from "@/lib/publishers/helpers";
import type { PlatformPublisher } from "@/lib/publishers/types";
import type { PublishContent, PublishResult } from "@/lib/types";

/** 长文入口（多 URL 兜底，平台常改 query） */
const EDITOR_URLS = [
  "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
  "https://creator.xiaohongshu.com/publish/publish?source=official&target=article",
  "https://creator.xiaohongshu.com/publish/publish?target=article",
  "https://creator.xiaohongshu.com/publish/publish",
];
const LOGIN = "https://creator.xiaohongshu.com/login";

const TITLE_SELECTORS = [
  'textarea[placeholder="输入标题"]',
  'textarea[placeholder*="标题"]',
  'input[placeholder*="标题"]',
  ".titleInput textarea",
  ".title-input textarea",
  'textarea[maxlength="20"]',
  'textarea[maxlength="30"]',
];

const TITLE_POST_LAYOUT = [
  'input[placeholder="填写标题会有更多赞哦"]',
  'input[placeholder*="标题"]',
  'textarea[placeholder*="标题会有更多赞"]',
];

const BODY_SELECTORS = [
  "div.tiptap.ProseMirror[contenteditable='true']",
  "div.tiptap.ProseMirror",
  ".ProseMirror[contenteditable='true']",
  "#quillEditor .ql-editor",
  ".ql-editor[contenteditable='true']",
  '[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"]',
];

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

async function firstVisible(
  page: Page,
  selectors: string[],
): Promise<string | null> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    const box = await loc.boundingBox().catch(() => null);
    if (box && box.width > 20 && box.height > 10) return sel;
  }
  return null;
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

async function clickTextLoose(page: Page, text: string, timeoutMs = 2500) {
  if (page.isClosed()) return false;
  const candidates = [
    page.getByRole("tab", { name: text, exact: true }),
    page.getByRole("button", { name: text, exact: true }),
    page.getByText(text, { exact: true }),
    page.locator(`div:text-is("${text}")`),
    page.locator(`span:text-is("${text}")`),
    page.getByText(text, { exact: false }),
  ];
  for (const loc of candidates) {
    const first = loc.first();
    if ((await first.count().catch(() => 0)) === 0) continue;
    if (!(await first.isVisible().catch(() => false))) continue;
    try {
      await first.click({ timeout: timeoutMs, force: true });
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

async function editorReady(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;
  const title = await firstVisible(page, TITLE_SELECTORS);
  const body = await firstVisible(page, BODY_SELECTORS);
  // 标题或正文任一就绪即可继续填（改版后两者不一定同时出现）
  return Boolean(title || body);
}

/** Leave upload-image landing and enter long-form editor. */
async function enterLongFormEditor(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;
  await dismissCommonOverlays(page);

  if (await editorReady(page)) return true;

  // Tab / entry labels seen across recent creator UI revisions
  for (const label of ["写长文", "长文", "文章", "笔记长文"]) {
    await clickTextLoose(page, label, 2000);
    if (!(await safeWait(page, 700))) return false;
    if (await editorReady(page)) return true;
  }

  for (const label of ["新的创作", "新建长文", "开始创作", "新建", "写一篇"]) {
    await clickTextLoose(page, label, 2000);
    if (!(await safeWait(page, 900))) return false;
    if (await editorReady(page)) return true;
  }

  await clickFirstVisible(page, [
    'button:has-text("新的创作")',
    'div.creator-button:has-text("新的创作")',
    'div:has-text("写长文")',
    '[class*="article"]:has-text("写长文")',
  ]).catch(() => undefined);

  await dismissCommonOverlays(page);
  return editorReady(page);
}

async function waitForLongFormEditor(
  page: Page,
  timeoutMs = 28_000,
): Promise<boolean> {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) return false;
    if (await editorReady(page)) return true;
    attempt += 1;
    if (attempt % 3 === 0) {
      await enterLongFormEditor(page);
    }
    if (!(await safeWait(page, 700))) return false;
  }
  return false;
}

async function insertHtmlIntoEditor(page: Page, selector: string, html: string) {
  await page.evaluate(
    ({ sel, htmlContent }) => {
      const editor = document.querySelector(sel) as HTMLElement | null;
      if (!editor) throw new Error(`Editor not found: ${sel}`);
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection?.removeAllRanges();
      selection?.addRange(range);
      let ok = false;
      if (typeof document.execCommand === "function") {
        ok = document.execCommand("insertHTML", false, htmlContent);
      }
      if (!ok) {
        editor.innerHTML = htmlContent;
      }
      editor.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }),
      );
      editor.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { sel: selector, htmlContent: html },
  );
}

async function fillLongForm(page: Page, content: PublishContent) {
  const title = content.title.slice(0, 20);
  const plain = (content.bodyText || content.bodyMarkdown || content.title).slice(
    0,
    8000,
  );
  const html = content.bodyHtml || `<p>${plain}</p>`;

  try {
    await fillBySelectors(page, TITLE_SELECTORS, title);
  } catch {
    await fillBySelectors(page, ["textarea"], title).catch(() => undefined);
  }

  const bodySel = await firstVisible(page, BODY_SELECTORS);
  if (!bodySel) {
    throw new Error("找不到正文编辑器");
  }

  const body = page.locator(bodySel).first();
  await body.click({ timeout: 8000 });
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press("Backspace");
  if (!(await safeWait(page, 120))) return;

  let filled = false;
  try {
    await insertHtmlIntoEditor(page, bodySel, html);
    filled = true;
  } catch {
    filled = false;
  }

  if (!filled) {
    const pasted = await pasteIntoFirst(
      page,
      BODY_SELECTORS,
      html,
      plain,
      "html",
    );
    filled = Boolean(pasted);
  }

  if (!filled) {
    await page.keyboard.type(plain.slice(0, 5000), { delay: 2 });
  }
}

async function maybeOneClickLayout(page: Page) {
  const clicked = await clickTextLoose(page, "一键排版", 3000);
  if (!clicked) return;
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    if (page.isClosed()) return;
    const url = page.url();
    if (/publish\/update|published=true/i.test(url)) return;
    if (await firstVisible(page, TITLE_POST_LAYOUT)) return;
    if (await page.getByText("图片编辑").first().isVisible().catch(() => false)) {
      return;
    }
    if (await page.getByText("下一步").first().isVisible().catch(() => false)) {
      return;
    }
    if (!(await safeWait(page, 1000))) return;
  }
}

async function gotoEditor(page: Page) {
  let lastErr: unknown;
  for (const url of EDITOR_URLS) {
    if (page.isClosed()) return;
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      // 避免 networkidle：小红书长连接会导致一直挂起
      await safeWait(page, 1200);
      await dismissCommonOverlays(page);
      if (!/\/login/i.test(page.url())) return;
    } catch (err) {
      lastErr = err;
      if (isClosedError(err)) throw err;
    }
  }
  if (lastErr) throw lastErr;
}

async function publish(
  page: Page,
  content: PublishContent,
): Promise<PublishResult> {
  try {
    await gotoEditor(page);
    if (page.isClosed()) {
      return {
        success: false,
        error: "小红书窗口已关闭，请重新同步",
        keepOpen: false,
      };
    }

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
    const ready = await waitForLongFormEditor(page, 28_000);
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

    const postTitleSel = await firstVisible(page, TITLE_POST_LAYOUT);
    if (postTitleSel) {
      await fillBySelectors(
        page,
        TITLE_POST_LAYOUT,
        content.title.slice(0, 20),
      ).catch(() => undefined);
    }

    return {
      success: true,
      outcome: "filled_awaiting_publish",
      awaitingUserPublish: true,
      draftOnly: true,
      url: page.url(),
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
  editorUrl: EDITOR_URLS[0],
  isLoggedIn,
  publish,
};
