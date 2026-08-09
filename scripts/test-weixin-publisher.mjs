/**
 * End-to-end test of the real weixinPublisher.publish() path.
 * Headless for CI-like verification; same storageState as the app.
 */
import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { pathToFileURL } from "url";

const sessionFile = path.join(process.cwd(), "data/sessions/weixin.json");
const chrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Load compiled-style TS via tsx if available, else dynamic import of source via next
async function loadPublisher() {
  try {
    const mod = await import("../src/lib/publishers/weixin.ts");
    return mod.weixinPublisher;
  } catch {
    // fallback: register ts-node/tsx
    const { register } = await import("node:module");
    // use child process with npx tsx instead
    throw new Error("direct import failed");
  }
}

const browser = await chromium.launch({
  headless: false,
  executablePath: fs.existsSync(chrome) ? chrome : undefined,
});
const context = await browser.newContext({
  storageState: sessionFile,
  locale: "zh-CN",
  viewport: { width: 1440, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
});
await context.grantPermissions(["clipboard-read", "clipboard-write"], {
  origin: "https://mp.weixin.qq.com",
});
const page = await context.newPage();

try {
  const { weixinPublisher } = await import(
    pathToFileURL(
      path.join(process.cwd(), "src/lib/publishers/weixin.ts"),
    ).href
  );

  const result = await weixinPublisher.publish(page, {
    title: "点物GEO发布器实机验证",
    bodyMarkdown: "第一段正文。\n\n第二段验证 ProseMirror。",
    bodyHtml: "<p>第一段正文。</p><p>第二段验证 ProseMirror。</p>",
    bodyText: "第一段正文。\n\n第二段验证 ProseMirror。",
    summary: "发布器实机验证摘要",
    coverPath: null,
  });

  console.log("RESULT", JSON.stringify(result, null, 2));
  if (!result.success) {
    process.exitCode = 1;
  }
} catch (e) {
  console.error("FAIL", e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
