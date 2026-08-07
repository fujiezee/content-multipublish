import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const sessionFile = path.join(process.cwd(), "data/sessions/yuque.json");
const chrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  executablePath: fs.existsSync(chrome) ? chrome : undefined,
});
const context = await browser.newContext({
  storageState: sessionFile,
  locale: "zh-CN",
  viewport: { width: 1360, height: 900 },
});
const page = await context.newPage();

await page.goto("https://www.yuque.com/dashboard", {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.waitForTimeout(2500);

const result = await page.evaluate(async () => {
  const csrf =
    document.cookie.match(/(?:^|;\s*)yuque_ctoken=([^;]+)/)?.[1] || "";
  const token = decodeURIComponent(csrf);
  const login = window.appData?.me?.login || "";
  const headers = {
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
    "x-csrf-token": token,
    "x-login": login,
  };

  const stacks = await fetch("https://www.yuque.com/api/mine/book_stacks", {
    credentials: "include",
    headers,
  }).then((r) => r.json());
  const book = stacks?.data?.[0]?.books?.[0];
  const create = await fetch("https://www.yuque.com/api/docs", {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({
      book_id: book.id,
      title: "点物GEO语雀发布测试",
      format: "html",
      body: "<p>修复后发布测试成功</p>",
      public: 0,
    }),
  });
  const json = await create.json();
  return {
    ok: create.ok,
    status: create.status,
    url: json?.data?.slug
      ? `https://www.yuque.com/${login}/${book.slug}/${json.data.slug}`
      : null,
    error: create.ok ? null : JSON.stringify(json).slice(0, 200),
  };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(result.ok ? 0 : 1);
