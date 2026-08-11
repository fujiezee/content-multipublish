import { createSimplePublisher } from "@/lib/publishers/helpers";

/** 阿里云开发者社区 — Playwright 兜底 */
export const aliyunPublisher = createSimplePublisher({
  id: "aliyun",
  name: "阿里云开发者",
  loginUrl: "https://account.aliyun.com/login/login.htm",
  editorUrl: "https://developer.aliyun.com/article/new",
  cookieOrigins: ["https://developer.aliyun.com", "https://aliyun.com"],
  cookieNamePattern: /c_csrf|login_aliyunid|aliyun_choice/i,
  loginUrlPattern: /login\.htm|passport|oauth/i,
  titleSelectors: [
    'input[placeholder*="标题"]',
    "#title",
    'textarea[placeholder*="标题"]',
  ],
  titleMaxLen: 100,
  bodySelectors: [
    'div.editor textarea.textarea',
    ".editor textarea",
    ".CodeMirror",
    'div[contenteditable="true"]',
    "textarea",
  ],
  bodyMode: "text",
  publishButtons: [
    'button:has-text("保存")',
    'button:has-text("存草稿")',
    'button:has-text("发布文章")',
  ],
  successUrl: (url) =>
    /developer\.aliyun\.com/i.test(url) && !/login/i.test(url),
  toastPattern: /保存成功|已保存|草稿/,
  notLoginMessage: "阿里云开发者未登录，请先在「账号」页连接或浏览器登录",
});
