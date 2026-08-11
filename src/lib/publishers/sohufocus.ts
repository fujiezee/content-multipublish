import { createSimplePublisher } from "@/lib/publishers/helpers";

export const sohufocusPublisher = createSimplePublisher({
  id: "sohufocus",
  name: "搜狐焦点",
  loginUrl: "https://login.focus.cn/?ru=https%3A%2F%2Fhouse.focus.cn%2F",
  editorUrl: "https://house.focus.cn/",
  cookieOrigins: [
    "https://house.focus.cn",
    "https://login.focus.cn",
    "https://www.focus.cn",
    "https://focus.cn",
  ],
  // 现网登录 Cookie：ppinf / focusinf / pprdig（勿只认 session）
  cookieNamePattern: /ppinf|focusinf|pprdig|session|token|focus|sohu/i,
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
