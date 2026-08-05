import { createSimplePublisher } from "@/lib/publishers/helpers";

export const yidianPublisher = createSimplePublisher({
  id: "yidian",
  name: "一点号",
  loginUrl: "https://mp.yidianzixun.com/",
  editorUrl: "https://mp.yidianzixun.com/#/NovelEditor",
  cookieOrigins: [
    "https://www.yidianzixun.com",
    "https://mp.yidianzixun.com",
  ],
  cookieNamePattern: /session|token|yidian|JSESSIONID/i,
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
    /yidianzixun\.com/i.test(url) && !/NovelEditor|edit/i.test(url),
});
