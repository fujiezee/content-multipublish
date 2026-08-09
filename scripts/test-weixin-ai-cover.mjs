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
});
const page = await context.newPage();

try {
  await page.goto("https://mp.weixin.qq.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(2000);
  const token = new URL(page.url()).searchParams.get("token");
  await page.goto(
    `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&lang=zh_CN&token=${token}`,
    { waitUntil: "domcontentloaded", timeout: 60_000 },
  );
  await page.waitForTimeout(3000);
  await page.keyboard.press("Escape").catch(() => undefined);

  await page.locator("#title").evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, "AI封面测试");
  await page.locator(".ProseMirror").first().click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.type("AI封面测试", { delay: 5 });
  await page.locator(".ProseMirror").nth(1).click();
  await page.keyboard.type("正文用于封面测试", { delay: 5 });

  // Hover + click cover to open popover
  const coverBtn = page.locator(".js_cover_btn_area").first();
  await coverBtn.scrollIntoViewIfNeeded();
  await coverBtn.hover();
  await page.waitForTimeout(400);
  await coverBtn.click({ force: true });
  await page.waitForTimeout(800);

  // Dump visibility of all AI entries
  const ais = page.locator("a.js_aiImage");
  const n = await ais.count();
  for (let i = 0; i < n; i++) {
    const a = ais.nth(i);
    const box = await a.boundingBox();
    const vis = await a.isVisible().catch(() => false);
    console.log("ai", i, { vis, box });
  }

  // Click via DOM — find the one with non-zero size in the open popover
  const clicked = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("a.js_aiImage")];
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight) {
        el.click();
        return { ok: true, y: r.y, t: el.textContent };
      }
    }
    // fallback: last one
    if (nodes.length) {
      nodes[nodes.length - 1].click();
      return { ok: true, fallback: true };
    }
    return { ok: false };
  });
  console.log("clicked", clicked);
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: path.join(outDir, "weixin-ai-panel.png"),
    fullPage: true,
  });

  const texts = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const t = (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
        ? el.textContent
        : ""
      )?.trim();
      if (!t || t.length > 24) continue;
      if (/创作|生成|比例|描述|关键词|2\.35|同意|使用|上传/.test(t)) {
        const r = el.getBoundingClientRect();
        if (r.width > 1 && r.height > 1) out.push(t);
      }
    }
    return [...new Set(out)].slice(0, 40);
  });
  console.log("ui texts", texts);

  // Try agree
  await page.getByRole("button", { name: /同意|开始使用/ }).first().click({ force: true }).catch(() => undefined);

  await page.getByText("2.35:1").first().click({ force: true }).catch(() => console.log("no ratio"));

  const boxes = page.locator("textarea");
  const bn = await boxes.count();
  console.log("textareas", bn);
  for (let i = 0; i < bn; i++) {
    const b = boxes.nth(i);
    const vis = await b.isVisible().catch(() => false);
    const ph = await b.getAttribute("placeholder");
    console.log("ta", i, vis, ph);
    if (vis) {
      await b.fill("科技感简洁公众号封面，蓝色调");
      break;
    }
  }

  const gen = page.locator('button:has-text("开始创作"), button:has-text("立即生成"), button:has-text("生成")');
  console.log("gen count", await gen.count());
  for (let i = 0; i < (await gen.count()); i++) {
    const g = gen.nth(i);
    if (await g.isVisible().catch(() => false)) {
      await g.click({ force: true });
      console.log("gen clicked", i);
      break;
    }
  }

  const end = Date.now() + 100_000;
  let used = false;
  while (Date.now() < end) {
    const useBtn = page.locator('button:has-text("使用"), button:has-text("插入")');
    for (let i = 0; i < (await useBtn.count()); i++) {
      const u = useBtn.nth(i);
      if (await u.isVisible().catch(() => false)) {
        // pick first result image in dialog
        await page
          .locator('[class*="ai"] img, [role="dialog"] img, .weui-desktop-dialog img')
          .first()
          .click({ force: true })
          .catch(() => undefined);
        await u.click({ force: true });
        used = true;
        console.log("used");
        break;
      }
    }
    if (used) break;
    process.stdout.write(".");
    await page.waitForTimeout(2500);
  }
  console.log("\nused=", used);
  await page.waitForTimeout(1500);
  await page
    .locator('button:has-text("下一步"), button:has-text("确定"), button:has-text("完成")')
    .first()
    .click({ force: true })
    .catch(() => undefined);

  await page.screenshot({
    path: path.join(outDir, "weixin-ai-after.png"),
    fullPage: true,
  });
  const imgs = await page.locator(".setting-group__cover img, .js_cover_preview img, .select-cover__btn img").count();
  console.log("cover imgs", imgs);
  if (!used) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
