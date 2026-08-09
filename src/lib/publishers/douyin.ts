import type { Page } from "playwright";
import {
  captureDebugScreenshot,
  clickFirstVisible,
} from "@/lib/publishers/browser";
import {
  dismissCommonOverlays,
  fillBySelectors,
  pasteIntoFirst,
  waitForUrlOrToast,
} from "@/lib/publishers/helpers";
import type { PlatformPublisher } from "@/lib/publishers/types";
import type { PublishContent, PublishResult } from "@/lib/types";

const EDITOR =
  "https://creator.douyin.com/creator-micro/content/post/image";
const LOGIN = "https://creator.douyin.com/";

/** Real login cookies only — guest pages also set passport_csrf_token / odin_tt. */
const SESSION_COOKIE_NAMES = new Set([
  "sessionid",
  "sessionid_ss",
  "sid_guard",
  "sid_tt",
]);

async function hasDouyinSessionCookie(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies([
    "https://creator.douyin.com",
    "https://www.douyin.com",
  ]);
  return cookies.some(
    (c) => SESSION_COOKIE_NAMES.has(c.name) && (c.value?.length ?? 0) > 10,
  );
}

async function hasDouyinLoginCard(page: Page): Promise<boolean> {
  const markers = [
    "text=扫码登录",
    "text=手机号登录",
    "text=验证码登录",
    "text=请使用抖音APP扫码",
    "text=打开抖音扫一扫",
    '[class*="login-card"]',
    '[class*="loginCard"]',
    '[class*="qr-code"]',
    '[class*="qrcode"]',
  ];
  for (const sel of markers) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (await loc.isVisible().catch(() => false)) return true;
  }
  return false;
}

async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  // Passport / SSO / explicit login routes
  if (/passport|sso\.|\/login\b|account\/login|scan\/login/i.test(url)) {
    return false;
  }
  // Creator home often shows QR modal while still on creator.douyin.com/
  if (await hasDouyinLoginCard(page)) return false;
  return hasDouyinSessionCookie(page);
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
    await page.waitForTimeout(3000);
    await dismissCommonOverlays(page);

    // Dismiss draft restore
    await clickFirstVisible(page, [
      'button:has-text("取消")',
      'button:has-text("不恢复")',
      'button:has-text("放弃")',
      'div:has-text("取消")',
    ]).catch(() => undefined);

    await clickFirstVisible(page, [
      'div[class*="tab"]:has-text("发布图文")',
      'span:has-text("发布图文")',
      'div:has-text("发布图文")',
    ]).catch(() => undefined);
    await page.waitForTimeout(1000);

    if (!(await isLoggedIn(page)) || /passport|\/login/i.test(page.url())) {
      return {
        success: false,
        error: "抖音未登录或登录已过期，请先在「账号」页扫码连接",
        screenshotPath: await captureDebugScreenshot(page, "douyin-not-login"),
        keepOpen: true,
      };
    }

    const title = content.title.slice(0, 20);
    await fillBySelectors(
      page,
      [
        'input[placeholder*="作品标题"]',
        'input[placeholder*="添加作品标题"]',
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
      ],
      title,
    ).catch(() => undefined);

    const desc = (
      content.bodyText ||
      content.bodyMarkdown ||
      content.title
    ).slice(0, 1000);
    await pasteIntoFirst(
      page,
      [
        "div.editor-comp-publish[contenteditable='true']",
        ".editor-comp-publish",
        'div[contenteditable="true"]',
        "textarea",
        ".ProseMirror",
      ],
      desc,
      desc,
      "text",
    ).catch(() => undefined);

    // Prefer draft; image upload usually required before publish
    await clickFirstVisible(page, [
      'button:has-text("暂存离开")',
      'button:has-text("存草稿")',
      'button:has-text("暂存")',
      'button:has-text("发布")',
    ]).catch(() => undefined);

    const published = await waitForUrlOrToast(
      page,
      (url) =>
        /content\/manage|content\/post\/success|creator-micro\/content/i.test(
          url,
        ),
      /发布成功|保存成功|已发布|暂存成功|草稿/,
      18_000,
    );

    if (published) {
      return { success: true, url: published };
    }

    return {
      success: false,
      error:
        "抖音图文未确认成功（通常需上传图片）。请在打开的窗口补图后存草稿/发布；完成后请关闭窗口",
      screenshotPath: await captureDebugScreenshot(
        page,
        "douyin-await-manual",
      ),
      keepOpen: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `${message}（完成后请关闭窗口，才会开始下一个平台）`,
      screenshotPath: await captureDebugScreenshot(page, "douyin-error"),
      keepOpen: true,
    };
  }
}

export const douyinPublisher: PlatformPublisher = {
  id: "douyin",
  name: "抖音图文",
  loginUrl: LOGIN,
  editorUrl: EDITOR,
  isLoggedIn,
  publish,
};
