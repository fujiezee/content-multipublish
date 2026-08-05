import { createSimplePublisher } from "@/lib/publishers/helpers";

export const smzdmPublisher = createSimplePublisher({
  id: "smzdm",
  name: "什么值得买",
  loginUrl: "https://www.smzdm.com/user/login",
  editorUrl: "https://post.smzdm.com/tougao/",
  cookieOrigins: [
    "https://www.smzdm.com",
    "https://post.smzdm.com",
    "https://zhiyou.smzdm.com",
  ],
  cookieNamePattern: /smzdm|sess|token|device_id|sess_/i,
  loginUrlPattern: /\/login|user\/login|passport/i,
  titleSelectors: [
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    'input[name="title"]',
    "#title",
  ],
  titleMaxLen: 60,
  bodySelectors: [
    ".ql-editor",
    ".ProseMirror",
    'div[contenteditable="true"]',
    "textarea#content",
    "textarea",
  ],
  bodyMode: "html",
  publishButtons: [
    'button:has-text("投稿")',
    'button:has-text("发布")',
    'button:has-text("提交")',
    'a:has-text("投稿")',
  ],
  confirmButtons: [
    'button:has-text("确认")',
    'button:has-text("确定")',
    'button:has-text("提交")',
  ],
  successUrl: (url) =>
    /smzdm\.com\/p\/\d+/i.test(url) ||
    /post\.smzdm\.com\/.*(success|list|manage)/i.test(url),
  toastPattern: /投稿成功|发布成功|提交成功|已提交/,
});
