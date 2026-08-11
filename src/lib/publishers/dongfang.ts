import { createSimplePublisher } from "@/lib/publishers/helpers";

export const dongfangPublisher = createSimplePublisher({
  id: "dongfang",
  name: "东方号",
  loginUrl: "https://mp.eastday.com/",
  editorUrl: "https://mp.eastday.com/",
  cookieOrigins: [
    "https://mp.eastday.com",
    "https://mp.tt.cn",
    "https://www.eastday.com",
    "https://mini.eastday.com",
  ],
  cookieNamePattern: /session|token|eastday|uid|sid|JSESSIONID/i,
  loginUrlPattern: /\/login|passport|sso|auth/i,
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
    /mp\.(eastday\.com|tt\.cn)/i.test(url) && !/login|auth/i.test(url),
});
