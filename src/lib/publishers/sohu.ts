import { createSimplePublisher } from "@/lib/publishers/helpers";

export const sohuPublisher = createSimplePublisher({
  id: "sohu",
  name: "搜狐号",
  loginUrl: "https://mp.sohu.com/mpfe/v3/login",
  editorUrl: "https://mp.sohu.com/mpfe/v3/main/news/addarticle",
  cookieOrigins: ["https://mp.sohu.com", "https://www.sohu.com"],
  cookieNamePattern: /session|token|sohu|ppinf|reqtype/i,
  loginUrlPattern: /\/login|passport/i,
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
    /mp\.sohu\.com\/mpfe\/v3\/main/i.test(url) ||
    /www\.sohu\.com\/a\//i.test(url),
});
