import { chromium } from "playwright";
import fs from "fs";

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
  await page.goto(
    "https://baijiahao.baidu.com/builder/rc/edit?type=news&is_from_cms=1",
    { waitUntil: "domcontentloaded", timeout: 60_000 },
  );
  await page.waitForTimeout(4000);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const captcha = /百度安全验证|拖动左侧滑块/.test(bodyText);
  console.log("url", page.url());
  console.log("captcha", captcha);

  const info = await page.evaluate(() => {
    const label = [...document.querySelectorAll("*")].find(
      (e) => (e.textContent || "").trim() === "选择封面",
    ) as HTMLElement | undefined;
    if (!label) return { found: false as const };
    const root =
      (label.closest('[class*="FeEditorApp"]') as HTMLElement | null) ||
      label.parentElement;
    const img = root?.querySelector("img") as HTMLImageElement | null;
    const r = (root || label).getBoundingClientRect();
    const ir = img?.getBoundingClientRect();
    return {
      found: true as const,
      labelTag: label.tagName,
      labelClass: label.className,
      rootClass: root?.className?.toString?.().slice(0, 120),
      hasImg: !!img,
      imgSrc: img?.src?.slice(0, 80),
      box: { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height },
      imgBox: ir
        ? { x: ir.left + ir.width / 2, y: ir.top + ir.height / 2, w: ir.width, h: ir.height }
        : null,
    };
  });
  console.log("cover", JSON.stringify(info, null, 2));

  if (!captcha && info.found && info.imgBox) {
    await page.mouse.click(info.imgBox.x, info.imgBox.y);
    await page.waitForTimeout(1500);
    const modal = await page.locator(".cheetah-modal, [role=dialog]").count();
    const ai = await page.locator('text=AI封图').count();
    console.log("after img click modal", modal, "ai", ai);
  } else if (!captcha && info.found) {
    await page.mouse.click(info.box.x, info.box.y);
    await page.waitForTimeout(1500);
    const modal = await page.locator(".cheetah-modal, [role=dialog]").count();
    console.log("after box click modal", modal);
  }

  await page.screenshot({
    path: "data/debug/baijiahao-cover-probe.png",
    fullPage: true,
  });
} finally {
  await browser.close().catch(() => undefined);
}
