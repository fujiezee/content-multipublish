import type { Page } from "playwright";
import {
  captureDebugScreenshot,
  clickFirstVisible,
  fillFirstVisible,
} from "@/lib/publishers/browser";
import type { PlatformPublisher } from "@/lib/publishers/types";
import type { PublishContent, PublishResult } from "@/lib/types";

const EDITOR_URL = "https://mp.csdn.net/mp_blog/creation/editor";
const LOGIN_URL = "https://passport.csdn.net/login";

const AUTH_COOKIE_NAMES = [
  "UserName",
  "UserToken",
  "UserInfo",
  "c_token",
  "uuid_tt_dd",
  "log_Id_aa",
];

function isEditorUrl(url: string) {
  return (
    /mp\.csdn\.net\/mp_blog\/creation\/editor/i.test(url) ||
    /editor\.csdn\.net/i.test(url)
  );
}

function isPublishedUrl(url: string) {
  if (isEditorUrl(url)) return false;
  if (/passport\.csdn\.net|login/i.test(url)) return false;
  return (
    /blog\.csdn\.net\/[^/]+\/article\/details\/\d+/i.test(url) ||
    /mp\.csdn\.net\/mp_blog\/manage/i.test(url) ||
    /article_id=\d+/i.test(url)
  );
}

async function hasAuthCookies(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies([
    "https://www.csdn.net",
    "https://mp.csdn.net",
    "https://passport.csdn.net",
    "https://blog.csdn.net",
    "https://editor.csdn.net",
  ]);
  return cookies.some(
    (c) =>
      AUTH_COOKIE_NAMES.includes(c.name) ||
      (/^(UserName|UserToken|UserInfo|c_token)$/i.test(c.name) && Boolean(c.value)),
  );
}

async function hasEditorChrome(page: Page): Promise<boolean> {
  const title = page.locator(
    'input[placeholder*="请输入文章标题"], input[placeholder*="文章标题"]',
  );
  const publish = page.locator('button:has-text("发布文章"), button:has-text("发布")');
  if ((await title.count()) > 0 && (await title.first().isVisible().catch(() => false))) {
    return true;
  }
  if ((await publish.count()) > 0 && (await publish.first().isVisible().catch(() => false))) {
    return true;
  }
  return false;
}

async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (/passport\.csdn\.net\/login/i.test(url)) return false;

  if (await hasEditorChrome(page)) return true;
  if (await hasAuthCookies(page)) {
    if (isEditorUrl(url) || /csdn\.net/i.test(url)) return true;
  }
  return false;
}

async function dismissOverlays(page: Page) {
  await page
    .evaluate(() => {
      document
        .querySelectorAll(
          ".mark-mask-box-div, .el-loading-mask, .csdn-cookie-notice, .passport-login-tip",
        )
        .forEach((el) => el.remove());
    })
    .catch(() => undefined);

  const closeBtns = page.locator(
    'button:has-text("我知道了"), button:has-text("关闭"), .el-dialog__headerbtn, .el-message-box__close',
  );
  if ((await closeBtns.count()) > 0) {
    await closeBtns.first().click({ timeout: 2000 }).catch(() => undefined);
  }
}

const TITLE_SELECTORS = [
  '.article-bar input[placeholder*="请输入文章标题"]',
  '.article-bar input[placeholder*="文章标题"]',
  'input[placeholder*="请输入文章标题"]',
  'input[placeholder*="文章标题"]',
  "#txtTitle",
];

/** Avoid pasting body into the title field (Meta+A after title fill). */
async function fillTitle(page: Page, title: string) {
  const value = title.slice(0, 100);
  for (const sel of TITLE_SELECTORS) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;

    await loc.click({ timeout: 5000 });
    await loc.fill("");
    const ok = await loc
      .evaluate((el, text) => {
        const input = el as HTMLInputElement;
        const proto = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        );
        proto?.set?.call(input, text);
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
        return (input.value || "").trim().length > 0;
      }, value)
      .catch(() => false);

    if (!ok) {
      await loc.fill(value).catch(() => undefined);
    }

    const current = ((await loc.inputValue().catch(() => "")) || "").trim();
    if (current === value || current.includes(value.slice(0, Math.min(8, value.length)))) {
      await page.waitForTimeout(300);
      return;
    }
  }
  throw new Error("找不到 CSDN 标题输入框");
}

function stripLeadingTitleFromHtml(html: string, title: string): string {
  const t = title.trim();
  if (!t || !html) return html;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html
    .replace(new RegExp(`^\\s*<h1[^>]*>\\s*${escaped}\\s*</h1>\\s*`, "i"), "")
    .replace(new RegExp(`^\\s*<p[^>]*>\\s*${escaped}\\s*</p>\\s*`, "i"), "")
    .trim();
}

async function isTitleFocused(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement | null;
    if (!el || el.tagName !== "INPUT") return false;
    const ph = (el.getAttribute("placeholder") || "").toLowerCase();
    return ph.includes("标题") || ph.includes("title");
  });
}

/** CSDN default editor is CKEditor rich text — paste HTML, not Markdown. */
async function pasteRichHtml(page: Page, html: string, plain: string) {
  // 1) Preferred: CKEditor API
  const viaCk = await page.evaluate((h) => {
    const w = window as unknown as {
      CKEDITOR?: {
        instances?: Record<
          string,
          { setData: (v: string) => void; getData?: () => string }
        >;
      };
    };
    const instances = w.CKEDITOR?.instances;
    if (!instances) return false;
    const first = Object.values(instances)[0];
    if (!first?.setData) return false;
    first.setData(h);
    return true;
  }, html);
  if (viaCk) {
    await page.waitForTimeout(600);
    const ok = await page.evaluate(() => {
      const w = window as unknown as {
        CKEDITOR?: {
          instances?: Record<string, { getData?: () => string }>;
        };
      };
      const first = Object.values(w.CKEDITOR?.instances || {})[0];
      const data = first?.getData?.() || "";
      return data.replace(/<[^>]+>/g, "").trim().length > 0;
    });
    if (ok) return;
  }

  // 2) Paste HTML into CKEditor iframe body
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  for (const frame of page.frames()) {
    try {
      const editable = frame.locator(
        'body[contenteditable="true"], body.cke_editable',
      );
      if ((await editable.count()) === 0) continue;
      const target = editable.first();
      if (!(await target.isVisible().catch(() => false))) continue;

      await target.click({ timeout: 8000 });
      if (await isTitleFocused(page)) continue;

      // Direct HTML inject
      const injected = await frame.evaluate((h) => {
        const el = document.body;
        if (!el || el.getAttribute("contenteditable") !== "true") return false;
        el.focus();
        el.innerHTML = h;
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return (el.textContent || "").trim().length > 0;
      }, html);
      if (injected) {
        await page.waitForTimeout(400);
        return;
      }

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
      await page.keyboard.press(`${mod}+a`);
      if (await isTitleFocused(page)) continue;
      await page.keyboard.press(`${mod}+v`);
      await page.waitForTimeout(600);
      return;
    } catch {
      // next frame
    }
  }

  // 3) If user switched to MD editor, fall back to markdown-ish plain paste
  const mdTargets = [
    ".editor .cledit-section",
    ".CodeMirror",
    ".cledit-section",
  ];
  for (const sel of mdTargets) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    const clicked = await loc
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked || (await isTitleFocused(page))) continue;
    await page.evaluate(async (text) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // ignore
      }
    }, plain);
    await page.keyboard.press(`${mod}+a`);
    if (await isTitleFocused(page)) continue;
    await page.keyboard.press(`${mod}+v`);
    await page.waitForTimeout(600);
    return;
  }

  throw new Error("找不到 CSDN 富文本编辑器");
}

async function clickPublishFlow(page: Page, summary: string) {
  await dismissOverlays(page);

  await clickFirstVisible(page, [
    'button.btn-publish:has-text("发布文章")',
    'button:has-text("发布文章")',
    'button:has-text("发布博客")',
    'button:has-text("发布")',
  ]);
  await page.waitForTimeout(1500);
  await dismissOverlays(page);

  // Optional summary in publish modal
  if (summary) {
    try {
      await fillFirstVisible(
        page,
        [
          'textarea[placeholder*="摘要"]',
          '.desc-box textarea',
          'textarea[placeholder*="文章摘要"]',
        ],
        summary.slice(0, 256),
      );
    } catch {
      // optional
    }
  }

  // Try add a default tag if required
  const tagInput = page.locator(
    'input[placeholder*="标签"], input[placeholder*="文章标签"], .tag-input input',
  ).first();
  if ((await tagInput.count()) > 0 && (await tagInput.isVisible().catch(() => false))) {
    await tagInput.fill("经验分享").catch(() => undefined);
    await page.keyboard.press("Enter").catch(() => undefined);
    await page.waitForTimeout(500);
  }

  const confirms = [
    '.modal__button-bar button:has-text("发布文章")',
    'button:has-text("确认发布")',
    'button:has-text("确定并发布")',
    'button:has-text("发布文章")',
    'button:has-text("确定")',
  ];
  for (const sel of confirms) {
    const btn = page.locator(sel).last();
    if ((await btn.count()) === 0) continue;
    if (!(await btn.isVisible().catch(() => false))) continue;
    if (await btn.isDisabled().catch(() => false)) continue;
    await btn.click({ timeout: 5000, force: true }).catch(() => undefined);
    await page.waitForTimeout(1200);
    break;
  }
}

async function waitForPublished(page: Page, timeoutMs: number): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const p of page.context().pages()) {
      if (isPublishedUrl(p.url())) return p.url();
    }
    const toast = page.locator("text=/发布成功|提交成功|已发布/");
    if ((await toast.count()) > 0) {
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

async function publish(page: Page, content: PublishContent): Promise<PublishResult> {
  try {
    await page.goto(EDITOR_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(3000);
    await dismissOverlays(page);

    if (
      /passport\.csdn\.net\/login/i.test(page.url()) ||
      !(await isLoggedIn(page))
    ) {
      return {
        success: false,
        error: "CSDN 未登录或登录已过期，请先在「账号」页重新连接",
        screenshotPath: await captureDebugScreenshot(page, "csdn-not-login"),
        keepOpen: true,
      };
    }

    await fillTitle(page, content.title);

    const bodyHtml = stripLeadingTitleFromHtml(
      content.bodyHtml || `<p>${content.bodyText}</p>`,
      content.title,
    );
    await pasteRichHtml(
      page,
      bodyHtml,
      content.bodyText || content.bodyMarkdown,
    );
    await page.waitForTimeout(800);

    // Body paste can wipe title — refill
    await fillTitle(page, content.title).catch(() => undefined);
    await page.waitForTimeout(400);

    await clickPublishFlow(page, content.summary);

    let published = await waitForPublished(page, 25_000);
    if (published) {
      return { success: true, url: published };
    }

    await captureDebugScreenshot(page, "csdn-await-manual");
    published = await waitForPublished(page, 3 * 60_000);
    if (published) {
      return { success: true, url: published };
    }

    return {
      success: false,
      error:
        "CSDN 未确认发布成功。请在打开的窗口补全标签/分类后点「发布文章」（如需扫码请完成验证）；完成后请关闭该窗口，才会开始下一个平台",
      screenshotPath: await captureDebugScreenshot(page, "csdn-not-published"),
      keepOpen: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
      screenshotPath: await captureDebugScreenshot(page, "csdn-error"),
      keepOpen: true,
    };
  }
}

export const csdnPublisher: PlatformPublisher = {
  id: "csdn",
  name: "CSDN",
  loginUrl: LOGIN_URL,
  editorUrl: EDITOR_URL,
  isLoggedIn,
  publish,
};
