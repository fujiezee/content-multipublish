import { createSimplePublisher } from "@/lib/publishers/helpers";

export const xinhuahaoPublisher = createSimplePublisher({
  id: "xinhuahao",
  name: "新华号",
  loginUrl: "https://xhh.app.xinhuanet.com/",
  editorUrl: "https://xhh.app.xinhuanet.com/",
  cookieOrigins: [
    "https://xhh.app.xinhuanet.com",
    "https://app.xinhuanet.com",
    "https://www.xinhuanet.com",
    "https://my-h5news.app.xinhuanet.com",
  ],
  cookieNamePattern: /session|token|xinhua|uid|sid|JSESSIONID/i,
  loginUrlPattern: /\/login|passport|sso|auth|注册/i,
  titleSelectors: [
    'textarea[placeholder*="标题"]',
    'input[placeholder*="标题"]',
    'input[placeholder*="请输入标题"]',
  ],
  titleMaxLen: 64,
  bodySelectors: [
    ".ql-editor",
    ".ProseMirror",
    'div[contenteditable="true"]',
    "textarea",
  ],
  bodyMode: "html",
  publishButtons: [
    'button:has-text("存草稿")',
    'button:has-text("保存草稿")',
    'button:has-text("发布")',
    'a:has-text("发布")',
  ],
  successUrl: (url) =>
    /xinhuanet\.com/i.test(url) && !/login|auth/i.test(url),
});
