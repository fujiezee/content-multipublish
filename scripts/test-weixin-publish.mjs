/**
 * End-to-end WeChat MP publish smoke test using weixinPublisher.
 */
import { openContext } from "../src/lib/publishers/browser.ts";
import { weixinPublisher } from "../src/lib/publishers/weixin.ts";

const { context } = await openContext("weixin", {
  headless: true,
  useSession: true,
});
const page = await context.newPage();

const content = {
  title: "点物GEO公众号发布测试",
  bodyHtml: "<p>这是自动发布测试正文，验证标题、正文与编辑器打开。</p><p>第二段内容。</p>",
  bodyText: "这是自动发布测试正文，验证标题、正文与编辑器打开。第二段内容。",
  bodyMarkdown: "这是自动发布测试正文",
  summary: "自动发布测试摘要",
  coverPath: null,
};

console.log("start publish…");
const result = await weixinPublisher.publish(page, content);
console.log(JSON.stringify({ result, finalUrl: page.url() }, null, 2));

// Also log sibling pages
for (const p of context.pages()) {
  console.log("page:", p.url().slice(0, 160));
}

await context.close();
process.exit(result.success ? 0 : 1);
