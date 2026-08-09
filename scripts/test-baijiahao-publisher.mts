import { chromium } from "playwright";
import fs from "fs";
import { baijiahaoPublisher } from "../src/lib/publishers/baijiahao.ts";

const chrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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
  const longBody =
    "正文用于百家号 AI 封面与发布验证。GEO 是生成式引擎优化，帮助内容被 AI 搜索引用。" +
    "对初创企业来说，与其先砸广告，不如把官网、博客和产品说明写成机器愿意引用的答案。" +
    "可以从高频问题入手：用户会问什么、竞品页面写了什么、自己独特的经验是什么。" +
    "每篇文章围绕一个清晰结论展开，配上可核对的步骤、数据和案例，方便模型摘取。" +
    "发布后观察哪些页面被引用，再迭代标题、摘要和结构化小节，形成可持续的内容飞轮。" +
    "这篇测试文刻意写长一些，避免百家号弹出正文少于二百字的提醒干扰自动化流程。";
  const result = await baijiahaoPublisher.publish(page, {
    title: "GEO对初创企业有用吗？一篇讲清怎么开始",
    bodyMarkdown: longBody,
    bodyHtml: `<p>${longBody}</p><p>补充：保持图文发布，完成封面选择后直接点发布。</p>`,
    bodyText: `${longBody}补充：保持图文发布，完成封面选择后直接点发布。`,
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
  await page.waitForTimeout(2000).catch(() => undefined);
  await browser.close().catch(() => undefined);
}
