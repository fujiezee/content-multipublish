import { createSimplePublisher } from "@/lib/publishers/helpers";

export const sohufocusPublisher = createSimplePublisher({
  id: "sohufocus",
  name: "搜狐焦点",
  loginUrl: "https://house.focus.cn/",
  editorUrl: "https://mp.focus.cn/",
  cookieOrigins: [
    "https://house.focus.cn",
    "https://mp.focus.cn",
    "https://focus.cn",
  ],
  cookieNamePattern: /session|token|focus|sohu/i,
  loginUrlPattern: /login|passport/i,
  titleSelectors: [
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
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
    /focus\.cn/i.test(url) && !/edit|write|login/i.test(url),
});
