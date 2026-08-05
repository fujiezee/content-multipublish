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

const HOME = "https://mp.weixin.qq.com/";

async function isLoggedIn(page: Page): Promise<boolean> {
  if (/loginpage|login\?|passport/i.test(page.url())) return false;
  return hasCookieMatch(
    page,
    ["https://mp.weixin.qq.com"],
    /slave_sid|slave_user|data_bizuin|bizuin|ticket/i,
  );
}

async function openNewArticle(page: Page) {
  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2500);
  await dismissCommonOverlays(page);

  // New graphic post entry varies by MP UI version
  const entries = [
    'a:has-text("新的创作")',
    'a:has-text("写新图文")',
    'button:has-text("新的创作")',
    'a[href*="appmsg"]',
    'text=新的创作',
    'text=写文章',
  ];
  for (const sel of entries) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    break;
  }

  // Prefer 图文
  const graphic = page.getByText("图文", { exact: false }).first();
  if (
    (await graphic.count()) > 0 &&
    (await graphic.isVisible().catch(() => false))
  ) {
    await graphic.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(2000);
  }
}

async function publish(page: Page, content: PublishContent): Promise<PublishResult> {
  try {
    await openNewArticle(page);

    if (!(await isLoggedIn(page)) || /loginpage|login\?/i.test(page.url())) {
      return {
        success: false,
        error: "微信公众号未登录或登录已过期，请先在「账号」页扫码连接",
        screenshotPath: await captureDebugScreenshot(page, "weixin-not-login"),
        keepOpen: true,
      };
    }

    await fillBySelectors(
      page,
      [
        'textarea[placeholder*="请在这里输入标题"]',
        'input[placeholder*="请在这里输入标题"]',
        '#title',
        'textarea[placeholder*="标题"]',
        'input[placeholder*="标题"]',
      ],
      content.title.slice(0, 64),
    ).catch(() => undefined);

    await pasteIntoFirst(
      page,
      [
        "#edui1_iframeholder iframe",
        "iframe.edui-editor-iframeholder",
        ".ProseMirror",
        'div[contenteditable="true"]',
        "body.view",
      ],
      content.bodyHtml,
      content.bodyText,
      "html",
    ).catch(async () => {
      // UEditor iframe body
      for (const frame of page.frames()) {
        try {
          const body = frame.locator('body[contenteditable="true"], body.view');
          if ((await body.count()) === 0) continue;
          await body.first().click({ timeout: 5000 });
          await page.evaluate(
            async ({ html, plain }) => {
              try {
                await navigator.clipboard.write([
                  new ClipboardItem({
                    "text/html": new Blob([html], { type: "text/html" }),
                    "text/plain": new Blob([plain], { type: "text/plain" }),
                  }),
                ]);
              } catch {
                await navigator.clipboard.writeText(plain);
              }
            },
            { html: content.bodyHtml, plain: content.bodyText },
          );
          const mod = process.platform === "darwin" ? "Meta" : "Control";
          await page.keyboard.press(`${mod}+a`);
          await page.keyboard.press(`${mod}+v`);
          return;
        } catch {
          // next
        }
      }
    });

    await page.waitForTimeout(800);

    // Prefer save draft; try publish if available
    const draftBtns = [
      'button:has-text("保存为草稿")',
      'a:has-text("保存为草稿")',
      'button:has-text("保存草稿")',
      'button:has-text("保存")',
    ];
    let saved = false;
    for (const sel of draftBtns) {
      const btn = page.locator(sel).first();
      if ((await btn.count()) === 0) continue;
      if (!(await btn.isVisible().catch(() => false))) continue;
      await btn.click({ timeout: 5000 }).catch(() => undefined);
      saved = true;
      await page.waitForTimeout(1500);
      break;
    }

    await clickFirstVisible(page, [
      'button:has-text("发表")',
      'button:has-text("群发")',
      'a:has-text("发表")',
    ]).catch(() => undefined);

    const published = await waitForUrlOrToast(
      page,
      (url) => /mp\.weixin\.qq\.com\/cgi-bin\/appmsg/i.test(url) || /home/i.test(url),
      /保存成功|已保存|发表成功|提交成功/,
      20_000,
    );

    if (published || saved) {
      return {
        success: true,
        url: page.url(),
      };
    }

    return {
      success: false,
      error:
        "微信公众号未确认保存/发表成功。请在打开的窗口补封面与作者后保存草稿或发表；完成后请关闭窗口",
      screenshotPath: await captureDebugScreenshot(page, "weixin-not-published"),
      keepOpen: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `${message}（完成后请关闭窗口，才会开始下一个平台）`,
      screenshotPath: await captureDebugScreenshot(page, "weixin-error"),
      keepOpen: true,
    };
  }
}

export const weixinPublisher: PlatformPublisher = {
  id: "weixin",
  name: "微信公众号",
  loginUrl: HOME,
  editorUrl: HOME,
  isLoggedIn,
  publish,
};
