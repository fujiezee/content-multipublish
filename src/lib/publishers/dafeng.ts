import { createSimplePublisher } from "@/lib/publishers/helpers";

export const dafengPublisher = createSimplePublisher({
  id: "dafeng",
  name: "大风号",
  loginUrl: "https://mp.ifeng.com/login",
  editorUrl: "https://mp.ifeng.com/manage/originalArticle",
  cookieOrigins: [
    "https://mp.ifeng.com",
    "https://www.ifeng.com",
    "https://id.ifeng.com",
  ],
  cookieNamePattern: /session|token|ifeng|userid|sid/i,
  loginUrlPattern: /\/login|passport|sso/i,
  titleSelectors: [
    'textarea[placeholder*="标题"]',
    'input[placeholder*="标题"]',
    'input[placeholder*="请输入标题"]',
    '[contenteditable="true"][data-placeholder*="标题"]',
  ],
  titleMaxLen: 64,
  bodySelectors: [
    ".ql-editor",
    ".ProseMirror",
    ".editor-content [contenteditable='true']",
    'div[contenteditable="true"]',
    "textarea",
  ],
  bodyMode: "html",
  publishButtons: [
    'button:has-text("存草稿")',
    'button:has-text("保存草稿")',
    'button:has-text("发布")',
    'a:has-text("存草稿")',
  ],
  successUrl: (url) =>
    /mp\.ifeng\.com\/manage/i.test(url) && !/login/i.test(url),
});
