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
await page.goto("https://mp.weixin.qq.com/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
const token = new URL(page.url()).searchParams.get("token");
await page.goto(
  `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&lang=zh_CN&token=${token}`,
  { waitUntil: "domcontentloaded" },
);
await page.waitForTimeout(3500);
await page.keyboard.press("Escape").catch(() => undefined);

const info = await page.evaluate(() => {
  const title = document.querySelector("#title");
  const near = [];
  const walk = document.querySelectorAll(
    "#title, .js_title, [placeholder*='标题'], [contenteditable='true'], .ProseMirror, label, span, div",
  );
  for (const el of walk) {
    const t = (el.textContent || "").trim();
    const ph = el.getAttribute("placeholder") || "";
    if (
      el.id === "title" ||
      /标题/.test(ph) ||
      t === "请在这里输入标题" ||
      (el.classList?.contains("ProseMirror") && el.getBoundingClientRect().top < 400)
    ) {
      const r = el.getBoundingClientRect();
      near.push({
        tag: el.tagName,
        id: el.id,
        cls: String(el.className || "").slice(0, 70),
        ph,
        text: t.slice(0, 30),
        w: Math.round(r.width),
        h: Math.round(r.height),
        top: Math.round(r.top),
        visible: !!(r.width && r.height),
        ce: el.getAttribute("contenteditable"),
      });
    }
  }
  // How is title bound?
  const style = title ? getComputedStyle(title) : null;
  return {
    titleDisplay: style?.display,
    titleVisibility: style?.visibility,
    titleOpacity: style?.opacity,
    titleSize: title
      ? {
          w: title.getBoundingClientRect().width,
          h: title.getBoundingClientRect().height,
        }
      : null,
    near: near.slice(0, 25),
  };
});
console.log(JSON.stringify(info, null, 2));

// Try force-set hidden title + click visible placeholder
await page.locator("#title").evaluate((el, v) => {
  el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}, "强制写入隐藏标题测试");
console.log("forced value", await page.locator("#title").inputValue());

const placeholder = page.getByText("请在这里输入标题", { exact: true }).first();
console.log(
  "placeholder count/visible",
  await placeholder.count(),
  await placeholder.isVisible().catch(() => false),
);

await page.screenshot({
  path: path.join(process.cwd(), "data/debug/weixin-title-probe.png"),
  fullPage: false,
});
await browser.close();
