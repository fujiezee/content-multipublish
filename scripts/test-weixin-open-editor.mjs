/**
 * Probe WeChat MP: home → find 图文入口 / direct editor URL.
 * Uses saved data/sessions/weixin.json
 */
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

function shot(name) {
  return page.screenshot({
    path: path.join(outDir, `weixin-probe-${name}.png`),
    fullPage: true,
  });
}

const log = [];
function info(msg, extra) {
  const line = extra ? `${msg} ${JSON.stringify(extra)}` : msg;
  log.push(line);
  console.log(line);
}

try {
  await page.goto("https://mp.weixin.qq.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(3000);
  info("after_home", { url: page.url() });
  await shot("01-home");

  const token = new URL(page.url()).searchParams.get("token");
  info("token", { token: token ? `${token.slice(0, 6)}…` : null });

  // Dump candidate creation entries on home
  const menuProbe = await page.evaluate(() => {
    const texts = [];
    const nodes = [
      ...document.querySelectorAll(
        ".new-creation__menu-item, .new-creation-menu-item, [class*='new-creation'], [class*='new_creation'], a, button, div",
      ),
    ];
    for (const el of nodes) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t) continue;
      if (!/图文|创作|文章|写新|新的创作/.test(t)) continue;
      if (t.length > 40) continue;
      const cls = el.className?.toString?.() || "";
      texts.push({
        tag: el.tagName,
        text: t,
        cls: cls.slice(0, 80),
        href: el.getAttribute?.("href") || "",
      });
    }
    // unique by text+tag
    const seen = new Set();
    return texts.filter((x) => {
      const k = `${x.tag}:${x.text}:${x.href}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 40);
  });
  info("menu_candidates", menuProbe);

  // Try direct editor URLs
  if (token) {
    const urls = [
      `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&lang=zh_CN&token=${token}`,
      `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&lang=zh_CN&token=${token}`,
      `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&isNew=1&type=10&lang=zh_CN&token=${token}`,
    ];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(3000);
      const titleCount = await page
        .locator(
          '#title, textarea.js_article_title, textarea[placeholder*="标题"], input[placeholder*="标题"], #js_title_place',
        )
        .count();
      const iframeCount = await page
        .locator('#ueditor_0, iframe[id^="ueditor"], .edui-editor iframe')
        .count();
      const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 200);
      info(`direct_${i}`, {
        url: page.url().slice(0, 120),
        titleCount,
        iframeCount,
        bodySnippet: bodyText.replace(/\s+/g, " ").slice(0, 120),
      });
      await shot(`02-direct-${i}`);
      if (titleCount > 0 || iframeCount > 0 || /appmsg_edit|action=edit/i.test(page.url())) {
        info("direct_ok", { i, url: page.url().slice(0, 160) });
        break;
      }
    }
  }

  // Back home and try clicking 图文消息
  await page.goto(
    token
      ? `https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=${token}`
      : "https://mp.weixin.qq.com/",
    { waitUntil: "domcontentloaded", timeout: 60_000 },
  );
  await page.waitForTimeout(2500);
  await shot("03-home-before-click");

  const popupPromise = page
    .context()
    .waitForEvent("page", { timeout: 12_000 })
    .catch(() => null);

  const clickResult = await page.evaluate(() => {
    const wanted = ["图文消息", "写新图文", "文章"];
    const items = [
      ...document.querySelectorAll(
        ".new-creation__menu-item, [class*='new-creation'] [class*='item'], a, div",
      ),
    ];
    for (const label of wanted) {
      for (const el of items) {
        const t = (el.textContent || "").replace(/\s+/g, "");
        if (t === label || (t.includes(label) && t.length < 20)) {
          if (/图片消息|视频|音频|转载/.test(t) && label === "图文") continue;
          el.click();
          return { clicked: true, text: t.slice(0, 30), tag: el.tagName };
        }
      }
    }
    return { clicked: false };
  });
  info("click_result", clickResult);

  const popup = await popupPromise;
  await page.waitForTimeout(3000);
  const pages = page.context().pages().map((p) => p.url());
  info("pages_after_click", pages.map((u) => u.slice(0, 140)));

  if (popup && !popup.isClosed()) {
    await popup.waitForTimeout(2000);
    await popup.screenshot({
      path: path.join(outDir, "weixin-probe-04-popup.png"),
      fullPage: true,
    });
    info("popup", {
      url: popup.url().slice(0, 160),
      titleCount: await popup
        .locator('#title, textarea.js_article_title, textarea[placeholder*="标题"]')
        .count(),
    });
  } else {
    await shot("04-same-tab-after-click");
  }
} catch (err) {
  info("error", { message: err instanceof Error ? err.message : String(err) });
  await shot("error");
} finally {
  fs.writeFileSync(
    path.join(outDir, "weixin-probe-log.json"),
    JSON.stringify(log, null, 2),
  );
  await browser.close();
}
