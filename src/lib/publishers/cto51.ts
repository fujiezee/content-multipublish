import { createSimplePublisher } from "@/lib/publishers/helpers";

export const cto51Publisher = createSimplePublisher({
  id: "cto51",
  name: "51CTO",
  loginUrl: "https://home.51cto.com/index",
  editorUrl: "https://blog.51cto.com/blogger/publish",
  cookieOrigins: [
    "https://www.51cto.com",
    "https://blog.51cto.com",
    "https://home.51cto.com",
  ],
  cookieNamePattern: /PHPSESSID|session|token|51cto/i,
  loginUrlPattern: /login|passport|home\.51cto\.com\/index/i,
  titleSelectors: [
    'input[placeholder*="标题"]',
    'input[name*="title" i]',
    "#title",
  ],
  titleMaxLen: 100,
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
    'button:has-text("发表")',
    'a:has-text("发布")',
  ],
  successUrl: (url) =>
    /blog\.51cto\.com\/[^/]+\/\d+/i.test(url) ||
    /blog\.51cto\.com\/blogger/i.test(url),
});
