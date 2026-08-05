import { createSimplePublisher } from "@/lib/publishers/helpers";

export const yuquePublisher = createSimplePublisher({
  id: "yuque",
  name: "语雀",
  loginUrl: "https://www.yuque.com/login",
  editorUrl: "https://www.yuque.com/dashboard",
  cookieOrigins: ["https://www.yuque.com"],
  cookieNamePattern: /yuque|session|_yuque|ctoken/i,
  loginUrlPattern: /\/login|passport/i,
  titleSelectors: [
    'textarea[placeholder*="标题"]',
    'input[placeholder*="标题"]',
    'input[placeholder*="无标题"]',
    ".ne-title textarea",
    ".doc-title input",
  ],
  titleMaxLen: 100,
  bodySelectors: [
    ".ne-engine",
    ".ProseMirror",
    ".lake-content",
    'div[contenteditable="true"]',
    "textarea",
  ],
  bodyMode: "html",
  publishButtons: [
    'button:has-text("发布")',
    'button:has-text("更新")',
    'button:has-text("分享")',
  ],
  confirmButtons: [
    'button:has-text("确认发布")',
    'button:has-text("确定")',
    'button:has-text("发布")',
  ],
  successUrl: (url) =>
    /yuque\.com\/[^/]+\/[^/]+\/[a-zA-Z0-9]+/i.test(url) &&
    !/dashboard|login|edit/i.test(url),
  afterFill: async (page) => {
    if (/dashboard/i.test(page.url())) {
      const create = page
        .locator('button:has-text("新建"), a:has-text("新建文档")')
        .first();
      if ((await create.count()) > 0) {
        await create.click({ timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(2000);
      }
    }
  },
});
