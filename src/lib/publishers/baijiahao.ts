import type { Frame, Page } from "playwright";
import {
  captureDebugScreenshot,
  clickFirstVisible,
} from "@/lib/publishers/browser";
import type { PlatformPublisher } from "@/lib/publishers/types";
import type { PublishContent, PublishResult } from "@/lib/types";

const EDITOR_URL =
  "https://baijiahao.baidu.com/builder/rc/edit?type=news&is_from_cms=1";

function isEditorUrl(url: string) {
  return (
    /baijiahao\.baidu\.com\/builder\/rc\/edit/i.test(url) ||
    /\/builder\/rc\/edit/i.test(url)
  );
}

function isPublishedUrl(url: string) {
  if (isEditorUrl(url)) return false;
  if (/passport|login/i.test(url)) return false;
  return (
    /baijiahao\.baidu\.com\/builder\/rc\/(content|lists|home|article)/i.test(
      url,
    ) ||
    /baijiahao\.baidu\.com\/builder\/.*(?:success|result|publish)/i.test(url) ||
    /baijiahao\.baidu\.com\/content/i.test(url)
  );
}

async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("passport") || url.includes("login")) return false;

  const cookies = await page
    .context()
    .cookies(["https://baijiahao.baidu.com", "https://www.baidu.com"]);
  return cookies.some(
    (c) =>
      c.name.includes("BDUSS") ||
      c.name.includes("STOKEN") ||
      c.name === "BJH_TOKEN",
  );
}

async function dismissOverlays(page: Page) {
  const closes = page.locator(
    'button:has-text("我知道了"), button:has-text("关闭"), button:has-text("跳过"), [aria-label="关闭"]',
  );
  const n = await closes.count();
  for (let i = 0; i < Math.min(n, 3); i++) {
    await closes
      .nth(i)
      .click({ timeout: 1500 })
      .catch(() => undefined);
  }
}

/** New BJH editor: title is contenteditable inside titleInput; body is UEditor iframe. */
async function waitForEditorReady(page: Page) {
  await page
    .waitForSelector(
      [
        ".client_components_titleInput",
        ".client_pages_edit_components_titleInput",
        'text=请输入标题',
      ].join(", "),
      { timeout: 45_000 },
    )
    .catch(() => undefined);

  // Wait until title contenteditable is visible (spinner gone)
  const titleEd = page
    .locator(
      [
        '.client_components_titleInput [contenteditable="true"]',
        '.client_pages_edit_components_titleInput [contenteditable="true"]',
      ].join(", "),
    )
    .first();
  await titleEd.waitFor({ state: "visible", timeout: 45_000 });

  // Body iframe (UEditor) — may take a bit longer
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    if (await findBodyFrame(page)) return;
    await page.waitForTimeout(500);
  }
}

function titleLocator(page: Page) {
  return page
    .locator(
      [
        '.client_components_titleInput [contenteditable="true"]',
        '.client_pages_edit_components_titleInput [contenteditable="true"]',
      ].join(", "),
    )
    .first();
}

async function fillTitle(page: Page, title: string) {
  const value = title.slice(0, 64);
  const loc = titleLocator(page);
  await loc.waitFor({ state: "visible", timeout: 20_000 });
  await loc.click({ timeout: 8000 });
  await page.waitForTimeout(200);

  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press("Backspace");
  await page.keyboard.type(value, { delay: 15 });
  await page.waitForTimeout(400);

  // Also sync hidden simulator textarea if present
  await page
    .evaluate((text) => {
      const sim = document.querySelector(
        ".client_components_titleInput textarea, .client_pages_edit_components_titleInput textarea, textarea[class*='simulator']",
      ) as HTMLTextAreaElement | null;
      if (!sim) return;
      const proto = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      );
      proto?.set?.call(sim, text);
      sim.value = text;
      sim.dispatchEvent(new Event("input", { bubbles: true }));
      sim.dispatchEvent(new Event("change", { bubbles: true }));
    }, value)
    .catch(() => undefined);

  const current = ((await loc.innerText().catch(() => "")) || "")
    .replace(/\u200b/g, "")
    .trim();
  if (!current || !current.includes(value.slice(0, Math.min(6, value.length)))) {
    // Fallback: click placeholder area then type again
    const ph = page.locator("text=请输入标题").first();
    if ((await ph.count()) > 0) {
      await ph.click({ timeout: 3000 }).catch(() => undefined);
      await page.keyboard.type(value, { delay: 15 });
    }
  }

  const again = ((await loc.innerText().catch(() => "")) || "")
    .replace(/\u200b/g, "")
    .trim();
  if (!again) {
    throw new Error("百家号标题未能写入");
  }
}

async function findBodyFrame(page: Page): Promise<Frame | null> {
  for (const frame of page.frames()) {
    try {
      const ok = await frame.evaluate(() => {
        const body = document.body;
        if (!body) return false;
        if (body.getAttribute("contenteditable") !== "true") return false;
        return (
          body.classList.contains("view") ||
          body.classList.contains("news-editor-pc") ||
          /ueditor|editor/i.test(body.className)
        );
      });
      if (ok) return frame;
    } catch {
      // cross-origin / detached
    }
  }

  // Fallback: any contenteditable body in child frame
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const ok = await frame.evaluate(
        () => document.body?.getAttribute("contenteditable") === "true",
      );
      if (ok) return frame;
    } catch {
      // ignore
    }
  }
  return null;
}

async function writeClipboard(page: Page, html: string, plain: string) {
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

async function fillBody(page: Page, content: PublishContent) {
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  const frame = await findBodyFrame(page);
  if (!frame) {
    throw new Error("找不到百家号正文编辑器（UEditor iframe）");
  }

  const body = frame.locator("body");
  await body.click({ timeout: 10_000 });
  await page.waitForTimeout(200);
  await page.keyboard.press(`${mod}+a`);
  await writeClipboard(page, content.bodyHtml, content.bodyText);
  await page.keyboard.press(`${mod}+v`);
  await page.waitForTimeout(800);

  let textLen = await body
    .evaluate((el) => (el.textContent || "").replace(/\s+/g, "").length)
    .catch(() => 0);

  if (textLen < 5) {
    // Direct HTML inject into iframe body
    await frame.evaluate((html) => {
      const el = document.body;
      if (!el) return;
      el.focus();
      el.innerHTML = html;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, content.bodyHtml);
    await page.waitForTimeout(400);
    textLen = await body
      .evaluate((el) => (el.textContent || "").replace(/\s+/g, "").length)
      .catch(() => 0);
  }

  if (textLen < 5 && content.bodyText) {
    await body.click();
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.type(content.bodyText.slice(0, 4000), { delay: 5 });
    textLen = await body
      .evaluate((el) => (el.textContent || "").replace(/\s+/g, "").length)
      .catch(() => 0);
  }

  if (textLen < 5) {
    throw new Error("百家号正文未能写入");
  }
}

async function openCoverModal(page: Page) {
  await page
    .evaluate(() => {
      const el = [...document.querySelectorAll("*")].find(
        (e) => (e.textContent || "").trim() === "选择封面",
      );
      el?.scrollIntoView({ block: "center" });
    })
    .catch(() => undefined);
  await page.waitForTimeout(300);

  const trigger = page.locator('text=选择封面').first();
  if ((await trigger.count()) === 0) return false;
  await trigger.click({ timeout: 5000 });
  await page.waitForTimeout(1200);
  return (
    (await page.locator('.cheetah-modal, [role="dialog"]').count()) > 0 ||
    (await page.locator('[role="tab"]:has-text("AI封图")').count()) > 0
  );
}

type CoverImg = {
  src: string;
  w: number;
  h: number;
  top: number;
  left: number;
};

async function listAiCoverImages(page: Page): Promise<CoverImg[]> {
  return page.evaluate(() => {
    const modal =
      document.querySelector(".cheetah-modal") ||
      document.querySelector('[role="dialog"]');
    if (!modal) return [];
    return [...modal.querySelectorAll("img")]
      .map((img) => {
        const r = img.getBoundingClientRect();
        return {
          src: img.src || "",
          w: Math.round(r.width),
          h: Math.round(r.height),
          top: Math.round(r.top),
          left: Math.round(r.left),
          cls: String(img.className),
        };
      })
      .filter((x) => {
        if (!x.src || x.w < 90 || x.h < 60) return false;
        if (/emptyIcon|d79047f0dbf8ca8d|icon|logo|avatar/i.test(x.src + x.cls)) {
          return false;
        }
        // Prefer result grid on the left, skip tiny right-side preview chips
        return x.left < 980;
      })
      .map(({ src, w, h, top, left }) => ({ src, w, h, top, left }));
  });
}

/**
 * Cover picker: open modal → AI封图（用户说的 AI 修图/生图）→
 * 根据全文智能生成 → wait → randomly pick one → 确定.
 */
async function selectAiCover(page: Page): Promise<boolean> {
  const opened = await openCoverModal(page);
  if (!opened) return false;

  const aiTab = page.locator('[role="tab"]:has-text("AI封图")').first();
  if ((await aiTab.count()) === 0) {
    // Fallback: old modal without AI tab
    return false;
  }
  await aiTab.click({ force: true });
  await page.waitForTimeout(800);

  // Random style among 写实风 / 插画风 / 卡通风
  const styles = ["写实风", "插画风", "卡通风"];
  const style = styles[Math.floor(Math.random() * styles.length)];
  await page
    .locator(".cheetah-modal, [role='dialog']")
    .getByText(style, { exact: true })
    .first()
    .click({ force: true })
    .catch(() => undefined);
  await page.waitForTimeout(300);

  // Trigger generation from article
  const smart = page
    .locator(".cheetah-modal span, [role='dialog'] span")
    .filter({ hasText: "根据全文智能生成封面" })
    .first();
  if ((await smart.count()) === 0) {
    throw new Error("找不到「根据全文智能生成封面」");
  }
  await smart.click({ force: true });
  await page.waitForTimeout(1500);

  // Wait until generation finishes and images appear (up to ~2 min)
  const deadline = Date.now() + 120_000;
  let images: CoverImg[] = [];
  while (Date.now() < deadline) {
    const modalText = (
      (await page.locator(".cheetah-modal, [role='dialog']").first().innerText().catch(() => "")) ||
      ""
    ).replace(/\s+/g, " ");
    const generating = /图片生成中|生成中|请稍候|排队/.test(modalText);
    images = await listAiCoverImages(page);

    if (!generating && images.length > 0 && !modalText.includes("一键智能生图")) {
      break;
    }
    // Keep AI tab selected if UI switches away
    const selected = await aiTab.getAttribute("aria-selected").catch(() => null);
    if (selected !== "true") {
      await aiTab.click({ force: true }).catch(() => undefined);
    }
    await page.waitForTimeout(2000);
  }

  if (!images.length) {
    // Close modal so publish can still be attempted manually
    await page
      .locator('.cheetah-modal button:has-text("取消")')
      .first()
      .click({ force: true })
      .catch(() => undefined);
    return false;
  }

  const choice = images[Math.floor(Math.random() * images.length)];
  await page.evaluate((target) => {
    const modal =
      document.querySelector(".cheetah-modal") ||
      document.querySelector('[role="dialog"]');
    if (!modal) return;
    const imgs = [...modal.querySelectorAll("img")];
    const img =
      imgs.find((i) => {
        const r = i.getBoundingClientRect();
        return (
          Math.abs(r.left - target.left) < 8 &&
          Math.abs(r.top - target.top) < 8
        );
      }) ||
      imgs.find((i) => (i.src || "").includes(target.src.slice(30, 70)));
    if (!img) return;
    const card =
      img.closest(
        '[class*="item"], [class*="card"], [class*="cover"], [class*="img"], div',
      ) || img.parentElement;
    card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    img.click();
  }, choice);
  await page.waitForTimeout(800);

  const confirm = page
    .locator('.cheetah-modal button:has-text("确定"), [role="dialog"] button:has-text("确定")')
    .last();
  await confirm.click({ force: true });
  await page.waitForTimeout(1200);
  return true;
}

async function clickPublishFlow(page: Page) {
  await dismissOverlays(page);

  // Must set cover before publish — use AI封图 and pick one at random
  const covered = await selectAiCover(page).catch((err) => {
    console.warn("[baijiahao] AI cover failed:", err);
    return false;
  });
  if (!covered) {
    // Soft fail: keep going so user can finish cover manually if needed
    console.warn("[baijiahao] AI cover not set, continuing to publish click");
  }

  const primary = [
    '.editor-component-operator button:has-text("发布")',
    'button:has-text("发布"):not(:has-text("定时"))',
    'div.cheetah-btn:has-text("发布")',
    '[class*="publish"]:has-text("发布")',
    ".publish-btn",
  ];

  await clickFirstVisible(page, primary);
  await page.waitForTimeout(1500);
  await dismissOverlays(page);

  // If publish opens another cover prompt, try AI cover once more
  if ((await page.locator('text=选择封面').count()) > 0) {
    await selectAiCover(page).catch(() => undefined);
    await clickFirstVisible(page, primary).catch(() => undefined);
    await page.waitForTimeout(1000);
  }

  const confirms = [
    'button:has-text("确认发布")',
    'button:has-text("确定发布")',
    'button:has-text("确认")',
    'button:has-text("确定")',
    'button:has-text("发布"):not(:has-text("定时"))',
  ];
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

async function hasSuccessToast(page: Page) {
  const toast = page.locator(
    "text=/发布成功|提交成功|已提交审核|发布完成|文章已提交/",
  );
  return (await toast.count()) > 0;
}

async function waitForPublished(
  page: Page,
  timeoutMs: number,
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const url = page.url();
    if (isPublishedUrl(url)) return url;

    if (await hasSuccessToast(page)) {
      await page.waitForTimeout(1500);
      if (isPublishedUrl(page.url())) return page.url();
      if (!isEditorUrl(page.url())) return page.url();
    }

    await page.waitForTimeout(1000);
  }

  if (isPublishedUrl(page.url())) return page.url();
  if ((await hasSuccessToast(page)) && !isEditorUrl(page.url())) {
    return page.url();
  }
  return null;
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
    await page.waitForTimeout(2000);
    await dismissOverlays(page);

    if (
      page.url().includes("passport") ||
      page.url().includes("login") ||
      !(await isLoggedIn(page))
    ) {
      return {
        success: false,
        error: "百家号未登录或登录已过期，请先在「账号」页重新连接",
        screenshotPath: await captureDebugScreenshot(page, "baijiahao-not-login"),
        keepOpen: true,
      };
    }

    await waitForEditorReady(page);
    await dismissOverlays(page);

    await fillTitle(page, content.title);
    await page.waitForTimeout(400);

    await fillBody(page, content);
    await page.waitForTimeout(600);

    // Ensure title still intact after body paste
    const titleNow = (
      (await titleLocator(page).innerText().catch(() => "")) || ""
    )
      .replace(/\u200b/g, "")
      .trim();
    if (!titleNow || titleNow.length < 2) {
      await fillTitle(page, content.title);
    }
    await page.waitForTimeout(300);

    await clickPublishFlow(page);

    let published = await waitForPublished(page, 25_000);
    if (published) {
      return { success: true, url: published };
    }

    await captureDebugScreenshot(page, "baijiahao-await-manual");
    published = await waitForPublished(page, 3 * 60_000);
    if (published) {
      return { success: true, url: published };
    }

    if (await hasSuccessToast(page)) {
      return { success: true, url: page.url() };
    }

    return {
      success: false,
      error:
        "百家号未确认发布成功（仍在编辑页）。请在打开的窗口补全封面/分类后点发布；完成后请关闭该窗口，才会开始下一个平台",
      screenshotPath: await captureDebugScreenshot(
        page,
        "baijiahao-not-published",
      ),
      keepOpen: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `${message}（完成后请关闭窗口，才会开始下一个平台）`,
      screenshotPath: await captureDebugScreenshot(page, "baijiahao-error"),
      keepOpen: true,
    };
  }
}

export const baijiahaoPublisher: PlatformPublisher = {
  id: "baijiahao",
  name: "百家号",
  loginUrl: "https://baijiahao.baidu.com/",
  editorUrl: "https://baijiahao.baidu.com/builder/rc/edit?type=news",
  isLoggedIn,
  publish,
};
