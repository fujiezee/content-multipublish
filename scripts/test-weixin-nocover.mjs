/**
 * Publisher path without AI cover — isolate title/body/save.
 */
import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { pathToFileURL } from "url";

const sessionFile = path.join(process.cwd(), "data/sessions/weixin.json");
const chrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Patch: temporarily skip cover by monkeypatching after import
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
  // Inline minimal flow matching weixin.ts without cover
  await page.goto("https://mp.weixin.qq.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(3000);
  console.log("home", page.url().slice(0, 100));
  const token = new URL(page.url()).searchParams.get("token");
  if (!token) throw new Error("no token — session dead");

  await page.goto(
    `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&lang=zh_CN&token=${token}`,
    { waitUntil: "domcontentloaded", timeout: 60_000 },
  );
  await page.waitForTimeout(3000);
  await page.keyboard.press("Escape").catch(() => undefined);
  console.log("editor", page.url().includes("appmsg_edit"));

  const mod = process.platform === "darwin" ? "Meta" : "Control";
  const title = "点物GEO无封面发布验证";
  await page.locator("#title").evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, title);
  await page.locator(".ProseMirror").first().click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.type(title, { delay: 8 });
  await page.locator(".ProseMirror").nth(1).click();
  await page.keyboard.type("无封面正文验证第一段。\n\n第二段。", { delay: 5 });
  console.log(
    "body",
    (await page.locator(".ProseMirror").nth(1).innerText()).trim().slice(0, 40),
  );

  await page.evaluate(() => {
    for (const el of document.querySelectorAll("button")) {
      if ((el.textContent || "").replace(/\s+/g, "") === "保存为草稿") {
        el.click();
        return;
      }
    }
  });
  await page.waitForTimeout(2500);
  const toast = await page.getByText(/保存成功|已保存|已存入草稿/).count();
  console.log("toast", toast, "url", page.url().slice(0, 120));
  await page.screenshot({
    path: path.join(process.cwd(), "data/debug/weixin-nocover-save.png"),
    fullPage: true,
  });
  if (toast === 0 && !/appmsgid=/i.test(page.url())) throw new Error("save failed");
  console.log("OK");
} catch (e) {
  console.error("FAIL", e);
  await page
    .screenshot({
      path: path.join(process.cwd(), "data/debug/weixin-nocover-error.png"),
      fullPage: true,
    })
    .catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser.close();
}
