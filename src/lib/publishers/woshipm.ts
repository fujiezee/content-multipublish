import { createSimplePublisher } from "@/lib/publishers/helpers";

export const woshipmPublisher = createSimplePublisher({
  id: "woshipm",
  name: "人人都是产品经理",
  loginUrl: "https://www.woshipm.com/login",
  editorUrl: "https://www.woshipm.com/write",
  cookieOrigins: ["https://www.woshipm.com"],
  cookieNamePattern: /session|token|PHPSESSID|woshipm/i,
  loginUrlPattern: /\/login|passport/i,
  titleSelectors: [
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    'input[name*="title" i]',
  ],
  titleMaxLen: 100,
  bodySelectors: [
    ".ql-editor",
    ".ProseMirror",
    ".CodeMirror",
    'div[contenteditable="true"]',
    "textarea",
  ],
  bodyMode: "html",
  publishButtons: [
    'button:has-text("发布")',
    'button:has-text("投稿")',
    'button:has-text("提交")',
  ],
  successUrl: (url) =>
    /woshipm\.com\/(p|article)\/\d+/i.test(url) ||
    /woshipm\.com\/u\//i.test(url),
});
