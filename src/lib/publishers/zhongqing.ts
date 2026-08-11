import { createSimplePublisher } from "@/lib/publishers/helpers";

export const zhongqingPublisher = createSimplePublisher({
  id: "zhongqing",
  name: "中青号",
  loginUrl: "https://mp.cyol.com/",
  editorUrl: "https://mp.cyol.com/",
  cookieOrigins: [
    "https://mp.cyol.com",
    "https://www.cyol.com",
    "https://mp.youth.cn",
    "https://www.youth.cn",
  ],
  cookieNamePattern: /session|token|cyol|youth|uid|sid|JSESSIONID/i,
  loginUrlPattern: /\/login|passport|sso|auth|注册/i,
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
    /mp\.cyol\.com|mp\.youth\.cn/i.test(url) && !/login|auth/i.test(url),
});
