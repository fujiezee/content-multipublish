import { createSimplePublisher } from "@/lib/publishers/helpers";

export const segmentfaultPublisher = createSimplePublisher({
  id: "segmentfault",
  name: "思否",
  loginUrl: "https://segmentfault.com/user/login",
  editorUrl: "https://segmentfault.com/write?freshman=1",
  cookieOrigins: ["https://segmentfault.com"],
  cookieNamePattern: /PHPSESSID|session|token|sf_/i,
  loginUrlPattern: /\/user\/login|\/login/i,
  titleSelectors: [
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    'input[placeholder*="请输入标题"]',
  ],
  titleMaxLen: 100,
  bodySelectors: [
    ".CodeMirror",
    ".ProseMirror",
    ".ql-editor",
    'div[contenteditable="true"]',
    "textarea",
  ],
  bodyMode: "text",
  publishButtons: [
    'button:has-text("发布")',
    'button:has-text("发布文章")',
    'button:has-text("提交")',
  ],
  successUrl: (url) =>
    /segmentfault\.com\/a\/\d+/i.test(url) ||
    /segmentfault\.com\/article/i.test(url),
});
