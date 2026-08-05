import { createSimplePublisher } from "@/lib/publishers/helpers";

export const imoocPublisher = createSimplePublisher({
  id: "imooc",
  name: "慕课手记",
  loginUrl: "https://www.imooc.com/user/newlogin",
  editorUrl: "https://www.imooc.com/article/publish",
  cookieOrigins: ["https://www.imooc.com"],
  cookieNamePattern: /imooc|session|PHPSESSID|login/i,
  loginUrlPattern: /login|passport/i,
  titleSelectors: [
    'input[placeholder*="标题"]',
    'input[name*="title" i]',
    "#title",
  ],
  titleMaxLen: 80,
  bodySelectors: [
    ".CodeMirror",
    ".ProseMirror",
    ".ql-editor",
    'div[contenteditable="true"]',
    "textarea",
  ],
  bodyMode: "html",
  publishButtons: [
    'button:has-text("发布")',
    'a:has-text("发布")',
    'button:has-text("发表")',
  ],
  successUrl: (url) =>
    /imooc\.com\/article\/\d+/i.test(url) ||
    /imooc\.com\/u\/\d+\/articles/i.test(url),
});
