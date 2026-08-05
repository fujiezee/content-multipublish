import { createSimplePublisher } from "@/lib/publishers/helpers";

export const eastmoneyPublisher = createSimplePublisher({
  id: "eastmoney",
  name: "东方财富",
  loginUrl: "https://passport2.eastmoney.com/pub/login",
  editorUrl: "https://guba.eastmoney.com/fundwrite/write",
  cookieOrigins: [
    "https://guba.eastmoney.com",
    "https://www.eastmoney.com",
    "https://passport2.eastmoney.com",
    "https://emcreative.eastmoney.com",
  ],
  cookieNamePattern: /ct|ut|uid|pi|st_pvi|EM|eastmoney|session/i,
  loginUrlPattern: /passport|\/login|LogIn/i,
  titleSelectors: [
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    'input[placeholder*="请输入标题"]',
    "#title",
    ".title-input input",
  ],
  titleMaxLen: 80,
  bodySelectors: [
    ".ql-editor",
    ".ProseMirror",
    'div[contenteditable="true"]',
    "textarea#content",
    "textarea",
    ".editor",
  ],
  bodyMode: "html",
  publishButtons: [
    'button:has-text("发布")',
    'button:has-text("发表")',
    'a:has-text("发布")',
    'input[value*="发布"]',
  ],
  confirmButtons: [
    'button:has-text("确认")',
    'button:has-text("确定")',
    'button:has-text("发布")',
  ],
  successUrl: (url) =>
    /guba\.eastmoney\.com\/news/i.test(url) ||
    /gubapost\.eastmoney\.com/i.test(url) ||
    /fundwrite\/(success|list)/i.test(url),
  toastPattern: /发布成功|发表成功|提交成功|已发布/,
});
