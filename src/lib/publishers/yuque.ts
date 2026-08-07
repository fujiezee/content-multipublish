import type { Page } from "playwright";
import { captureDebugScreenshot } from "@/lib/publishers/browser";
import type { PlatformPublisher } from "@/lib/publishers/types";
import {
  dismissCommonOverlays,
  hasCookieMatch,
  writeClipboardHtml,
} from "@/lib/publishers/helpers";
import type { PublishContent, PublishResult } from "@/lib/types";

const LOGIN_URL = "https://www.yuque.com/login";
const DASHBOARD_URL = "https://www.yuque.com/dashboard";

type YuqueAuth = {
  csrf: string;
  login: string;
};

type YuqueBook = {
  id: number;
  namespace: string;
  name: string;
};

type YuqueApiDoc = {
  editUrl: string;
  viewUrl: string;
};

type YuqueApiError = {
  error: string;
};

function buildYuqueHeaders(auth: YuqueAuth) {
  return {
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
    "x-csrf-token": auth.csrf,
    "x-login": auth.login,
  };
}

async function readYuqueAuth(page: Page): Promise<YuqueAuth | null> {
  return page.evaluate(() => {
    const csrf =
      document.cookie.match(/(?:^|;\s*)yuque_ctoken=([^;]+)/)?.[1] ||
      document.cookie.match(/(?:^|;\s*)ctoken=([^;]+)/)?.[1] ||
      "";
    const login =
      (window as unknown as { appData?: { me?: { login?: string } } }).appData
        ?.me?.login || "";
    if (!csrf || !login) return null;
    return { csrf: decodeURIComponent(csrf), login };
  });
}

async function isLoggedIn(page: Page): Promise<boolean> {
  if (/\/login|passport/i.test(page.url())) return false;
  if (await readYuqueAuth(page)) return true;
  return hasCookieMatch(
    page,
    ["https://www.yuque.com"],
    /yuque_ctoken|_yuque_session|_yuque/i,
  );
}

async function listYuqueBooks(
  page: Page,
  auth: YuqueAuth,
): Promise<YuqueBook[]> {
  return page.evaluate(async ({ headers }) => {
    const res = await fetch("https://www.yuque.com/api/mine/book_stacks", {
      credentials: "include",
      headers,
    });
    if (!res.ok) return [];
    const json = await res.json();
    const books: Array<{ id: number; namespace: string; name: string }> = [];
    for (const stack of json?.data ?? []) {
      for (const book of stack?.books ?? []) {
        const login =
          (typeof book?.user?.login === "string" && book.user.login) ||
          headers["x-login"];
        const slug = book?.slug;
        if (typeof book?.id === "number" && login && slug) {
          books.push({
            id: book.id,
            namespace: `${login}/${slug}`,
            name: (book.name as string) || slug,
          });
        }
      }
    }
    return books;
  }, { headers: buildYuqueHeaders(auth) });
}

async function resolveYuqueBook(page: Page): Promise<YuqueBook | null> {
  const auth = await readYuqueAuth(page);
  if (!auth) return null;

  const books = await listYuqueBooks(page, auth);
  if (books.length > 0) return books[0];

  const namespace = await page.evaluate(() => {
    const skip = new Set([
      "dashboard",
      "login",
      "settings",
      "explore",
      "notifications",
      "r",
      "go",
      "help",
      "about",
      "terms",
      "privacy",
      "signin",
      "signup",
      "search",
      "groups",
      "mine",
      "www",
    ]);
    for (const a of document.querySelectorAll("a[href]")) {
      try {
        const u = new URL((a as HTMLAnchorElement).href, location.origin);
        if (!u.hostname.endsWith("yuque.com")) continue;
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length !== 2) continue;
        if (skip.has(parts[0]) || skip.has(parts[1])) continue;
        const rect = a.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) continue;
        return `${parts[0]}/${parts[1]}`;
      } catch {
        // ignore
      }
    }
    return null;
  });

  if (!namespace) return null;
  return { id: 0, namespace, name: namespace.split("/")[1] || namespace };
}

async function createYuqueDocViaApi(
  page: Page,
  book: YuqueBook,
  auth: YuqueAuth,
  title: string,
  html: string,
): Promise<YuqueApiDoc | YuqueApiError> {
  return page.evaluate(
    async ({ headers, bookId, namespace, docTitle, docHtml }) => {
      const parseDoc = (data: Record<string, unknown> | undefined) => {
        if (!data) return null;
        if (typeof data.url === "string") {
          const viewUrl = data.url.replace(/\/edit\/?$/, "");
          const editUrl = data.url.includes("/edit")
            ? data.url
            : `${data.url.replace(/\/$/, "")}/edit`;
          return { editUrl, viewUrl };
        }
        const slug = data.slug;
        const [login, bookSlug] = namespace.split("/");
        if (typeof slug === "string" && login && bookSlug) {
          const viewUrl = `https://www.yuque.com/${login}/${bookSlug}/${slug}`;
          return { editUrl: `${viewUrl}/edit`, viewUrl };
        }
        return null;
      };

      if (!bookId) {
        return { error: "语雀未找到知识库 ID" };
      }

      const res = await fetch("https://www.yuque.com/api/docs", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          book_id: bookId,
          title: docTitle,
          format: "html",
          body: docHtml,
          public: 0,
        }),
      });
      const raw = await res.text();
      if (!res.ok) {
        return { error: `${res.status} ${raw.slice(0, 180)}` };
      }
      try {
        const json = JSON.parse(raw) as { data?: Record<string, unknown> };
        const parsed = parseDoc(json.data);
        if (parsed) return parsed;
        return { error: "语雀 API 返回空文档数据" };
      } catch (err) {
        return { error: String(err) };
      }
    },
    {
      headers: buildYuqueHeaders(auth),
      bookId: book.id,
      namespace: book.namespace,
      docTitle: title,
      docHtml: html,
    },
  );
}

async function openYuqueNewDocEditor(page: Page, namespace: string) {
  await page.goto(`https://www.yuque.com/${namespace}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(2500);
  await dismissCommonOverlays(page);

  const catalogHeader = page.locator("text=目录").first();
  if (await catalogHeader.isVisible().catch(() => false)) {
    const headerBox = await catalogHeader.boundingBox();
    if (headerBox) {
      await page.mouse.click(headerBox.x + headerBox.width + 24, headerBox.y + 8);
      await page.waitForTimeout(800);
    }
  }

  for (const label of ["文档", "Markdown", "新文档"]) {
    const item = page.getByText(label, { exact: true });
    if ((await item.count()) > 0 && (await item.first().isVisible().catch(() => false))) {
      await item.first().click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(3500);
      break;
    }
  }
}

async function fillYuqueLakeEditor(page: Page, title: string, html: string) {
  const editor = page
    .locator(
      '.ne-engine [contenteditable="true"], .lake-engine [contenteditable="true"], .ne-editor, .lake-editor',
    )
    .first();
  await editor.waitFor({ state: "visible", timeout: 25_000 });
  await editor.click({ timeout: 10_000 });
  await page.waitForTimeout(300);

  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(150);
  await page.keyboard.type(`# ${title}`, { delay: 12 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);

  const plain = html.replace(/<[^>]+>/g, " ").trim();
  await writeClipboardHtml(page, html, plain);
  await page.keyboard.press(`${mod}+v`);
  await page.waitForTimeout(800);
}

async function publish(
  page: Page,
  content: PublishContent,
): Promise<PublishResult> {
  try {
    await page.goto(DASHBOARD_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);
    await dismissCommonOverlays(page);

    if (!(await isLoggedIn(page))) {
      return {
        success: false,
        error: "语雀未登录或登录已过期，请先在「账号」页重新连接",
        screenshotPath: await captureDebugScreenshot(page, "yuque-not-login"),
        keepOpen: true,
      };
    }

    const auth = await readYuqueAuth(page);
    if (!auth) {
      return {
        success: false,
        error: "语雀登录态不完整，请在「账号」页重新连接语雀",
        screenshotPath: await captureDebugScreenshot(page, "yuque-no-auth"),
        keepOpen: true,
      };
    }

    const book = await resolveYuqueBook(page);
    if (!book) {
      return {
        success: false,
        error:
          "语雀未找到可用知识库。请先在语雀创建一个知识库，或在 dashboard 能看到知识库列表后重试",
        screenshotPath: await captureDebugScreenshot(page, "yuque-no-book"),
        keepOpen: true,
      };
    }

    const title = content.title.slice(0, 100) || "未命名";
    const html = content.bodyHtml || `<p>${content.bodyText || ""}</p>`;

    const apiResult = await createYuqueDocViaApi(page, book, auth, title, html);
    if (!("error" in apiResult)) {
      return { success: true, url: apiResult.viewUrl };
    }

    await openYuqueNewDocEditor(page, book.namespace);
    try {
      await fillYuqueLakeEditor(page, title, html);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `语雀 API 与页面填写均失败（${apiResult.error}；${msg}）`,
        screenshotPath: await captureDebugScreenshot(page, "yuque-fill-failed"),
        keepOpen: true,
      };
    }

    const current = page.url();
    if (
      /yuque\.com\/[^/]+\/[^/]+\/[a-zA-Z0-9_-]+/i.test(current) &&
      !/dashboard|login/i.test(current)
    ) {
      return { success: true, url: current.replace(/\/edit\/?$/, "") };
    }

    return {
      success: false,
      error: `语雀文档未能保存（${apiResult.error}）`,
      screenshotPath: await captureDebugScreenshot(page, "yuque-not-published"),
      keepOpen: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `${message}（完成后请关闭窗口，才会开始下一个平台）`,
      screenshotPath: await captureDebugScreenshot(page, "yuque-error"),
      keepOpen: true,
    };
  }
}

export const yuquePublisher: PlatformPublisher = {
  id: "yuque",
  name: "语雀",
  loginUrl: LOGIN_URL,
  editorUrl: DASHBOARD_URL,
  isLoggedIn,
  publish,
};
