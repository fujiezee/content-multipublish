import { chromium } from "playwright";
import { pathToFileURL } from "url";
import path from "path";
import fs from "fs";

const chrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { cto51Publisher } = await import(
  pathToFileURL(path.join(process.cwd(), "src/lib/publishers/cto51.ts")).href
);

const browser = await chromium.launch({
  headless: false,
  executablePath: fs.existsSync(chrome) ? chrome : undefined,
});
const ctx = await browser.newContext({
  storageState: "data/sessions/cto51.json",
  locale: "zh-CN",
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();
try {
  const result = await cto51Publisher.publish(page, {
    title: "新公司从零开始做GEO的完整入门指南",
    bodyMarkdown:
      "这是一篇关于 GEO 与人工智能搜索优化的文章正文，用于验证一级分类选择。",
    bodyHtml:
      "<p>这是一篇关于 GEO 与人工智能搜索优化的文章正文，用于验证一级分类选择。</p>",
    bodyText:
      "这是一篇关于 GEO 与人工智能搜索优化的文章正文，用于验证一级分类选择。",
    summary: "GEO入门",
    coverPath: null,
  });
  console.log("RESULT", JSON.stringify(result, null, 2));
  await page
    .screenshot({ path: "data/debug/cto51-publish-final.png", fullPage: true })
    .catch(() => undefined);
  process.exitCode = result.success ? 0 : 1;
} finally {
  await browser.close().catch(() => undefined);
}
