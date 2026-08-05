import { createSimplePublisher } from "@/lib/publishers/helpers";

export const xueqiuPublisher = createSimplePublisher({
  id: "xueqiu",
  name: "雪球",
  loginUrl: "https://xueqiu.com/",
  editorUrl: "https://xueqiu.com/writer/editor",
  cookieOrigins: ["https://xueqiu.com", "https://api.xueqiu.com"],
  cookieNamePattern: /xq_a_token|u|device_id|session/i,
  loginUrlPattern: /login|passport/i,
  titleSelectors: [
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    'input[placeholder*="请输入标题"]',
  ],
  titleMaxLen: 80,
  bodySelectors: [
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
    /xueqiu\.com\/\d+\/\d+/i.test(url) ||
    /xueqiu\.com\/S\//i.test(url),
});
