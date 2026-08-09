import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const sessionFile = path.join(process.cwd(), "data/sessions/weixin.json");
const outDir = path.join(process.cwd(), "data/debug");
fs.mkdirSync(outDir, { recursive: true });
const chrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const mod = process.platform === "darwin" ? "Meta" : "Control";

const browser = await chromium.launch({
  headless: true,
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
  await page.goto("https://mp.weixin.qq.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(2000);
  const token = new URL(page.url()).searchParams.get("token");
  if (!token) throw new Error("no token");

  await page.goto(
    `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&lang=zh_CN&token=${token}`,
    { waitUntil: "domcontentloaded", timeout: 60_000 },
  );
  await page.waitForTimeout(3000);
  await page.keyboard.press("Escape").catch(() => undefined);
  console.log("editor", page.url().includes("appmsg_edit"));

  // Title: ProseMirror[0] + hidden #title
  const title = "点物GEO公众号自动发布验证";
  await page.locator("#title").evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, title);
  const titlePm = page.locator(".ProseMirror").first();
  await titlePm.click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.type(title, { delay: 8 });
  console.log("title hidden", await page.locator("#title").inputValue());
  console.log("title pm", (await titlePm.innerText()).slice(0, 40));

  // Body: ProseMirror[1]
  const bodyPm = page.locator(".ProseMirror").nth(1);
  await bodyPm.click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.type(
    "自动发布验证正文第一段。\n\n第二段内容，用于确认 ProseMirror 写入。",
    { delay: 5 },
  );
  const bodyLen = (await bodyPm.innerText()).trim().length;
  console.log("bodyLen", bodyLen);

  // Cover open
  await page.getByText("拖拽或选择封面").first().click({ force: true });
  await page.waitForTimeout(1500);
  const ai = page.getByText("AI配图");
  console.log("ai count", await ai.count());
  if ((await ai.count()) > 0) {
    await ai.first().click({ force: true });
    await page.waitForTimeout(1200);
    await page.getByText("2.35:1").first().click({ force: true }).catch(() => undefined);
    const ta = page.locator("textarea").last();
    if (await ta.isVisible().catch(() => false)) {
      await ta.fill("公众号封面，科技感，简洁大气");
      await page
        .getByRole("button", { name: /开始创作|生成/ })
        .first()
        .click()
        .catch(() => undefined);
      const end = Date.now() + 50_000;
      while (Date.now() < end) {
        const useBtn = page.getByRole("button", { name: /^使用$|^插入$/ });
        if ((await useBtn.count()) > 0 && (await useBtn.first().isVisible().catch(() => false))) {
          await page.locator('[role="dialog"] img').first().click({ force: true }).catch(() => undefined);
          await useBtn.first().click({ force: true });
          console.log("cover used");
          break;
        }
        await page.waitForTimeout(2000);
      }
    }
  }

  await page.locator('button:has-text("保存为草稿")').click();
  await page.waitForTimeout(2500);
  const toast = await page.getByText(/保存成功|已保存/).count();
  console.log("toast", toast, "final", page.url().slice(0, 120));
  await page.screenshot({
    path: path.join(outDir, "weixin-e2e-final.png"),
    fullPage: true,
  });
  if (bodyLen < 5) throw new Error("body empty");
  // toast optional if URL got appmsgid
  if (toast === 0 && !/appmsgid=/i.test(page.url())) throw new Error("save failed");
  console.log("OK");
} catch (e) {
  console.error("FAIL", e);
  await page.screenshot({
    path: path.join(outDir, "weixin-e2e-error.png"),
    fullPage: true,
  }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser.close();
}
