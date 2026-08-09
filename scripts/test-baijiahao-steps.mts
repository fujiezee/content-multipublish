import { chromium, type Page } from "playwright";
import fs from "fs";

const chrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function dump(page: Page, tag: string) {
  const body = await page.locator("body").innerText().catch(() => "");
  console.log(
    tag,
    page.url(),
    "captcha",
    /百度安全验证|滑块/.test(body),
    "cover",
    body.includes("选择封面"),
    "titlePh",
    body.includes("请输入标题"),
  );
}

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
page.on("framenavigated", (f) => {
  if (f === page.mainFrame()) console.log("NAV", f.url());
});

try {
  await page.goto(
    "https://baijiahao.baidu.com/builder/rc/edit?type=news&is_from_cms=1",
    { waitUntil: "domcontentloaded", timeout: 60_000 },
  );
  await page.waitForTimeout(3000);
  await dump(page, "after-goto");

  await page.waitForFunction(
    () => document.body?.innerText?.includes("选择封面"),
    null,
    { timeout: 60_000 },
  );
  await dump(page, "cover-ready");

  const title = page
    .locator(
      '.client_components_titleInput [contenteditable="true"], .client_pages_edit_components_titleInput [contenteditable="true"], [contenteditable="true"]',
    )
    .first();
  const titleVisible = await title.isVisible().catch(() => false);
  console.log("titleVisible", titleVisible);

  if (titleVisible) {
    await title.click({ force: true });
    await page.keyboard.type("GEO对初创企业有用吗", { delay: 15 });
  } else {
    await page.getByText("请输入标题", { exact: false }).first().click({
      force: true,
    });
    await page.keyboard.type("GEO对初创企业有用吗", { delay: 15 });
  }
  await page.waitForTimeout(500);
  await dump(page, "after-title");

  // open cover with force
  await page.evaluate(() => {
    const label = [...document.querySelectorAll("*")].find(
      (e) => (e.textContent || "").trim() === "选择封面",
    ) as HTMLElement | undefined;
    label
      ?.closest(".cheetah-form-item-row, [class*='content']")
      ?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(300);
  const label = page.locator("div").filter({ hasText: /^选择封面$/ }).first();
  console.log("label", await label.count(), await label.isVisible());
  await label.click({ force: true, timeout: 8000 });
  await page.waitForTimeout(1500);
  await dump(page, "after-cover-click");
  console.log(
    "ai modal",
    await page.locator('.cheetah-modal:visible:has-text("AI封图")').count(),
  );

  await page.screenshot({ path: "data/debug/baijiahao-steps-final.png" });
} finally {
  await browser.close().catch(() => undefined);
}
