import { createSimplePublisher } from "@/lib/publishers/helpers";

export const oschinaPublisher = createSimplePublisher({
  id: "oschina",
  name: "开源中国",
  loginUrl: "https://www.oschina.net/home/login",
  editorUrl: "https://my.oschina.net/u/blog/write",
  cookieOrigins: ["https://www.oschina.net", "https://my.oschina.net"],
  cookieNamePattern: /session|oscid|user|token/i,
  loginUrlPattern: /\/login|passport/i,
  titleSelectors: [
    'input[placeholder*="标题"]',
    'input[name*="title" i]',
    "#title",
  ],
  titleMaxLen: 100,
  bodySelectors: [
    ".CodeMirror",
    ".ProseMirror",
    ".cke_wysiwyg_frame",
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
    /oschina\.net\/.*\/blog\/\d+/i.test(url) ||
    /my\.oschina\.net\/.*\/blog/i.test(url),
});
