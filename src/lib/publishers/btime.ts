import { createSimplePublisher } from "@/lib/publishers/helpers";

export const btimePublisher = createSimplePublisher({
  id: "btime",
  name: "北京时间号",
  loginUrl: "https://mp.btime.com/",
  editorUrl: "https://mp.btime.com/",
  cookieOrigins: [
    "https://mp.btime.com",
    "https://www.btime.com",
    "https://user.btime.com",
  ],
  cookieNamePattern: /session|token|btime|uid|sid|JSESSIONID/i,
  loginUrlPattern: /\/login|passport|sso|auth|user\.btime/i,
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
    'button:has-text("存草稿")',
    'button:has-text("保存草稿")',
    'button:has-text("发布")',
    'a:has-text("发布")',
  ],
  successUrl: (url) =>
    /mp\.btime\.com/i.test(url) && !/login|auth/i.test(url),
});
