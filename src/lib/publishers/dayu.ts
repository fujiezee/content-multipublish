import type { Page } from "playwright";
import { captureDebugScreenshot } from "@/lib/publishers/browser";
import { createSimplePublisher } from "@/lib/publishers/helpers";
import type { PlatformPublisher } from "@/lib/publishers/types";
import type { PublishContent, PublishResult } from "@/lib/types";

const EDITOR = "https://mp.dayu.com/#/article/write";

const base = createSimplePublisher({
  id: "dayu",
  name: "大鱼号",
  loginUrl: "https://mp.dayu.com/",
  editorUrl: EDITOR,
  cookieOrigins: [
    "https://mp.dayu.com",
    "https://www.dayu.com",
    "https://id.dayu.com",
    "https://passport.uc.cn",
  ],
  // Cookie 名在游客态也会出现，登录判定不依赖它（见 isDayuLoggedIn）
  cookieNamePattern: /^__dayu_never_match_guest_cookie__$/i,
  loginUrlPattern: /login|passport/i,
  titleSelectors: [
    'textarea[placeholder*="标题"]',
    'input[placeholder*="标题"]',
    'input[placeholder*="请输入标题"]',
  ],
  titleMaxLen: 64,
  bodySelectors: [
    ".ql-editor",
    ".ProseMirror",
    'div[contenteditable="true"]',
    "textarea",
  ],
  bodyMode: "html",
  publishButtons: [
    'button:has-text("发布")',
    'button:has-text("发表")',
    'a:has-text("发布")',
  ],
  successUrl: (url) =>
    /mp\.dayu\.com/i.test(url) && !/write|edit/i.test(url),
  notLoginMessage: "大鱼号未登录或登录已过期，请先在「账号」页扫码连接",
});

async function isDayuLoggedIn(page: Page): Promise<boolean> {
  try {
    if (page.isClosed()) return false;
    if (/passport|\blogin\b/i.test(page.url())) return false;

    // Guest / QR gate — never treat as logged in
    if (
      (await page
        .getByText(/扫码登录|请使用UC浏览器扫码|正在生成二维码|浏览器扫码登录/)
        .count()
        .catch(() => 0)) > 0
    ) {
      return false;
    }

    // Require article editor chrome
    const title = page
      .locator(
        'textarea[placeholder*="标题"], input[placeholder*="标题"], input[placeholder*="请输入标题"]',
      )
      .first();
    if (
      (await title.count()) > 0 &&
      (await title.isVisible().catch(() => false))
    ) {
      return true;
    }

    // Logged-in console home (no QR)
    return (
      (await page
        .getByText(/写文章|内容管理|数据中心|账号设置/)
        .count()
        .catch(() => 0)) > 0
    );
  } catch {
    return false;
  }
}

async function publish(
  page: Page,
  content: PublishContent,
): Promise<PublishResult> {
  await page.goto(EDITOR, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(2500);

  if (!(await isDayuLoggedIn(page))) {
    return {
      success: false,
      error: "大鱼号未登录或登录已过期，请先在「账号」页扫码连接",
      screenshotPath: await captureDebugScreenshot(page, "dayu-not-login"),
      keepOpen: true,
    };
  }

  return base.publish(page, content);
}

export const dayuPublisher: PlatformPublisher = {
  id: "dayu",
  name: "大鱼号",
  loginUrl: "https://mp.dayu.com/",
  editorUrl: EDITOR,
  isLoggedIn: isDayuLoggedIn,
  publish,
};
