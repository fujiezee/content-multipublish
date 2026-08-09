import { chromium } from "playwright";
import { pathToFileURL } from "url";
import path from "path";
import fs from "fs";

const chrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { doubanPublisher } = await import(
  pathToFileURL(path.join(process.cwd(), "src/lib/publishers/douban.ts")).href
);

const browser = await chromium.launch({
  headless: false,
  executablePath: fs.existsSync(chrome) ? chrome : undefined,
});
const ctx = await browser.newContext({
  storageState: "data/sessions/douban.json",
  locale: "zh-CN",
  viewport: { width: 1400, height: 900 },
});
const page = await ctx.newPage();
try {
  const result = await doubanPublisher.publish(page, {
    title: "点物GEO豆瓣发布验证",
    bodyMarkdown: "这是豆瓣日记自动发布验证正文。",
    bodyHtml: "<p>这是豆瓣日记自动发布验证正文。</p>",
    bodyText: "这是豆瓣日记自动发布验证正文。",
    summary: "验证",
    coverPath: null,
  });
  console.log("RESULT", JSON.stringify(result, null, 2));
  await page
    .screenshot({ path: "data/debug/douban-publish-result.png", fullPage: true })
    .catch(() => undefined);
  process.exitCode = result.success ? 0 : 1;
  if (result.keepOpen) {
    console.log("keepOpen — waiting 60s for manual captcha if needed");
    await page.waitForTimeout(60_000).catch(() => undefined);
  }
} finally {
  await browser.close().catch(() => undefined);
}
