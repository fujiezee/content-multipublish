import { createSimplePublisher } from "@/lib/publishers/helpers";

export const neteasePublisher = createSimplePublisher({
  id: "netease",
  name: "网易号",
  loginUrl: "https://mp.163.com/login.html",
  editorUrl: "https://mp.163.com/#/article/publish",
  cookieOrigins: [
    "https://mp.163.com",
    "https://www.163.com",
    "https://passport.163.com",
  ],
  cookieNamePattern: /NTES|S_INFO|P_INFO|NETEASE|token|session/i,
  loginUrlPattern: /\/login|passport\.163/i,
  titleSelectors: [
    'textarea[placeholder*="标题"]',
    'input[placeholder*="标题"]',
    'input[placeholder*="请输入标题"]',
    ".title-input input",
    ".title-input textarea",
  ],
  titleMaxLen: 64,
  bodySelectors: [
    ".ql-editor",
    ".ProseMirror",
    'div[contenteditable="true"]',
    ".editor-content",
    "textarea",
  ],
  bodyMode: "html",
  publishButtons: [
    'button:has-text("发布")',
    'button:has-text("发表")',
    'a:has-text("发布")',
  ],
  confirmButtons: [
    'button:has-text("确认发布")',
    'button:has-text("确定")',
    'button:has-text("确认")',
  ],
  successUrl: (url) =>
    /mp\.163\.com\/#\/(article|content|home)/i.test(url) ||
    /www\.163\.com\/dy\/article\//i.test(url),
  toastPattern: /发布成功|提交成功|已发布|保存成功/,
});
