import { chromium } from "playwright";
import { pathToFileURL } from "url";
import path from "path";
import fs from "fs";

const chrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Import via dynamic so we can call internals? Better: full publish
const { baijiahaoPublisher } = await import(
  pathToFileURL(path.join(process.cwd(), "src/lib/publishers/baijiahao.ts"))
    .href
);

const browser = await chromium.launch({
  headless: false,
  executablePath: fs.existsSync(chrome) ? chrome : undefined,
});
const ctx = await browser.newContext({
  storageState: "data/sessions/baijiahao.json",
  locale: "zh-CN",
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();
try {
  const result = await baijiahaoPublisher.publish(page, {
    title: "GEO对初创企业有用吗？一篇讲清怎么开始",
    bodyMarkdown:
      "正文用于百家号 AI 封面验证。GEO 是生成式引擎优化，帮助内容被 AI 搜索引用。",
    bodyHtml:
      "<p>正文用于百家号 AI 封面验证。GEO 是生成式引擎优化，帮助内容被 AI 搜索引用。</p>",
    bodyText:
      "正文用于百家号 AI 封面验证。GEO 是生成式引擎优化，帮助内容被 AI 搜索引用。",
    summary: "GEO入门",
    coverPath: null,
  });
  console.log("RESULT", JSON.stringify(result, null, 2));
  await page
    .screenshot({
      path: "data/debug/baijiahao-publish-final.png",
      fullPage: true,
    })
    .catch(() => undefined);
  process.exitCode = result.success ? 0 : 1;
} finally {
  await page.waitForTimeout(1500).catch(() => undefined);
  await browser.close().catch(() => undefined);
}
