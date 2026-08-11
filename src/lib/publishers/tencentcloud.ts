import { createSimplePublisher } from "@/lib/publishers/helpers";

/** 腾讯云开发者社区 — Playwright 兜底 */
export const tencentcloudPublisher = createSimplePublisher({
  id: "tencentcloud",
  name: "腾讯云+",
  loginUrl: "https://cloud.tencent.com/login",
  editorUrl: "https://cloud.tencent.com/developer/article/write-new",
  cookieOrigins: ["https://cloud.tencent.com", "https://qq.com"],
  cookieNamePattern: /qcommunity_session|uin|qcmainCSRFToken/i,
  loginUrlPattern: /\/login|passport/i,
  titleSelectors: [
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    'input[placeholder*="title" i]',
  ],
  titleMaxLen: 80,
  bodySelectors: [
    ".CodeMirror",
    ".cm-content",
    ".bytemd-body",
    'div[contenteditable="true"]',
    "textarea",
  ],
  bodyMode: "text",
  publishButtons: [
    'button:has-text("保存草稿")',
    'button:has-text("存草稿")',
    'button:has-text("发布")',
  ],
  successUrl: (url) =>
    /cloud\.tencent\.com\/developer/i.test(url) && !/login/i.test(url),
  toastPattern: /保存成功|已保存|草稿/,
  notLoginMessage: "腾讯云+未登录，请先在「账号」页连接或浏览器登录开发者社区",
});
