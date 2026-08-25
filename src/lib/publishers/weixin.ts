import type { Page } from "playwright";
import { resolveCoverFile } from "@/lib/content/cover-file";
import {
  captureDebugScreenshot,
  clickFirstVisible,
} from "@/lib/publishers/browser";
import {
  dismissCommonOverlays,
  writeClipboardHtml,
} from "@/lib/publishers/helpers";
import type { PlatformPublisher } from "@/lib/publishers/types";
import type { PublishContent, PublishResult } from "@/lib/types";

const HOME = "https://mp.weixin.qq.com/";

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    if (page.isClosed()) return false;
    const url = page.url();
    if (/loginpage|login\?|passport/i.test(url)) return false;

    const qrVisible = await page
      .evaluate(() => {
        const text = document.body?.innerText || "";
        if (!text.includes("微信扫一扫")) return false;
        return !!document.querySelector(
          ".login__type__container, .login_panel, .qrcheck_box, .js_qrcode, .login_qrcode",
        );
      })
      .catch(() => false);
    if (qrVisible) return false;

    if (/[?&]token=\d+/i.test(url)) return true;

    if (isEditorUrl(url)) {
      const hasTitle = (await page.locator("#title, .ProseMirror").count()) > 0;
      return hasTitle;
    }

    return false;
  } catch {
    return false;
  }
}

function isEditorUrl(url: string) {
  return (
    /mp\.weixin\.qq\.com\/cgi-bin\/appmsg/i.test(url) &&
    /action=edit|appmsg_edit/i.test(url)
  );
}

function extractMpToken(url: string): string | null {
  try {
    return new URL(url).searchParams.get("token");
  } catch {
    return url.match(/[?&]token=(\d+)/i)?.[1] ?? null;
  }
}

async function dismissWeixinPopovers(page: Page) {
  await dismissCommonOverlays(page);
  // Close floating menus like 留言 options
  await page.keyboard.press("Escape").catch(() => undefined);
  await page
    .locator(".weui-desktop-popover, .weui-desktop-msg")
    .evaluateAll((nodes) => {
      for (const n of nodes) (n as HTMLElement).style.display = "none";
    })
    .catch(() => undefined);
}

/**
 * Proven path (tested): home → token → appmsg_edit_v2 type=77.
 * Fallback: click homepage card「文章」(opens new tab).
 */
async function openNewArticle(page: Page): Promise<Page> {
  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2500);
  await dismissWeixinPopovers(page);

  let token = extractMpToken(page.url());
  const tokenDeadline = Date.now() + 15_000;
  while (!token && Date.now() < tokenDeadline) {
    if (
      /loginpage|login\?/i.test(page.url()) ||
      (await page.getByText("微信扫一扫").count()) > 0
    ) {
      throw new Error("微信公众号未登录");
    }
    await page.waitForTimeout(600);
    token = extractMpToken(page.url());
  }
  if (!token) {
    throw new Error("无法从公众号首页取得 token，请重新连接账号");
  }

  // Direct editor URL — verified working with current MP UI
  const editUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&lang=zh_CN&token=${token}`;
  await page.goto(editUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3000);
  await dismissWeixinPopovers(page);

  if (await waitForTitleField(page, 15_000)) {
    return page;
  }

  // Fallback: homepage「文章」card → new tab
  await page.goto(
    `https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=${token}`,
    { waitUntil: "domcontentloaded", timeout: 60_000 },
  );
  await page.waitForTimeout(2000);

  const popupPromise = page
    .context()
    .waitForEvent("page", { timeout: 15_000 })
    .catch(() => null);

  const clicked = await page.evaluate(() => {
    const items = [
      ...document.querySelectorAll(".new-creation__menu-item"),
    ] as HTMLElement[];
    for (const el of items) {
      const t = (el.textContent || "").replace(/\s+/g, "");
      // Exact card label on current MP home is「文章」
      if (t === "文章" || t === "图文消息" || t === "写新图文") {
        el.click();
        return t;
      }
    }
    return null;
  });

  const popup = await popupPromise;
  let editor = page;
  if (popup && !popup.isClosed()) {
    await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
    await popup.waitForTimeout(2500);
    editor = popup;
  } else {
    await page.waitForTimeout(2500);
    for (const p of page.context().pages()) {
      if (!p.isClosed() && isEditorUrl(p.url())) {
        editor = p;
        break;
      }
    }
  }

  await dismissWeixinPopovers(editor);
  if (!(await waitForTitleField(editor, 20_000))) {
    throw new Error(
      `未能打开图文编辑器（clicked=${clicked || "none"}，url=${editor.url()}）。请手动点首页「文章」后关闭窗口重试`,
    );
  }
  return editor;
}

async function waitForTitleField(page: Page, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) return false;
    // #title exists but is visibility:hidden; visible UI is the first ProseMirror
    const titleInput = page.locator("#title");
    const titlePm = page.locator(".ProseMirror").first();
    const hasHiddenTitle = (await titleInput.count()) > 0;
    const hasVisiblePm =
      (await titlePm.count()) > 0 &&
      (await titlePm.isVisible().catch(() => false));
    if (hasHiddenTitle || hasVisiblePm || isEditorUrl(page.url())) {
      if (hasVisiblePm || hasHiddenTitle) return true;
    }
    await page.waitForTimeout(500);
  }
  return false;
}

async function fillTitle(page: Page, title: string) {
  const value = title.slice(0, 64);

  // Keep hidden #title in sync (form field)
  if ((await page.locator("#title").count()) > 0) {
    await page.locator("#title").evaluate((el, v) => {
      const input = el as HTMLTextAreaElement | HTMLInputElement;
      input.value = v;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  }

  // Visible title editor is the first ProseMirror
  const titlePm = page.locator(".ProseMirror").first();
  await titlePm.waitFor({ state: "visible", timeout: 15_000 });
  await titlePm.click({ timeout: 5000 });
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.type(value, { delay: 10 });
  await page.waitForTimeout(200);
}

async function fillAuthor(page: Page) {
  const author = page
    .locator(
      'input[placeholder*="请输入作者"], textarea[placeholder*="请输入作者"], input[placeholder*="作者"]',
    )
    .first();
  if ((await author.count()) === 0) return;
  if (!(await author.isVisible().catch(() => false))) return;
  const current = await author.inputValue().catch(() => "");
  if (current.trim()) return;
  await author.fill("点物GEO").catch(() => undefined);
}

async function fillBody(page: Page, content: PublishContent) {
  const html = content.bodyHtml || `<p>${content.bodyText || ""}</p>`;
  const plain = content.bodyText || content.bodyMarkdown || "";
  const mod = process.platform === "darwin" ? "Meta" : "Control";

  // Title uses ProseMirror[0]; body is usually ProseMirror[1]
  const all = page.locator(".ProseMirror");
  const count = await all.count();
  let bodyPm = count >= 2 ? all.nth(1) : all.first();

  // Prefer the one showing body placeholder
  for (let i = 0; i < count; i++) {
    const pm = all.nth(i);
    const text = ((await pm.innerText().catch(() => "")) || "").trim();
    if (text.includes("从这里开始写正文") || text.includes("写正文")) {
      bodyPm = pm;
      break;
    }
  }

  await bodyPm.waitFor({ state: "visible", timeout: 15_000 });
  await bodyPm.click({ timeout: 8000 });
  await page.waitForTimeout(200);

  // Prefer HTML paste
  try {
    await writeClipboardHtml(page, html, plain);
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.press(`${mod}+v`);
    await page.waitForTimeout(800);
  } catch {
    // clipboard may be blocked
  }

  let len = await bodyPm.evaluate((el) => (el.textContent || "").trim().length);
  if (len < 5) {
    await bodyPm.click();
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.type(plain.slice(0, 5000) || " ", { delay: 5 });
    len = await bodyPm.evaluate((el) => (el.textContent || "").trim().length);
  }
  if (len < 2) {
    throw new Error("正文写入后仍为空");
  }
}

async function uploadLocalCover(
  page: Page,
  coverPath: string | null,
): Promise<boolean> {
  const file = resolveCoverFile(coverPath);
  if (!file) return false;
  await dismissWeixinPopovers(page);
  const coverBtn = page
    .locator(
      ".js_cover_btn_area, .setting-group__cover_primary, .select-cover__btn",
    )
    .first();
  if ((await coverBtn.count()) === 0) return false;
  await coverBtn.scrollIntoViewIfNeeded().catch(() => undefined);
  await coverBtn.click({ timeout: 5000, force: true }).catch(() => undefined);
  await page.waitForTimeout(600);
  const input = page.locator('input[type="file"]').first();
  if ((await input.count()) === 0) return false;
  await input.setInputFiles(file).catch(() => undefined);
  await page.waitForTimeout(1200);
  await confirmCoverCrop(page).catch(() => false);
  return true;
}

async function openAiCoverDialog(page: Page): Promise<boolean> {
  await dismissWeixinPopovers(page);

  const coverBtn = page
    .locator(
      ".js_cover_btn_area, .setting-group__cover_primary, .select-cover__btn",
    )
    .first();
  if ((await coverBtn.count()) === 0) return false;
  await coverBtn.scrollIntoViewIfNeeded().catch(() => undefined);
  await coverBtn.hover().catch(() => undefined);
  await coverBtn.click({ timeout: 5000, force: true }).catch(() => undefined);
  await page.waitForTimeout(800);

  // Multiple hidden a.js_aiImage exist; click the one with layout
  const opened = await page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll("a.js_aiImage, .js_aiImage"),
    ] as HTMLElement[];
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2 && r.top < innerHeight && r.bottom > 0) {
        el.click();
        return true;
      }
    }
    return false;
  });
  if (!opened) {
    const byText = page.getByText(/AI\s*配图/).last();
    if ((await byText.count()) === 0) return false;
    await byText.click({ force: true }).catch(() => undefined);
  }
  await page.waitForTimeout(1200);
  return (
    (await page.locator('textarea[placeholder*="描述你想"]').count()) > 0 ||
    (await page.locator(".ai_image_dialog, .ai-image-op-btn").count()) > 0
  );
}

async function confirmCoverCrop(page: Page): Promise<boolean> {
  // Crop dialog after「使用」: green「确认」— MUST NOT click「退出登录」etc.
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const confirmed = await page.evaluate(() => {
      const btns = [
        ...document.querySelectorAll("button, a, .weui-desktop-btn"),
      ] as HTMLElement[];
      for (const el of btns) {
        const t = (el.textContent || "").replace(/\s+/g, "");
        // Exact「确认」only — never「退出登录」/「确定退出」
        if (t !== "确认") continue;
        const r = el.getBoundingClientRect();
        if (
          r.width > 20 &&
          r.height > 10 &&
          r.top > 40 &&
          r.top < innerHeight - 20
        ) {
          el.click();
          return t;
        }
      }
      // Primary in crop dialog footer, but only if label is 确认
      const primaries = [
        ...document.querySelectorAll(
          ".weui-desktop-dialog__ft .weui-desktop-btn_primary, .weui-desktop-dialog .weui-desktop-btn_primary",
        ),
      ] as HTMLElement[];
      for (const primary of primaries) {
        const t = (primary.textContent || "").replace(/\s+/g, "");
        if (t === "确认") {
          primary.click();
          return "primary-确认";
        }
      }
      return null;
    });
    if (confirmed) {
      await page.waitForTimeout(1000);
      return true;
    }
    await page.waitForTimeout(400);
  }
  return false;
}

async function closeWeixinDialogs(page: Page) {
  for (let i = 0; i < 4; i++) {
    const closed = await page.evaluate(() => {
      if (!document.querySelector(".weui-desktop-dialog__wrp")) return false;
      const close = document.querySelector(
        ".weui-desktop-dialog__close-btn",
      ) as HTMLElement | null;
      if (close) {
        close.click();
        return true;
      }
      return false;
    });
    if (!closed) break;
    await page.waitForTimeout(400);
  }
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(300);
}

async function selectAiCover(
  page: Page,
  title: string,
  bodyText = "",
): Promise<boolean> {
  if (!(await openAiCoverDialog(page))) return false;

  await clickFirstVisible(page, [
    'button:has-text("同意")',
    'button:has-text("我同意")',
    'button:has-text("开始使用")',
  ]).catch(() => undefined);

  // Start a fresh AI chat — do not reuse old generations
  await page
    .locator(".ai_image_dialog__icon-new, [class*='ai_image_dialog__icon-new']")
    .first()
    .click({ force: true })
    .catch(() => undefined);
  await page.waitForTimeout(600);

  // Prefer 2.35:1 cover ratio
  await page
    .getByText("2.35:1", { exact: false })
    .first()
    .click({ force: true })
    .catch(() => undefined);

  const topic = title.trim().slice(0, 48);
  const excerpt = bodyText
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const prompt = excerpt
    ? `根据文章内容生成公众号头条封面：标题「${topic}」。内容要点：${excerpt}。画面简洁大气，有设计感，适合微信图文封面，2.35:1 横图。`
    : `根据文章标题生成公众号头条封面：「${topic}」。画面简洁大气，有设计感，适合微信图文封面，2.35:1 横图。`;

  const box = page
    .locator(
      'textarea[placeholder*="描述你想"], textarea[placeholder*="想要创作"], textarea[placeholder*="创作的内容"]',
    )
    .first();
  if ((await box.count()) === 0) {
    await closeWeixinDialogs(page);
    return false;
  }
  await box.click({ force: true }).catch(() => undefined);
  await box.fill("");
  await box.fill(prompt);
  await page.waitForTimeout(400);

  // Snapshot existing「使用」buttons so we only pick a newly generated one
  const useCountBefore = await page.locator(".ai-image-op-btn").evaluateAll((nodes) =>
    nodes.filter((n) => (n.textContent || "").trim() === "使用").length,
  );

  const send = page.locator("button.send-btn").first();
  if ((await send.count()) === 0) {
    await closeWeixinDialogs(page);
    return false;
  }
  // Wait until send enables after typing
  const sendReady = Date.now() + 5_000;
  while (Date.now() < sendReady) {
    const disabled = await send.evaluate((el) =>
      el.classList.contains("send-btn_disabled") ||
      (el as HTMLButtonElement).disabled,
    ).catch(() => true);
    if (!disabled) break;
    await page.waitForTimeout(200);
  }
  await send.click({ force: true }).catch(() => undefined);

  // Wait until generation finishes (new result / 使用 button)
  const deadline = Date.now() + 120_000;
  let generated = false;
  while (Date.now() < deadline) {
    if (page.isClosed()) return false;
    if (/loginpage|login\?/i.test(page.url())) return false;

    const doneHint = await page
      .getByText(/已为你生成图片|生成完成|生成成功/)
      .count()
      .catch(() => 0);
    const useCountNow = await page
      .locator(".ai-image-op-btn")
      .evaluateAll((nodes) =>
        nodes.filter((n) => (n.textContent || "").trim() === "使用").length,
      )
      .catch(() => 0);

    // Prefer evidence of a NEW result after we clicked send
    if (doneHint > 0 || useCountNow > useCountBefore) {
      // Brief settle — last image may still be animating in
      await page.waitForTimeout(1200);
      generated = true;
      break;
    }

    // Still generating?
    const generating = await page
      .getByText(/生成中|正在生成|创作中|请稍候/)
      .count()
      .catch(() => 0);
    await page.waitForTimeout(generating > 0 ? 2000 : 1500);
  }

  if (!generated) {
    console.warn("[weixin] AI cover generation timed out");
    await closeWeixinDialogs(page);
    return false;
  }

  // Click the lowest visible「使用」(newest result in the chat)
  const used = await page.evaluate(() => {
    const btns = [
      ...document.querySelectorAll(".ai-image-op-btn"),
    ] as HTMLElement[];
    let best: HTMLElement | null = null;
    let bestY = -Infinity;
    for (const el of btns) {
      if ((el.textContent || "").trim() !== "使用") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) continue;
      if (r.top < 40 || r.top > innerHeight - 20) continue;
      if (r.top >= bestY) {
        best = el;
        bestY = r.top;
      }
    }
    if (!best) return false;
    best.click();
    return true;
  });
  if (!used) {
    await closeWeixinDialogs(page);
    return false;
  }

  await page.waitForTimeout(1200);
  const ok = await confirmCoverCrop(page);
  if (!ok) {
    await closeWeixinDialogs(page);
    return false;
  }

  const end = Date.now() + 8_000;
  while (Date.now() < end) {
    const open = await page.locator(".weui-desktop-dialog__wrp").count();
    if (open === 0) return true;
    await page.waitForTimeout(400);
  }
  await closeWeixinDialogs(page);
  return true;
}

async function fillDigest(page: Page, summary: string) {
  if (!summary.trim()) return;
  const box = page.locator("#js_description, textarea.js_desc, textarea[placeholder*='摘要'], textarea[placeholder*='选填']").first();
  if ((await box.count()) === 0) return;
  if (!(await box.isVisible().catch(() => false))) return;
  await box.fill(summary.slice(0, 120)).catch(() => undefined);
}

function pageIsLogin(page: Page) {
  return page.evaluate(() => {
    const url = location.href;
    if (/loginpage|login\?/i.test(url)) return true;
    return (
      !!document.body?.innerText?.includes("微信扫一扫") &&
      !!document.querySelector(".login__type__container, .login_panel, .qrcheck_box")
    );
  });
}

async function saveDraft(page: Page): Promise<boolean> {
  await closeWeixinDialogs(page);
  const btn = page
    .locator('button:has-text("保存为草稿"), a:has-text("保存为草稿")')
    .first();
  if ((await btn.count()) === 0) return false;
  await btn.click({ timeout: 8000, force: true }).catch(() => undefined);
  // Prefer evaluate click if still blocked
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button, a")] as HTMLElement[];
    for (const el of buttons) {
      if ((el.textContent || "").replace(/\s+/g, "") === "保存为草稿") {
        el.click();
        return;
      }
    }
  });
  await page.waitForTimeout(2000);
  return true;
}

async function publish(
  page: Page,
  content: PublishContent,
): Promise<PublishResult> {
  try {
    const editor = await openNewArticle(page);

    if (!(await isLoggedIn(editor)) || /loginpage|login\?/i.test(editor.url())) {
      return {
        success: false,
        error: "微信公众号未登录或登录已过期，请先在「账号」页扫码连接",
        screenshotPath: await captureDebugScreenshot(editor, "weixin-not-login"),
        keepOpen: true,
      };
    }

    await dismissWeixinPopovers(editor);

    try {
      await fillTitle(editor, content.title);
    } catch (err) {
      return {
        success: false,
        error: `标题写入失败：${err instanceof Error ? err.message : String(err)}`,
        screenshotPath: await captureDebugScreenshot(editor, "weixin-no-title"),
        keepOpen: true,
      };
    }

    await fillAuthor(editor);

    try {
      await fillBody(editor, content);
    } catch (err) {
      return {
        success: false,
        error: `正文写入失败：${err instanceof Error ? err.message : String(err)}`,
        screenshotPath: await captureDebugScreenshot(editor, "weixin-no-body"),
        keepOpen: true,
      };
    }

    await fillDigest(
      editor,
      content.summary || content.bodyText.slice(0, 80),
    );

    const covered =
      (await uploadLocalCover(editor, content.coverPath).catch(() => false)) ||
      (await selectAiCover(
        editor,
        content.title,
        content.bodyText || content.summary || "",
      ).catch((err) => {
        console.warn("[weixin] AI cover failed:", err);
        return false;
      }));
    if (!covered) {
      console.warn("[weixin] AI cover skipped");
    }

    const saved = await saveDraft(editor);
    await editor.waitForTimeout(1500);
    const toast = editor.getByText(/保存成功|已保存|已存入草稿/);
    const okToast = (await toast.count()) > 0;
    const hasMsgId = /appmsgid=\d+/i.test(editor.url());
    const stillEditor = isEditorUrl(editor.url()) && !(await pageIsLogin(editor));

    if ((saved && (okToast || hasMsgId)) || okToast || hasMsgId) {
      return { success: true, url: editor.url() };
    }

    if (!stillEditor) {
      return {
        success: false,
        error: "微信公众号登录已失效，请在「账号」页重新扫码连接后再发",
        screenshotPath: await captureDebugScreenshot(editor, "weixin-session-lost"),
        keepOpen: true,
      };
    }

    return {
      success: false,
      error:
        "标题/正文已尝试写入，但未确认存草稿。请在打开的窗口点「保存为草稿」后关闭窗口",
      screenshotPath: await captureDebugScreenshot(editor, "weixin-await-manual"),
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
