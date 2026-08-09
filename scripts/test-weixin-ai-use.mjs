import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const sessionFile = path.join(process.cwd(), "data/sessions/weixin.json");
const chrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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
await page.waitForTimeout(2500);

const coverBtn = page.locator(".js_cover_btn_area").first();
await coverBtn.scrollIntoViewIfNeeded();
await coverBtn.click({ force: true });
await page.waitForTimeout(600);
await page.evaluate(() => {
  const nodes = [...document.querySelectorAll("a.js_aiImage")];
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.width > 2 && r.height > 2) {
      el.click();
      return;
    }
  }
});
await page.waitForTimeout(2000);

// Find everything containing 使用
const uses = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    if ((el.textContent || "").trim() !== "使用") continue;
    if (el.children.length > 2) continue;
    const r = el.getBoundingClientRect();
    out.push({
      tag: el.tagName,
      cls: String(el.className).slice(0, 100),
      role: el.getAttribute("role"),
      w: Math.round(r.width),
      h: Math.round(r.height),
      x: Math.round(r.x),
      y: Math.round(r.y),
      display: getComputedStyle(el).display,
      vis: r.width > 0 && r.height > 0,
    });
  }
  return out;
});
console.log("uses", JSON.stringify(uses, null, 2));

// Find send / generate controls
const controls = await page.evaluate(() => {
  const out = [];
  const ph = document.querySelector('textarea[placeholder*="描述"]');
  if (ph) {
    const r = ph.getBoundingClientRect();
    out.push({ kind: "textarea", ph: ph.placeholder, w: r.width, h: r.height });
  }
  for (const el of document.querySelectorAll("button, a, [role=button], .btn, i, span")) {
    const t = (el.getAttribute("aria-label") || el.className || "") + "";
    if (/send|submit|生成|创作|arrow|icon/i.test(t) || /send|submit/i.test(el.className)) {
      const r = el.getBoundingClientRect();
      if (r.width < 2) continue;
      out.push({
        tag: el.tagName,
        cls: String(el.className).slice(0, 80),
        aria: el.getAttribute("aria-label"),
        t: (el.innerText || "").trim().slice(0, 20),
        x: Math.round(r.x),
        y: Math.round(r.y),
      });
    }
  }
  return out.slice(0, 30);
});
console.log("controls", JSON.stringify(controls, null, 2));

// Click 使用 via evaluate
const used = await page.evaluate(() => {
  for (const el of document.querySelectorAll("*")) {
    if ((el.textContent || "").trim() !== "使用") continue;
    if (el.children.length > 3) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 10 && r.height > 10) {
      el.click();
      return { ok: true, cls: String(el.className), tag: el.tagName };
    }
  }
  return { ok: false };
});
console.log("click use", used);
await page.waitForTimeout(2000);

const after = await page.evaluate(() => {
  return {
    dialogs: !!document.querySelector('[class*="ai"], .weui-desktop-dialog'),
    coverImgs: document.querySelectorAll(
      ".setting-group__cover img, .select-cover__btn img, .js_cover_preview img",
    ).length,
    nextBtns: [...document.querySelectorAll("button, a")]
      .filter((el) => /下一步|确定|完成|裁剪/.test((el.textContent || "").trim()))
      .map((el) => (el.textContent || "").trim())
      .slice(0, 10),
  };
});
console.log("after", after);
await page.screenshot({
  path: path.join(process.cwd(), "data/debug/weixin-ai-use.png"),
  fullPage: true,
});

await browser.close();
