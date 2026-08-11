import { createSimplePublisher } from "@/lib/publishers/helpers";

export const kuaichuanPublisher = createSimplePublisher({
  id: "kuaichuan",
  name: "360快传号",
  loginUrl: "https://kuaichuan.360kuai.com/",
  editorUrl: "https://kuaichuan.360kuai.com/",
  cookieOrigins: [
    "https://kuaichuan.360kuai.com",
    "https://www.360kuai.com",
    "https://api.kuaichuan.360kuai.com",
  ],
  cookieNamePattern: /session|token|Q|T|__|uid|sid/i,
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
    /kuaichuan\.360kuai\.com/i.test(url) && !/login|auth/i.test(url),
});
