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
  waitForUrlOrToast,
} from "@/lib/publishers/helpers";
import type { PlatformPublisher } from "@/lib/publishers/types";
import type { PublishContent, PublishResult } from "@/lib/types";

const EDITOR =
  "https://creator.xiaohongshu.com/publish/publish?target=article";
const LOGIN = "https://creator.xiaohongshu.com/login";

async function isLoggedIn(page: Page): Promise<boolean> {
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

async function publish(
  page: Page,
  content: PublishContent,
): Promise<PublishResult> {
  try {
    await page.goto(EDITOR, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);
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

    // Long-form: 新的创作
    await clickFirstVisible(page, [
      'button:has-text("新的创作")',
      'div:has-text("新的创作")',
      'span:has-text("新的创作")',
    ]).catch(() => undefined);
    await page.waitForTimeout(1500);

    const title = content.title.slice(0, 20);
    await fillBySelectors(
      page,
      [
        'textarea[placeholder*="输入标题"]',
        'input[placeholder*="输入标题"]',
        'textarea[placeholder*="标题"]',
        'div[contenteditable="true"][data-placeholder*="标题"]',
        '[placeholder*="填写标题"]',
      ],
      title,
    ).catch(() => undefined);

    const body =
      content.bodyText || content.bodyMarkdown || content.title;
    await pasteIntoFirst(
      page,
      [
        ".ql-editor",
        ".ProseMirror",
        'div[contenteditable="true"]',
        "textarea",
        '[data-placeholder*="正文"]',
      ],
      content.bodyHtml || `<p>${body}</p>`,
      body,
      "html",
    ).catch(async () => {
      await pasteIntoFirst(
        page,
        ['div[contenteditable="true"]', "textarea"],
        body,
        body,
        "text",
      );
    });

    await page.waitForTimeout(800);

    // Try layout → next, then draft; leave publish for human if blocked
    await clickFirstVisible(page, [
      'button:has-text("一键排版")',
      'button:has-text("下一步")',
      'button:has-text("暂存草稿")',
      'button:has-text("发布")',
    ]).catch(() => undefined);
    await page.waitForTimeout(1200);
    await clickFirstVisible(page, [
      'button:has-text("下一步")',
      'button:has-text("暂存草稿")',
      'button:has-text("发布")',
    ]).catch(() => undefined);

    const published = await waitForUrlOrToast(
      page,
      (url) =>
        /publish\/success|note\/|explore\//i.test(url) ||
        /creator\.xiaohongshu\.com\/new\/home/i.test(url),
      /发布成功|保存成功|已发布|暂存成功/,
      20_000,
    );

    if (published) {
      return { success: true, url: published };
    }

    return {
      success: false,
      error:
        "小红书未确认发布成功。请在打开的窗口补封面/标签后发布或暂存草稿；完成后请关闭窗口",
      screenshotPath: await captureDebugScreenshot(
        page,
        "xiaohongshu-await-manual",
      ),
      keepOpen: true,
    };
  } catch (err) {
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
  editorUrl: EDITOR,
  isLoggedIn,
  publish,
};
