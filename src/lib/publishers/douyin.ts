import fs from "fs";
import os from "os";
import path from "path";
import type { Cookie, Page } from "playwright";
import {
  captureDebugScreenshot,
  clickFirstVisible,
} from "@/lib/publishers/browser";
import {
  dismissCommonOverlays,
  fillBySelectors,
  pasteIntoFirst,
} from "@/lib/publishers/helpers";
import { rewriteDouyinArticleTitle } from "@/lib/ai/douyin-title";
import { DATA_DIR, UPLOADS_DIR } from "@/lib/paths";
import type { PlatformPublisher } from "@/lib/publishers/types";
import type { PublishContent, PublishResult } from "@/lib/types";

const ARTICLE_EDITOR =
  "https://creator.douyin.com/creator-micro/content/post/article?default-tab=3&enter_from=publish_page&media_type=article&type=new";
const ARTICLE_FALLBACKS = [
  ARTICLE_EDITOR,
  "https://creator.douyin.com/creator-micro/content/post/article?media_type=article&type=new",
  "https://creator.douyin.com/creator-micro/content/post/article",
];
const IMAGE_EDITOR =
  "https://creator.douyin.com/creator-micro/content/upload?default-tab=3&enter_from=publish";
const IMAGE_FALLBACKS = [
  IMAGE_EDITOR,
  "https://creator.douyin.com/creator-micro/content/upload?default-tab=3",
  "https://creator.douyin.com/creator-micro/content/post/image?default-tab=3&enter_from=publish_page&media_type=image&type=new",
];
const HOME = "https://creator.douyin.com/creator-micro/home";
const LOGIN = "https://creator.douyin.com/";

/**
 * Real login cookies only — guest / landing pages also set
 * passport_csrf_token / odin_tt / ttwid and must NOT count as logged in.
 */
const SESSION_COOKIE_NAMES = [
  "sessionid",
  "sessionid_ss",
  "sid_guard",
  "sid_tt",
  "sid_ucp_v1",
  "uid_tt",
  "uid_tt_ss",
] as const;

export function cookiesHaveDouyinSession(
  cookies: { name: string; value?: string | null }[],
): boolean {
  const byName = new Map(
    cookies.map((c) => [c.name, c.value ?? ""] as const),
  );
  const hasSession =
    (byName.get("sessionid")?.length ?? 0) > 10 ||
    (byName.get("sessionid_ss")?.length ?? 0) > 10 ||
    (byName.get("sid_tt")?.length ?? 0) > 10 ||
    (byName.get("sid_ucp_v1")?.length ?? 0) > 10 ||
    (byName.get("sid_guard")?.length ?? 0) > 10;
  const hasUid =
    (byName.get("uid_tt")?.length ?? 0) > 5 ||
    (byName.get("uid_tt_ss")?.length ?? 0) > 5 ||
    hasSession;
  return hasSession && hasUid;
}

export async function readDouyinCookies(page: Page): Promise<Cookie[]> {
  const all = await page.context().cookies();
  return all.filter((c) =>
    /(douyin|iesdouyin|bytedance)\.com$/i.test(c.domain.replace(/^\./, "")),
  );
}

async function hasDouyinSessionCookie(page: Page): Promise<boolean> {
  const cookies = await readDouyinCookies(page);
  return cookiesHaveDouyinSession(cookies);
}

async function hasDouyinLoginCard(page: Page): Promise<boolean> {
  const markers = [
    "text=扫码登录",
    "text=手机号登录",
    "text=验证码登录",
    "text=请使用抖音APP扫码",
    "text=打开抖音扫一扫",
    "text=我是创作者",
    "text=创作者登录",
    'button:has-text("登录"):visible',
    '[class*="login-card"]',
    '[class*="loginCard"]',
    "#animate_qrcode_container",
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
  if (/passport|sso\.|\/login\b|account\/login|scan\/login/i.test(url)) {
    return false;
  }
  if (!(await hasDouyinSessionCookie(page))) return false;
  if (await hasDouyinLoginCard(page)) return false;
  if (/creator\.douyin\.com\/?(\?|$)/i.test(url) && !/creator-micro/i.test(url)) {
    return false;
  }
  return true;
}

function isArticleEditorUrl(url: string): boolean {
  return /post\/article|media_type=article/i.test(url);
}

function isEditorUrl(url: string): boolean {
  return /creator-micro\/content\/(upload|post\/image|post\/video|post\/article)/i.test(
    url,
  );
}

function isManageUrl(url: string): boolean {
  return /creator-micro\/content\/(manage|draft|list)|content\/post\/success/i.test(
    url,
  );
}

function resolveLocalFile(filePath: string | null): string | null {
  if (!filePath) return null;
  if (/^https?:\/\//i.test(filePath)) return null;
  const candidates = [
    filePath,
    path.join(process.cwd(), filePath.replace(/^\//, "")),
    path.join(DATA_DIR, filePath.replace(/^\/?data\//, "")),
    path.join(UPLOADS_DIR, path.basename(filePath)),
    path.join(
      UPLOADS_DIR,
      filePath.replace(/^\/?api\/uploads\//, "").replace(/^\//, ""),
    ),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

function collectImageSources(content: PublishContent): string[] {
  const out: string[] = [];
  const push = (u?: string | null) => {
    const s = String(u || "").trim();
    if (!s || out.includes(s)) return;
    out.push(s);
  };
  const html = content.bodyHtml || "";
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m = re.exec(html);
  while (m) {
    const src = m[1].trim();
    if (src.startsWith("data:") && src.length < 400) {
      m = re.exec(html);
      continue;
    }
    push(src);
    m = re.exec(html);
  }
  push(content.coverPath);
  return out.slice(0, 9);
}

async function downloadRemoteImage(
  src: string,
  destBase: string,
  page?: Page,
): Promise<string | null> {
  const write = async (buf: Buffer, ctype: string) => {
    if (buf.length < 80) return null;
    const ext = /png/i.test(ctype)
      ? "png"
      : /webp/i.test(ctype)
        ? "webp"
        : /gif/i.test(ctype)
          ? "gif"
          : "jpg";
    const file = `${destBase}.${ext}`;
    await fs.promises.writeFile(file, buf);
    return file;
  };
  if (page) {
    try {
      const res = await page.request.get(src, { timeout: 30_000 });
      if (res.ok()) {
        const file = await write(
          Buffer.from(await res.body()),
          res.headers()["content-type"] || "",
        );
        if (file) return file;
      }
    } catch {
      // fall through
    }
  }
  try {
    const res = await fetch(src, {
      headers: { Accept: "image/*,*/*;q=0.8" },
    });
    if (!res.ok) return null;
    return write(
      Buffer.from(await res.arrayBuffer()),
      res.headers.get("content-type") || "",
    );
  } catch {
    return null;
  }
}

async function materializeImages(
  content: PublishContent,
  page?: Page,
): Promise<{ sources: string[]; files: string[] }> {
  const sources = collectImageSources(content);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "douyin-img-"));
  const files: string[] = [];
  let i = 0;
  for (const src of sources) {
    const local = resolveLocalFile(src);
    if (local) {
      files.push(local);
      continue;
    }
    if (!/^https?:\/\//i.test(src)) continue;
    const file = await downloadRemoteImage(src, path.join(dir, `p${i}`), page);
    if (file) {
      files.push(file);
      i += 1;
    }
  }
  return { sources, files };
}

async function dismissDraftRestore(page: Page): Promise<void> {
  const hint = page.getByText(/恢复上次|未保存的草稿|是否恢复|继续编辑上次|检测到草稿/);
  if ((await hint.count()) === 0) return;
  if (!(await hint.first().isVisible().catch(() => false))) return;
  await clickFirstVisible(page, [
    'button:has-text("不恢复")',
    'button:has-text("放弃")',
    'button:has-text("不使用")',
    'button:has-text("新建")',
    'button:has-text("取消")',
  ]).catch(() => undefined);
}

async function articleCapabilityBlocked(page: Page): Promise<boolean> {
  return page
    .getByText(/开通文章|暂未开放文章|文章功能未开通|申请开通文章|该功能暂未对你开放|暂无文章权限/)
    .first()
    .isVisible()
    .catch(() => false);
}

async function pickArticleBody(page: Page) {
  const editors = page.locator(
    [
      ".ProseMirror[contenteditable='true']",
      "[data-slate-editor='true']",
      'div[contenteditable="true"][role="textbox"]',
      ".syl-editor [contenteditable='true']",
      'div[contenteditable="true"]',
    ].join(", "),
  );
  const n = await editors.count();
  for (let i = 0; i < n; i++) {
    const el = editors.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const ph = (
      (await el.getAttribute("data-placeholder").catch(() => "")) ||
      (await el.getAttribute("placeholder").catch(() => "")) ||
      ""
    ).toString();
    if (/标题/.test(ph)) continue;
    const box = await el.boundingBox().catch(() => null);
    if (box && box.height >= 80) return el;
  }
  return n > 1 ? editors.nth(1) : n > 0 ? editors.first() : null;
}

async function articleEditorReady(page: Page): Promise<boolean> {
  if (/passport|\/login/i.test(page.url())) return false;
  if (await articleCapabilityBlocked(page)) return false;
  const title = page
    .locator(
      [
        'input[placeholder*="文章标题"]',
        'input[placeholder*="添加标题"]',
        'textarea[placeholder*="文章标题"]',
        'input[placeholder*="2-30"]',
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        "input.semi-input",
      ].join(", "),
    )
    .first();
  const titleOk = await title.isVisible().catch(() => false);
  const body = await pickArticleBody(page);
  const bodyOk = Boolean(body && (await body.isVisible().catch(() => false)));
  if (isArticleEditorUrl(page.url()) && titleOk && bodyOk) return true;
  const chrome = await page
    .getByText(/写文章|添加正文|请输入正文|文章标题/)
    .first()
    .isVisible()
    .catch(() => false);
  return titleOk && bodyOk && chrome;
}

async function insertHtmlIntoEditor(
  editor: ReturnType<Page["locator"]>,
  html: string,
): Promise<boolean> {
  try {
    await editor.evaluate((node, htmlContent) => {
      const el = node as HTMLElement;
      el.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection?.removeAllRanges();
      selection?.addRange(range);
      let ok = false;
      if (typeof document.execCommand === "function") {
        ok = document.execCommand("insertHTML", false, htmlContent);
      }
      if (!ok) el.innerHTML = htmlContent;
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertFromPaste",
        }),
      );
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, html);
    return true;
  } catch {
    return false;
  }
}

async function openArticleEditor(page: Page): Promise<boolean> {
  let lastErr: unknown;
  for (const url of ARTICLE_FALLBACKS) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(1800);
      await dismissCommonOverlays(page);
      await dismissDraftRestore(page);
      if (/passport|\/login/i.test(page.url())) return false;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr && !isEditorUrl(page.url())) throw lastErr;

  if (!(await articleEditorReady(page))) {
    for (const label of ["发文章", "写文章", "文章"]) {
      await clickFirstVisible(page, [
        `[role="tab"]:has-text("${label}")`,
        `button:has-text("${label}")`,
        `div[class*="tab"]:has-text("${label}")`,
      ]).catch(() => undefined);
    }
    await page.waitForTimeout(900);
    await dismissCommonOverlays(page);
    await dismissDraftRestore(page);
  }

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await articleEditorReady(page)) return true;
    if (await articleCapabilityBlocked(page)) return false;
    if (
      /creator-micro\/content\/(upload|post\/image)/i.test(page.url()) &&
      !isArticleEditorUrl(page.url())
    ) {
      return false;
    }
    await page.waitForTimeout(400);
  }
  return articleEditorReady(page);
}

async function fillArticle(page: Page, content: PublishContent): Promise<void> {
  const title = await rewriteDouyinArticleTitle(
    content.title,
    content.bodyText,
  );
  await fillBySelectors(
    page,
    [
      'input[placeholder*="文章标题"]',
      'input[placeholder*="添加标题"]',
      'textarea[placeholder*="文章标题"]',
      'input[placeholder*="2-30"]',
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      "input.semi-input",
    ],
    title,
  ).catch(() => undefined);

  const plain = (
    content.bodyText ||
    content.bodyMarkdown ||
    content.title
  ).trim();
  const html = (content.bodyHtml || `<p>${plain}</p>`).trim();
  const body = await pickArticleBody(page);
  if (!body) throw new Error("找不到抖音文章正文编辑器");

  await body.click({ timeout: 8000 });
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(120);

  let filled = await insertHtmlIntoEditor(body, html);
  if (!filled) {
    filled = Boolean(
      await pasteIntoFirst(
        page,
        [
          ".ProseMirror[contenteditable='true']",
          'div[contenteditable="true"][role="textbox"]',
          'div[contenteditable="true"]',
        ],
        html,
        plain,
        "html",
      ).catch(() => null),
    );
  }
  if (!filled) {
    await body.click({ timeout: 4000 }).catch(() => undefined);
    await page.keyboard.insertText(plain.slice(0, 8000));
  }
}

async function publishArticle(
  page: Page,
  content: PublishContent,
): Promise<PublishResult> {
  await fillArticle(page, content);
  await page.waitForTimeout(400);

  return {
    success: true,
    outcome: "filled_awaiting_publish",
    awaitingUserPublish: true,
    draftOnly: true,
    url: page.url(),
    error:
      "抖音文章已写入标题和正文。请你在打开的窗口里处理封面和发布；处理完后关闭窗口即可",
    screenshotPath: await captureDebugScreenshot(page, "douyin-await-manual"),
    keepOpen: true,
  };
}

async function openImageEditor(page: Page): Promise<void> {
  let lastErr: unknown;
  for (const url of IMAGE_FALLBACKS) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(2200);
      await dismissCommonOverlays(page);
      if (/passport|\/login/i.test(page.url())) return;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr && !isEditorUrl(page.url())) throw lastErr;

  for (const label of ["图文", "发布图文", "图片"]) {
    await clickFirstVisible(page, [
      `[role="tab"]:has-text("${label}")`,
      `button:has-text("${label}")`,
      `div[class*="tab"]:has-text("${label}")`,
      `span:has-text("${label}")`,
    ]).catch(() => undefined);
  }
  await page.waitForTimeout(1000);
  await dismissCommonOverlays(page);
  await page
    .getByText(/上传图文|将图片拖|点击上传/)
    .first()
    .waitFor({ timeout: 8_000 })
    .catch(() => undefined);
}

async function pickImageFileInput(page: Page) {
  const inputs = page.locator('input[type="file"]');
  const n = await inputs.count();
  let fallback = -1;
  for (let i = 0; i < n; i++) {
    const accept = (
      (await inputs.nth(i).getAttribute("accept")) || ""
    ).toLowerCase();
    if (/image\/|\.png|\.jpe?g|\.webp|\.gif/i.test(accept)) {
      return inputs.nth(i);
    }
    if (/video\/|\.mp4/i.test(accept)) continue;
    if (fallback < 0) fallback = i;
  }
  if (n > 1) return inputs.nth(1);
  if (fallback >= 0) return inputs.nth(fallback);
  return n > 0 ? inputs.first() : null;
}

async function countAddedImages(page: Page): Promise<number> {
  const labeled = page.getByText(/已添加\s*\d+\s*张/);
  if ((await labeled.count()) > 0) {
    const text = (await labeled.first().innerText().catch(() => "")) || "";
    const m = text.match(/已添加\s*(\d+)\s*张/);
    if (m) return Number(m[1]);
  }
  if (
    await page
      .getByText(/继续添加|编辑图片|预览图文/)
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    return 1;
  }
  return 0;
}

async function uploadImages(page: Page, files: string[]): Promise<number> {
  if (!files.length) return 0;
  const input = await pickImageFileInput(page);
  if (!input) return 0;
  await input.setInputFiles(files);
  const deadline = Date.now() + 45_000;
  let last = 0;
  while (Date.now() < deadline) {
    const n = await countAddedImages(page);
    if (n > last) last = n;
    if (n >= 1) {
      await page.waitForTimeout(600);
      return n;
    }
    await page.waitForTimeout(400);
  }
  return last;
}

async function fillCopy(page: Page, content: PublishContent): Promise<void> {
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

  const editor = page
    .locator(
      [
        "div.editor-comp-publish[contenteditable='true']",
        ".editor-comp-publish [contenteditable='true']",
        '[data-placeholder*="添加作品描述"]',
        '[placeholder*="添加作品描述"]',
        'div[contenteditable="true"]',
        ".ace-line",
      ].join(", "),
    )
    .first();
  if ((await editor.count()) === 0) return;
  if (!(await editor.isVisible().catch(() => false))) return;
  await editor.click({ timeout: 8000 });
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(desc);
}

async function trySaveDraft(page: Page): Promise<boolean> {
  await clickFirstVisible(page, [
    'button:has-text("暂存离开")',
    'button:has-text("存草稿")',
    'button:has-text("暂存")',
  ]).catch(() => undefined);
  const start = Date.now();
  while (Date.now() - start < 12_000) {
    if (isManageUrl(page.url())) return true;
    const toast = page.getByText(/暂存成功|已保存草稿|保存成功|已存草稿/);
    if ((await toast.count()) > 0) {
      await page.waitForTimeout(800);
      return isManageUrl(page.url()) || !isEditorUrl(page.url());
    }
    await page.waitForTimeout(500);
  }
  return isManageUrl(page.url());
}

async function publishImagePost(
  page: Page,
  content: PublishContent,
): Promise<PublishResult> {
  await openImageEditor(page);

  if (!(await isLoggedIn(page)) || /passport|\/login/i.test(page.url())) {
    return {
      success: false,
      error:
        "抖音未登录或登录已过期。请在打开的窗口扫码登录，登录成功后关闭窗口，下次会记住登录态",
      screenshotPath: await captureDebugScreenshot(page, "douyin-not-login"),
      keepOpen: true,
    };
  }

  const { sources, files } = await materializeImages(content, page);
  const uploaded = await uploadImages(page, files);
  if (uploaded < 1) {
    const why = sources.length
      ? files.length
        ? `稿里有 ${sources.length} 张图，已下载 ${files.length} 张，但抖音「图文」上传框没吃到。请确认窗口停在图文页后手动拖进去`
        : `稿里有 ${sources.length} 张图，本机没下载下来（${sources[0].slice(0, 96)}）。请检查图床或在打开的窗口手动选图`
      : "这篇给抖音的稿里没有图片地址。文章页打不开时会退回图文，请给主稿加上封面/正文图后再同步";
    return {
      success: false,
      error: why,
      screenshotPath: await captureDebugScreenshot(page, "douyin-no-image"),
      keepOpen: true,
    };
  }

  await fillCopy(page, content);
  await page.waitForTimeout(600);

  const saved = await trySaveDraft(page);
  if (saved) {
    return {
      success: true,
      draftOnly: true,
      url: page.url(),
    };
  }

  return {
    success: true,
    outcome: "filled_awaiting_publish",
    awaitingUserPublish: true,
    draftOnly: true,
    url: page.url(),
    error:
      "抖音图文已填入图片和文案，但未确认存草稿。请在打开的窗口核对后点「存草稿」或「发布」；完成后请关闭窗口",
    screenshotPath: await captureDebugScreenshot(page, "douyin-await-manual"),
    keepOpen: true,
  };
}

async function publish(
  page: Page,
  content: PublishContent,
): Promise<PublishResult> {
  try {
    const openedArticle = await openArticleEditor(page);

    if (!(await isLoggedIn(page)) || /passport|\/login/i.test(page.url())) {
      return {
        success: false,
        error:
          "抖音未登录或登录已过期。请在打开的窗口扫码登录，登录成功后关闭窗口，下次会记住登录态",
        screenshotPath: await captureDebugScreenshot(page, "douyin-not-login"),
        keepOpen: true,
      };
    }

    if (openedArticle && (await articleEditorReady(page))) {
      return await publishArticle(page, content);
    }

    return await publishImagePost(page, content);
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
  name: "抖音文章",
  loginUrl: LOGIN,
  editorUrl: ARTICLE_EDITOR,
  isLoggedIn,
  publish,
};

export const douyinHomeUrl = HOME;
export { SESSION_COOKIE_NAMES };
