import type { Frame, Page } from "playwright";
import { resolveCoverFile } from "@/lib/content/cover-file";
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

async function hasSecurityCaptcha(page: Page) {
  if (
    (await page.getByText("百度安全验证").count()) > 0 ||
    (await page.getByText("拖动左侧滑块使图片为正").count()) > 0 ||
    (await page.getByText("请完成下方验证后继续操作").count()) > 0
  ) {
    return true;
  }
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const url = frame.url();
    if (/captcha|pass\.baidu|security/i.test(url)) return true;
    const t = await frame
      .locator("body")
      .innerText()
      .catch(() => "");
    if (/百度安全验证|拖动左侧滑块|请完成下方验证/.test(t)) return true;
  }
  const text = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  return /百度安全验证|拖动左侧滑块使图片为正|请完成下方验证后继续操作/.test(
    text,
  );
}

async function dismissOverlays(page: Page) {
  // Short-article tip: keep 图文 publish (not convert to 动态)
  const keepNews = page.getByRole("button", { name: "保持图文发布" });
  if (
    (await keepNews.count()) > 0 &&
    (await keepNews.first().isVisible().catch(() => false))
  ) {
    await keepNews.first().click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(500);
  }

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

async function dismissShortArticleTip(page: Page) {
  // A) Convert-to-动态 tip
  const tip = page.locator(
    '.cheetah-modal:has-text("温馨提示"), [role="dialog"]:has-text("温馨提示"), .cheetah-modal:has-text("保持图文发布")',
  );
  if (
    (await tip.count()) > 0 &&
    (await tip.first().isVisible().catch(() => false))
  ) {
    const keep = tip
      .getByRole("button", { name: "保持图文发布" })
      .or(tip.locator('button:has-text("保持图文发布")'));
    if ((await keep.count()) > 0) {
      await keep.first().click({ force: true });
      await page.waitForTimeout(600);
      return true;
    }
  }

  // B) Word-count tip: 正文少于200字 → 确定继续发布
  const shortTip = page.locator(
    [
      '.cheetah-modal:has-text("少于200字")',
      '.cheetah-modal:has-text("少于 200 字")',
      '[role="dialog"]:has-text("少于200字")',
      '.cheetah-modal:has-text("是否确认发布")',
      '[role="dialog"]:has-text("是否确认发布")',
    ].join(", "),
  );
  if (
    (await shortTip.count()) > 0 &&
    (await shortTip.first().isVisible().catch(() => false))
  ) {
    const ok = shortTip
      .getByRole("button", { name: "确定", exact: true })
      .or(shortTip.locator('button:has-text("确定")'))
      .last();
    if ((await ok.count()) > 0) {
      await ok.click({ force: true });
      await page.waitForTimeout(800);
      return true;
    }
  }
  return false;
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

  // Title contenteditable may be "hidden" to Playwright while still usable
  const titleEd = page
    .locator(
      [
        '.client_components_titleInput [contenteditable="true"]',
        '.client_pages_edit_components_titleInput [contenteditable="true"]',
        '[class*="titleInput"] [contenteditable="true"]',
        '[class*="FeEditorApp"][class*="placeholder"]',
      ].join(", "),
    )
    .first();
  await titleEd.waitFor({ state: "attached", timeout: 45_000 });
  await page
    .getByText("选择封面", { exact: true })
    .first()
    .waitFor({ state: "attached", timeout: 30_000 })
    .catch(() => undefined);

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
  // Editor chrome sometimes reports contenteditable as not visible; force-click works
  await loc.waitFor({ state: "attached", timeout: 20_000 });
  await loc.scrollIntoViewIfNeeded().catch(() => undefined);
  await loc.click({ force: true, timeout: 8000 });
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

const AI_COVER_TAB = /AI\s*(封图|制图|封面)/;

async function coverModalOpen(page: Page) {
  // Cover dialog has AI tab; ignore unrelated cheetah-modals (AI 助手等)
  const modal = page.locator(".cheetah-modal:visible, [role='dialog']:visible");
  const n = await modal.count();
  for (let i = 0; i < n; i++) {
    const t = ((await modal.nth(i).innerText().catch(() => "")) || "").replace(
      /\s+/g,
      " ",
    );
    if (AI_COVER_TAB.test(t) || /本地上传|免费正版图库|设置封面/.test(t)) {
      return true;
    }
  }
  return (
    (await page
      .locator(".cheetah-tabs-tab:visible, [role='tab']:visible")
      .filter({ hasText: AI_COVER_TAB })
      .count()) > 0
  );
}

async function assertStillOnEditor(page: Page) {
  if (await hasSecurityCaptcha(page)) {
    throw new Error(
      "百家号弹出百度安全验证，请在打开的窗口完成滑块后关闭窗口，再重新发布",
    );
  }
  const url = page.url();
  if (!isEditorUrl(url)) {
    throw new Error(
      `百家号已离开编辑页（${url.includes("/home") ? "被跳到首页" : url}），请完成安全验证后重新发布`,
    );
  }
}

/**
 * Open cover picker. Preview <img> often sits on top of 「选择封面」and
 * intercepts normal clicks — scroll into view then force-click that tile only.
 */
async function openCoverModal(page: Page) {
  if (await coverModalOpen(page)) return true;
  await assertStillOnEditor(page);

  // Cover slot is often below the fold — scroll the form row into view
  const scrolled = await page.evaluate(() => {
    const label = [...document.querySelectorAll("*")].find(
      (e) => (e.textContent || "").trim() === "选择封面",
    ) as HTMLElement | undefined;
    if (!label) return false;
    const tile =
      (label.closest(
        ".cheetah-form-item-row, [class*='content'], [class*='cover']",
      ) as HTMLElement | null) || label;
    tile.scrollIntoView({ block: "center", inline: "nearest" });
    return true;
  });
  if (!scrolled) {
    await assertStillOnEditor(page);
    return false;
  }
  await page.waitForTimeout(400);

  // getByText(exact) hits the leaf label — NOT outer list wrappers
  // (div.filter(/^选择封面$/) matches 7 ancestors; .first() is the wrong one)
  const label = page.getByText("选择封面", { exact: true }).first();

  // 1) Force-click label — bypasses preview <img> intercepting pointer events
  if ((await label.count()) > 0) {
    await label.click({ force: true, timeout: 8000 });
    await page.waitForTimeout(1000);
    if (await coverModalOpen(page)) return true;
  }

  // 2) Cover slot item (single-image tile), not the whole list
  const item = page
    .locator('[class*="FeEditorApp"][class*="item"]')
    .filter({ hasText: /^选择封面$/ })
    .first();
  if ((await item.count()) > 0) {
    await item.click({ force: true, timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
    if (await coverModalOpen(page)) return true;
  }

  // 3) Preview img only inside that item tile
  const itemImg = item.locator("img").first();
  if (
    (await itemImg.count()) > 0 &&
    (await itemImg.isVisible().catch(() => false))
  ) {
    await itemImg.click({ force: true, timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
    if (await coverModalOpen(page)) return true;
  }

  await assertStillOnEditor(page);
  return false;
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
    const modals = [
      ...document.querySelectorAll(".cheetah-modal"),
      ...document.querySelectorAll('[role="dialog"]'),
    ];
    const modal =
      modals.find((m) => {
        const t = m.textContent || "";
        return /AI\s*(封图|制图|封面)|本地上传/.test(t);
      }) || modals[0];
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
        if (!x.src || x.w < 70 || x.h < 50) return false;
        if (/emptyIcon|d79047f0dbf8ca8d|placeholder|default/i.test(x.src + x.cls))
          return false;
        if (/icon|logo|avatar/i.test(x.cls) && x.w < 120) return false;
        // Result grid left/center; skip far-right phone preview strip
        return x.left < 980 && x.w <= 420;
      })
      .map(({ src, w, h, top, left }) => ({ src, w, h, top, left }));
  });
}

async function clickAiCoverTab(page: Page) {
  const tab = page
    .locator(
      ".cheetah-modal .cheetah-tabs-tab, .cheetah-modal [role='tab'], [role='dialog'] [role='tab']",
    )
    .filter({ hasText: AI_COVER_TAB })
    .first();
  if ((await tab.count()) === 0) return false;
  await tab.click({ force: true });
  await page.waitForTimeout(800);
  return true;
}

/**
 * Cover: 选择封面 → AI封图 → 根据全文智能生成封面 → 等生成完 → 选一张 → 确定.
 */
async function selectAiCover(page: Page): Promise<boolean> {
  const opened = await openCoverModal(page);
  if (!opened) return false;

  if (!(await clickAiCoverTab(page))) {
    throw new Error("找不到「AI封图/AI制图」页签");
  }

  // Style (optional — generation may already be running / done)
  const styles = ["写实风", "插画风", "卡通风"];
  const style = styles[Math.floor(Math.random() * styles.length)];
  await page
    .locator(".cheetah-modal [class*='option']")
    .filter({ hasText: new RegExp(`^\\s*${style}\\s*$`) })
    .first()
    .click({ force: true })
    .catch(async () => {
      await page
        .locator(".cheetah-modal")
        .getByText(style, { exact: true })
        .first()
        .click({ force: true })
        .catch(() => undefined);
    });
  await page.waitForTimeout(300);

  // Trigger: 「根据全文智能生成封面」(hidden after generation starts — don't fail)
  let images = await listAiCoverImages(page);
  if (images.length === 0) {
    const smart = page
      .locator(".cheetah-modal:visible")
      .getByText("根据全文智能生成封面", { exact: true })
      .first();
    if ((await smart.count()) > 0) {
      await smart.click({ force: true, timeout: 8000 }).catch(() => undefined);
    } else {
      await page
        .getByText("根据全文智能生成封面", { exact: true })
        .first()
        .click({ force: true, timeout: 5000 })
        .catch(() => undefined);
    }
    await page.waitForTimeout(1000);
  }

  // Wait for generating → result images (or already-complete grid)
  const deadline = Date.now() + 120_000;
  let sawGenerating = false;
  while (Date.now() < deadline) {
    const modalText = (
      (await page
        .locator(".cheetah-modal:visible, [role='dialog']:visible")
        .first()
        .innerText()
        .catch(() => "")) || ""
    ).replace(/\s+/g, " ");
    const generating = /图片生成中|生成中|请稍候|排队/.test(modalText);
    const done = /生成完成|AI\s*图片生成完成/.test(modalText);
    if (generating) sawGenerating = true;
    images = await listAiCoverImages(page);

    if (images.length > 0 && (done || !generating)) break;

    const activeAi = page.locator(
      ".cheetah-modal .cheetah-tabs-tab-active",
      { hasText: /AI/ },
    );
    if ((await activeAi.count()) === 0) {
      await clickAiCoverTab(page);
    }
    await page.waitForTimeout(2000);
  }

  if (!images.length) {
    await page
      .locator('.cheetah-modal button:has-text("取消")')
      .first()
      .click({ force: true })
      .catch(() => undefined);
    throw new Error(
      sawGenerating
        ? "AI 封面生成结束但未得到可选图片"
        : "未能启动 AI 封面生成（根据全文智能生成封面）",
    );
  }

  const choice = images[Math.floor(Math.random() * images.length)];
  const clickX = choice.left + Math.min(40, Math.max(8, choice.w / 2));
  const clickY = choice.top + Math.min(30, Math.max(8, choice.h / 2));
  await page.mouse.click(clickX, clickY);
  await page.waitForTimeout(500);
  // Retry nearby in case the first hit missed the card chrome
  await page.mouse.click(choice.left + 8, choice.top + 8).catch(() => undefined);
  await page.waitForTimeout(600);

  const confirm = page
    .locator(
      '.cheetah-modal:visible button:has-text("确定"), [role="dialog"]:visible button:has-text("确定")',
    )
    .last();
  // 确定 stays disabled until a cover is selected
  for (let i = 0; i < 10; i++) {
    const disabled = await confirm.isDisabled().catch(() => true);
    if (!disabled) break;
    const img = images[i % images.length];
    await page.mouse
      .click(
        img.left + Math.min(40, Math.max(8, img.w / 2)),
        img.top + Math.min(30, Math.max(8, img.h / 2)),
      )
      .catch(() => undefined);
    await page.waitForTimeout(500);
  }
  if (await confirm.isDisabled().catch(() => false)) {
    throw new Error("AI 封面未选中，「确定」不可点");
  }
  await confirm.click({ force: true });
  await page.waitForTimeout(1500);

  // Modal must close — otherwise cover was not applied
  for (let i = 0; i < 3; i++) {
    const stillOpen = await coverModalOpen(page);
    if (!stillOpen) return true;
    await confirm.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(800);
  }
  if (await coverModalOpen(page)) {
    throw new Error("已点确定但封面弹窗未关闭，请手动选一张 AI 封面后确定");
  }
  return true;
}

/** Normalize button label for exact matching (百家号 footer has both「发布」and「定时发布」). */
function normalizeBtnText(raw: string) {
  return raw.replace(/\s+/g, "").trim();
}

async function dismissScheduleModal(page: Page) {
  const modal = page
    .locator(
      [
        '.cheetah-modal:has-text("定时发文")',
        '.cheetah-modal:has-text("定时发布")',
        '[role="dialog"]:has-text("定时发文")',
        '[role="dialog"]:has-text("定时发布")',
      ].join(", "),
    )
    .first();
  if ((await modal.count()) === 0) return false;
  if (!(await modal.isVisible().catch(() => false))) return false;

  const cancel = modal.locator('button:has-text("取消")').first();
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click({ force: true }).catch(() => undefined);
  } else {
    await modal
      .locator('[aria-label="关闭"], .cheetah-modal-close, button:has-text("×")')
      .first()
      .click({ force: true })
      .catch(() => undefined);
  }
  await page.waitForTimeout(500);
  return true;
}

/**
 * Click the immediate「发布」button — never「定时发布」.
 * Playwright :has-text("发布") also matches「定时发布」, which opened the schedule dialog.
 */
async function clickImmediatePublishButton(page: Page) {
  await dismissScheduleModal(page);

  const scoped = page.locator(
    [
      ".editor-component-operator button",
      ".editor-component-operator .cheetah-btn",
      "footer button",
      '[class*="operator"] button',
      '[class*="operator"] .cheetah-btn',
    ].join(", "),
  );
  const n = await scoped.count();
  for (let i = 0; i < n; i++) {
    const btn = scoped.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    if (await btn.isDisabled().catch(() => false)) continue;
    const text = normalizeBtnText(
      (await btn.innerText().catch(() => "")) || "",
    );
    if (text !== "发布") continue;
    await btn.click({ timeout: 10_000, force: true });
    return true;
  }

  // Fallback: role name exact match (does not match 定时发布)
  const byRole = page.getByRole("button", { name: "发布", exact: true });
  const roleCount = await byRole.count();
  for (let i = roleCount - 1; i >= 0; i--) {
    const btn = byRole.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    if (await btn.isDisabled().catch(() => false)) continue;
    await btn.click({ timeout: 10_000, force: true });
    return true;
  }

  return false;
}

async function clickConfirmPublish(page: Page) {
  await dismissScheduleModal(page);

  const preferredLabels = [
    "保持图文发布",
    "确认发布",
    "确定发布",
    "立即发布",
    "确认",
    "确定",
  ];
  const candidates = page.locator(
    'button, .cheetah-btn, [role="button"], div.cheetah-btn',
  );
  const n = await candidates.count();
  for (const label of preferredLabels) {
    for (let i = n - 1; i >= 0; i--) {
      const btn = candidates.nth(i);
      if (!(await btn.isVisible().catch(() => false))) continue;
      if (await btn.isDisabled().catch(() => false)) continue;
      const text = normalizeBtnText(
        (await btn.innerText().catch(() => "")) || "",
      );
      if (text !== label) continue;
      // Never confirm inside schedule / cover-picker dialogs
      const blocked = await btn
        .evaluate((el) => {
          const modal = el.closest(".cheetah-modal, [role='dialog']");
          const t = modal?.textContent || "";
          if (/定时发文|定时发布/.test(t)) return true;
          if (/是否确认发布|少于\s*200/.test(t)) return false; // short-body tip OK
          if (/本地上传|免费正版图库|AI\s*(封图|制图|封面)/.test(t)) return true;
          return false;
        })
        .catch(() => false);
      if (blocked) continue;
      await btn.click({ timeout: 5000, force: true }).catch(() => undefined);
      await page.waitForTimeout(800);
      return true;
    }
  }
  return false;
}

async function uploadLocalCover(
  page: Page,
  coverPath: string | null,
): Promise<boolean> {
  const file = resolveCoverFile(coverPath);
  if (!file) return false;
  if (!(await openCoverModal(page))) return false;
  const tab = page
    .locator(
      ".cheetah-modal .cheetah-tabs-tab, .cheetah-modal [role='tab'], [role='dialog'] [role='tab']",
    )
    .filter({ hasText: /本地上传/ })
    .first();
  if ((await tab.count()) > 0) {
    await tab.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(500);
  }
  const input = page
    .locator('.cheetah-modal:visible input[type="file"], [role="dialog"]:visible input[type="file"]')
    .first();
  if ((await input.count()) === 0) return false;
  await input.setInputFiles(file).catch(() => undefined);
  await page.waitForTimeout(1600);
  const confirm = page
    .locator(
      '.cheetah-modal:visible button:has-text("确定"), [role="dialog"]:visible button:has-text("确定")',
    )
    .last();
  for (let i = 0; i < 8; i++) {
    if (!(await confirm.isDisabled().catch(() => true))) break;
    await page.waitForTimeout(400);
  }
  if (await confirm.isDisabled().catch(() => true)) return false;
  await confirm.click({ force: true });
  await page.waitForTimeout(1200);
  return !(await coverModalOpen(page));
}

async function clickPublishFlow(page: Page, coverPath: string | null) {
  await dismissOverlays(page);

  const covered =
    (await uploadLocalCover(page, coverPath).catch(() => false)) ||
    (await selectAiCover(page));
  if (!covered) {
    throw new Error("百家号封面未设置：请完成封面选择后再发布");
  }

  // Exact「发布」— never「定时发布」
  let clicked = await clickImmediatePublishButton(page);
  if (!clicked) {
    throw new Error("找不到「发布」按钮（已排除定时发布）");
  }
  await page.waitForTimeout(1500);
  await dismissOverlays(page);
  await dismissShortArticleTip(page);

  // Mistaken schedule dialog → close and click 发布 again
  if (await dismissScheduleModal(page)) {
    clicked = await clickImmediatePublishButton(page);
    if (!clicked) {
      throw new Error("已关闭定时弹窗，但仍找不到「发布」按钮");
    }
    await page.waitForTimeout(1000);
  }

  // Cover required again?
  if (
    (await page.locator(".cheetah-modal:has-text('AI封图'), .cheetah-modal:has-text('选择封面')").count()) >
    0
  ) {
    await selectAiCover(page);
    await clickImmediatePublishButton(page);
    await page.waitForTimeout(1000);
    await dismissScheduleModal(page);
    await dismissShortArticleTip(page);
  }

  // After tip / cover, may need to click 发布 again
  if (await dismissShortArticleTip(page)) {
    await clickImmediatePublishButton(page);
    await page.waitForTimeout(800);
  }

  await dismissShortArticleTip(page);
  await clickConfirmPublish(page);
  // Never leave schedule modal open
  if (await dismissScheduleModal(page)) {
    await clickImmediatePublishButton(page);
    await dismissShortArticleTip(page);
    await clickConfirmPublish(page);
  }
  // Short-body tip may appear after 发布; confirm and wait
  if (await dismissShortArticleTip(page)) {
    await page.waitForTimeout(1000);
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

    if (await hasSecurityCaptcha(page)) {
      return {
        success: false,
        error:
          "百家号弹出百度安全验证，请在打开的窗口完成滑块后关闭窗口，再重新发布",
        screenshotPath: await captureDebugScreenshot(
          page,
          "baijiahao-captcha",
        ),
        keepOpen: true,
      };
    }

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

    if (await hasSecurityCaptcha(page)) {
      return {
        success: false,
        error:
          "百家号弹出百度安全验证，请在打开的窗口完成滑块后关闭窗口，再重新发布",
        screenshotPath: await captureDebugScreenshot(
          page,
          "baijiahao-captcha",
        ),
        keepOpen: true,
      };
    }

    await fillTitle(page, content.title);
    await page.waitForTimeout(400);
    await assertStillOnEditor(page);

    await fillBody(page, content);
    await page.waitForTimeout(600);
    await assertStillOnEditor(page);

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
    await assertStillOnEditor(page);

    await clickPublishFlow(page, content.coverPath);

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
