import type { Page } from "playwright";
import {
  captureDebugScreenshot,
  clickFirstVisible,
} from "@/lib/publishers/browser";
import type { PlatformPublisher } from "@/lib/publishers/types";
import type { PlatformId, PublishContent, PublishResult } from "@/lib/types";

export async function writeClipboardHtml(
  page: Page,
  html: string,
  plain: string,
) {
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

export async function writeClipboardText(page: Page, text: string) {
  await page.evaluate(async (t) => {
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      // ignore
    }
  }, text);
}

export async function dismissCommonOverlays(page: Page) {
  const closes = page.locator(
    [
      'button:has-text("我知道了")',
      'button:has-text("知道了")',
      'button:has-text("关闭")',
      'button:has-text("跳过")',
      'button:has-text("以后再说")',
      '[aria-label="关闭"]',
      ".el-dialog__headerbtn",
      ".ant-modal-close",
      ".byte-modal-close",
    ].join(", "),
  );
  const n = await closes.count();
  for (let i = 0; i < Math.min(n, 4); i++) {
    await closes
      .nth(i)
      .click({ timeout: 1200 })
      .catch(() => undefined);
  }
}

export async function fillBySelectors(
  page: Page,
  selectors: string[],
  value: string,
) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.click({ timeout: 5000 }).catch(() => undefined);
    try {
      await loc.fill(value);
    } catch {
      const mod = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.press(`${mod}+a`);
      await page.keyboard.type(value, { delay: 12 });
    }
    return sel;
  }
  throw new Error(`找不到输入框: ${selectors.slice(0, 3).join(", ")}`);
}

export async function pasteIntoFirst(
  page: Page,
  selectors: string[],
  html: string,
  plain: string,
  mode: "html" | "text" = "html",
) {
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    const clicked = await loc
      .click({ timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) continue;
    await page.keyboard.press(`${mod}+a`);
    if (mode === "html") {
      await writeClipboardHtml(page, html, plain);
    } else {
      await writeClipboardText(page, plain);
    }
    await page.keyboard.press(`${mod}+v`);
    await page.waitForTimeout(700);
    return sel;
  }

  // CodeMirror API
  if (mode === "text") {
    const viaCm = await page.evaluate((md) => {
      const cms = document.querySelectorAll(".CodeMirror");
      for (const node of cms) {
        const cm = (
          node as unknown as { CodeMirror?: { setValue: (v: string) => void } }
        ).CodeMirror;
        if (cm?.setValue) {
          cm.setValue(md);
          return true;
        }
      }
      return false;
    }, plain);
    if (viaCm) return "CodeMirror";
  }

  throw new Error(`找不到正文编辑器: ${selectors.slice(0, 3).join(", ")}`);
}

export async function clickPublishButtons(
  page: Page,
  primary: string[],
  confirms: string[] = [],
) {
  await dismissCommonOverlays(page);
  await clickFirstVisible(page, primary);
  await page.waitForTimeout(1200);
  await dismissCommonOverlays(page);
  for (const sel of confirms) {
    const btn = page.locator(sel).last();
    if ((await btn.count()) === 0) continue;
    if (!(await btn.isVisible().catch(() => false))) continue;
    if (await btn.isDisabled().catch(() => false)) continue;
    await btn.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
    break;
  }
}

export async function waitForUrlOrToast(
  page: Page,
  isSuccessUrl: (url: string) => boolean,
  toastPattern: RegExp,
  timeoutMs: number,
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const p of page.context().pages()) {
      if (isSuccessUrl(p.url())) return p.url();
    }
    const toast = page.getByText(toastPattern);
    if ((await toast.count()) > 0) {
      await page.waitForTimeout(1200);
      for (const p of page.context().pages()) {
        if (isSuccessUrl(p.url())) return p.url();
      }
      return page.url();
    }
    await page.waitForTimeout(1000);
  }
  for (const p of page.context().pages()) {
    if (isSuccessUrl(p.url())) return p.url();
  }
  return null;
}

export async function hasCookieMatch(
  page: Page,
  origins: string[],
  namePattern: RegExp,
) {
  const cookies = await page.context().cookies(origins);
  return cookies.some((c) => namePattern.test(c.name) && Boolean(c.value));
}

export type SimplePublisherConfig = {
  id: PlatformId;
  name: string;
  loginUrl: string;
  editorUrl: string;
  cookieOrigins: string[];
  cookieNamePattern: RegExp;
  loginUrlPattern: RegExp;
  titleSelectors: string[];
  titleMaxLen: number;
  bodySelectors: string[];
  bodyMode: "html" | "text";
  publishButtons: string[];
  confirmButtons?: string[];
  successUrl: (url: string) => boolean;
  isEditorUrl?: (url: string) => boolean;
  toastPattern?: RegExp;
  afterFill?: (page: Page, content: PublishContent) => Promise<void>;
  notLoginMessage?: string;
};

export function createSimplePublisher(
  cfg: SimplePublisherConfig,
): PlatformPublisher {
  const toast =
    cfg.toastPattern ?? /发布成功|提交成功|已发布|保存成功|发表成功/;

  async function isLoggedIn(page: Page): Promise<boolean> {
    if (cfg.loginUrlPattern.test(page.url())) return false;
    if (await hasCookieMatch(page, cfg.cookieOrigins, cfg.cookieNamePattern)) {
      return true;
    }
    // editor chrome fallback
    for (const sel of cfg.titleSelectors.slice(0, 2)) {
      const loc = page.locator(sel).first();
      if (
        (await loc.count()) > 0 &&
        (await loc.isVisible().catch(() => false))
      ) {
        return !cfg.loginUrlPattern.test(page.url());
      }
    }
    return false;
  }

  async function publish(
    page: Page,
    content: PublishContent,
  ): Promise<PublishResult> {
    try {
      await page.goto(cfg.editorUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(2500);
      await dismissCommonOverlays(page);

      if (
        cfg.loginUrlPattern.test(page.url()) ||
        !(await isLoggedIn(page))
      ) {
        return {
          success: false,
          error:
            cfg.notLoginMessage ??
            `${cfg.name}未登录或登录已过期，请先在「账号」页重新连接`,
          screenshotPath: await captureDebugScreenshot(
            page,
            `${cfg.id}-not-login`,
          ),
          keepOpen: true,
        };
      }

      const title = content.title.slice(0, cfg.titleMaxLen);
      await fillBySelectors(page, cfg.titleSelectors, title);
      await page.waitForTimeout(400);

      const html = content.bodyHtml || `<p>${content.bodyText || ""}</p>`;
      const plain =
        cfg.bodyMode === "text"
          ? content.bodyMarkdown || content.bodyText
          : content.bodyText || content.bodyMarkdown;
      await pasteIntoFirst(page, cfg.bodySelectors, html, plain, cfg.bodyMode);
      await page.waitForTimeout(600);

      if (cfg.afterFill) {
        await cfg.afterFill(page, content).catch(() => undefined);
      }

      await clickPublishButtons(
        page,
        cfg.publishButtons,
        cfg.confirmButtons ?? [
          'button:has-text("确认发布")',
          'button:has-text("确定并发布")',
          'button:has-text("确认")',
          'button:has-text("确定")',
          'button:has-text("发布")',
        ],
      );

      let published = await waitForUrlOrToast(
        page,
        cfg.successUrl,
        toast,
        25_000,
      );
      if (published) {
        return { success: true, url: published };
      }

      await captureDebugScreenshot(page, `${cfg.id}-await-manual`);
      published = await waitForUrlOrToast(page, cfg.successUrl, toast, 3 * 60_000);
      if (published) {
        return { success: true, url: published };
      }

      return {
        success: false,
        error: `${cfg.name}未确认发布成功。请在打开的窗口补全必填项后发布；完成后请关闭该窗口，才会开始下一个平台`,
        screenshotPath: await captureDebugScreenshot(
          page,
          `${cfg.id}-not-published`,
        ),
        keepOpen: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `${message}（完成后请关闭窗口，才会开始下一个平台）`,
        screenshotPath: await captureDebugScreenshot(page, `${cfg.id}-error`),
        keepOpen: true,
      };
    }
  }

  return {
    id: cfg.id,
    name: cfg.name,
    loginUrl: cfg.loginUrl,
    editorUrl: cfg.editorUrl,
    isLoggedIn,
    publish,
  };
}
