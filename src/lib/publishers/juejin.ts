import type { Page } from "playwright";
import { createSimplePublisher } from "@/lib/publishers/helpers";
import type { PublishContent } from "@/lib/types";

async function afterFill(page: Page, _content: PublishContent) {
  // Open publish panel and pick a default category + tag if required
  await page
    .locator('button:has-text("发布"), .xitu-btn:has-text("发布")')
    .first()
    .click({ timeout: 5000 })
    .catch(() => undefined);
  await page.waitForTimeout(1000);

  const cats = page.locator(
    '.category-list .item, .byte-select-option, [class*="category"] button, [class*="category"] .item',
  );
  if ((await cats.count()) > 0) {
    await cats.first().click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(400);
  }

  const tagInput = page
    .locator(
      'input[placeholder*="标签"], input[placeholder*="搜索添加标签"], .tag-input input',
    )
    .first();
  if ((await tagInput.count()) > 0 && (await tagInput.isVisible().catch(() => false))) {
    await tagInput.fill("前端").catch(() => undefined);
    await page.keyboard.press("Enter").catch(() => undefined);
    await page.waitForTimeout(400);
    // click first suggestion
    await page
      .locator('.tag-list .item, [class*="tag"] li, .byte-select-option')
      .first()
      .click({ timeout: 2000 })
      .catch(() => undefined);
  }
}

export const juejinPublisher = createSimplePublisher({
  id: "juejin",
  name: "掘金",
  loginUrl: "https://juejin.cn/login",
  editorUrl: "https://juejin.cn/editor/drafts/new?v=2",
  cookieOrigins: ["https://juejin.cn", "https://api.juejin.cn"],
  cookieNamePattern: /sessionid|passport|uid_|csrf/i,
  loginUrlPattern: /\/login|passport/i,
  titleSelectors: [
    'input[placeholder*="输入文章标题"]',
    'input[placeholder*="文章标题"]',
    'input[placeholder*="标题"]',
    ".title-input input",
  ],
  titleMaxLen: 80,
  bodySelectors: [
    ".CodeMirror",
    ".CodeMirror-code",
    ".bytemd-editor .CodeMirror",
    "textarea",
    ".ProseMirror",
  ],
  bodyMode: "text",
  publishButtons: [
    'button:has-text("发布")',
    '.xitu-btn:has-text("发布")',
    'button:has-text("发布文章")',
  ],
  confirmButtons: [
    'button:has-text("确定并发布")',
    'button:has-text("确认并发布")',
    'button:has-text("确认发布")',
    'button:has-text("确定")',
  ],
  successUrl: (url) => {
    if (/juejin\.cn\/editor\/drafts\//i.test(url)) return false;
    return (
      /juejin\.cn\/post\/\d+/i.test(url) ||
      /juejin\.cn\/(creator|user)/i.test(url)
    );
  },
  afterFill,
  toastPattern: /发布成功|提交成功|已发布/,
});
