import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const sessionFile = path.join(process.cwd(), "data/sessions/weixin.json");
const outDir = path.join(process.cwd(), "data/debug");
fs.mkdirSync(outDir, { recursive: true });
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
  await page.waitForTimeout(3500);
  await page.keyboard.press("Escape").catch(() => undefined);

  // dump texts mentioning 封面 / AI / 配图 / 拖拽
  const hits = await page.evaluate(() => {
    const want = /封面|配图|拖拽|AI|选择图|从素材/;
    const out = [];
    for (const el of document.querySelectorAll("*")) {
      const t = (el.innerText || el.textContent || "").trim();
      if (!t || t.length > 40) continue;
      if (!want.test(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 && r.height < 2) continue;
      out.push({
        tag: el.tagName,
        cls: String(el.className).slice(0, 80),
        t,
        vis: r.width > 0 && r.height > 0,
        y: Math.round(r.y),
      });
    }
    return out.slice(0, 40);
  });
  console.log("hits", JSON.stringify(hits, null, 2));

  // try click cover area
  const cover = page.getByText(/拖拽或选择封面|选择封面|添加封面|封面/).first();
  console.log("cover visible", await cover.isVisible().catch(() => false));
  await cover.click({ force: true }).catch((e) => console.log("click fail", e.message));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outDir, "weixin-cover-open.png"), fullPage: true });

  const after = await page.evaluate(() => {
    const want = /AI|配图|素材|本地|上传|生成|创作/;
    const out = [];
    for (const el of document.querySelectorAll("*")) {
      const t = (el.innerText || el.textContent || "").trim();
      if (!t || t.length > 30) continue;
      if (!want.test(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      out.push({ t, cls: String(el.className).slice(0, 60), y: Math.round(r.y) });
    }
    return out.slice(0, 50);
  });
  console.log("after", JSON.stringify(after, null, 2));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
