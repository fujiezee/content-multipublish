import type { Page } from "playwright";
import { captureDebugScreenshot } from "@/lib/publishers/browser";
import {
  dismissCommonOverlays,
  fillBySelectors,
  pasteIntoFirst,
} from "@/lib/publishers/helpers";
import type { PlatformPublisher } from "@/lib/publishers/types";
import type { PublishContent, PublishResult } from "@/lib/types";
import fs from "fs/promises";
import path from "path";
import os from "os";

const EDITOR_URL = "https://cp.11467.com/Home/product/product_add";
const LOGIN = "https://cp.11467.com/home/login/index";

const TITLE_SELECTORS = [
  'input[name="name"]',
  'input[name="product_name"]',
  'input[name="title"]',
  'input#name',
  'input[placeholder*="产品名称"]',
  'input[placeholder*="名称"]',
];

const BODY_SELECTORS = [
  ".ql-editor",
  ".ProseMirror",
  ".w-e-text",
  'div[contenteditable="true"]',
  'textarea[name="content"]',
  'textarea[name="description"]',
  "textarea#editor",
  "textarea#content",
  "textarea",
];

async function isLoggedIn(page: Page): Promise<boolean> {
  if (/\/login|nologin/i.test(page.url())) return false;
  const titleVisible = await page
    .locator(TITLE_SELECTORS.join(", "))
    .first()
    .isVisible()
    .catch(() => false);
  if (titleVisible) return true;
  const loginCopy = await page
    .getByText(/欢迎回来|请输入手机号/)
    .count()
    .catch(() => 0);
  return loginCopy === 0 && /cp\.11467\.com/i.test(page.url());
}

async function fillUEditor(page: Page, html: string): Promise<boolean> {
  return page
    .evaluate((htmlContent) => {
      try {
        const UE = (
          window as unknown as {
            UE?: {
              getEditor?: (id: string) => {
                setContent: (h: string) => void;
                isDestroyed?: () => boolean;
              };
              instances?: Record<string, { setContent: (h: string) => void }>;
              instants?: Record<string, { setContent: (h: string) => void }>;
            };
          }
        ).UE;
        if (!UE?.getEditor) return false;
        for (const id of [
          "editor",
          "content",
          "product_content",
          "description",
          "body",
        ]) {
          try {
            const ed = UE.getEditor(id);
            if (ed && !ed.isDestroyed?.()) {
              ed.setContent(htmlContent);
              return true;
            }
          } catch {
            // next
          }
        }
        const list = UE.instances || UE.instants;
        if (list) {
          const key = Object.keys(list)[0];
          if (key) {
            list[key].setContent(htmlContent);
            return true;
          }
        }
      } catch {
        // ignore
      }
      return false;
    }, html)
    .catch(() => false);
}

function collectImageUrls(content: PublishContent): string[] {
  const urls: string[] = [];
  const push = (u?: string | null) => {
    const s = String(u || "").trim();
    if (!s || !/^https?:\/\//i.test(s)) return;
    if (!urls.includes(s)) urls.push(s);
  };
  push(content.coverPath);
  const html = content.bodyHtml || "";
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) push(m[1]);
  return urls.slice(0, 9);
}

async function downloadToTemp(urls: string[]): Promise<string[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shunqi-product-"));
  const files: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const res = await fetch(urls[i]);
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    const ctype = res.headers.get("content-type") || "";
    const ext = /png/i.test(ctype)
      ? "png"
      : /webp/i.test(ctype)
        ? "webp"
        : "jpg";
    const file = path.join(dir, `p${i}.${ext}`);
    await fs.writeFile(file, buf);
    files.push(file);
  }
  return files;
}

async function publish(
  page: Page,
  content: PublishContent,
): Promise<PublishResult> {
  try {
    await page.goto(EDITOR_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2200);
    await dismissCommonOverlays(page);

    if (!(await isLoggedIn(page))) {
      return {
        success: false,
        error: "顺企网未登录或登录已过期，请先在「账号」页重新连接",
        screenshotPath: await captureDebugScreenshot(
          page,
          "shunqi-product-not-login",
        ),
        keepOpen: true,
      };
    }

    const title = content.title.slice(0, 80);
    await fillBySelectors(page, TITLE_SELECTORS, title);
    await page.waitForTimeout(400);

    const imageUrls = collectImageUrls(content);
    if (imageUrls.length) {
      const files = await downloadToTemp(imageUrls);
      if (files.length) {
        const fileInput = page.locator('input[type="file"]').first();
        if ((await fileInput.count()) > 0) {
          await fileInput.setInputFiles(files).catch(() => undefined);
          await page.waitForTimeout(800);
        }
      }
    }

    const html = content.bodyHtml || `<p>${content.bodyText || ""}</p>`;
    const filledUe = await fillUEditor(page, html);
    if (!filledUe) {
      await pasteIntoFirst(
        page,
        BODY_SELECTORS,
        html,
        content.bodyText || content.bodyMarkdown,
        "html",
      );
    }
    await page.waitForTimeout(500);

    return {
      success: true,
      outcome: "filled_awaiting_publish",
      awaitingUserPublish: true,
      draftOnly: true,
      url: page.url(),
      error:
        "顺企网产品已填入名称/详情/图片。请在打开的窗口确认后点「发布」；完成后请关闭窗口，才会开始下一个平台",
      screenshotPath: await captureDebugScreenshot(
        page,
        "shunqi-product-await-manual",
      ),
      keepOpen: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `${message}（完成后请关闭窗口，才会开始下一个平台）`,
      screenshotPath: await captureDebugScreenshot(page, "shunqi-product-error"),
      keepOpen: true,
    };
  }
}

export const shunqiProductPublisher: PlatformPublisher = {
  id: "shunqi_product",
  name: "顺企网产品",
  loginUrl: LOGIN,
  editorUrl: EDITOR_URL,
  isLoggedIn,
  publish,
};
