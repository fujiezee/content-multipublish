import { createSimplePublisher } from "@/lib/publishers/helpers";

export const dayuPublisher = createSimplePublisher({
  id: "dayu",
  name: "大鱼号",
  loginUrl: "https://mp.dayu.com/",
  editorUrl: "https://mp.dayu.com/#/article/write",
  cookieOrigins: ["https://mp.dayu.com", "https://www.dayu.com"],
  cookieNamePattern: /session|token|dayu|cna/i,
  loginUrlPattern: /login|passport/i,
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
    'button:has-text("发布")',
    'button:has-text("发表")',
    'a:has-text("发布")',
  ],
  successUrl: (url) =>
    /mp\.dayu\.com/i.test(url) && !/write|edit/i.test(url),
});
