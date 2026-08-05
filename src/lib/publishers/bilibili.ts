import { createSimplePublisher } from "@/lib/publishers/helpers";

export const bilibiliPublisher = createSimplePublisher({
  id: "bilibili",
  name: "B站专栏",
  loginUrl: "https://passport.bilibili.com/login",
  editorUrl: "https://member.bilibili.com/platform/upload/text/edit",
  cookieOrigins: [
    "https://www.bilibili.com",
    "https://member.bilibili.com",
    "https://passport.bilibili.com",
  ],
  cookieNamePattern: /SESSDATA|bili_jct|DedeUserID/i,
  loginUrlPattern: /passport\.bilibili|\/login/i,
  titleSelectors: [
    'input[placeholder*="请输入标题"]',
    'textarea[placeholder*="请输入标题"]',
    'input[placeholder*="标题"]',
    ".title-input input",
  ],
  titleMaxLen: 40,
  bodySelectors: [
    ".ql-editor",
    ".ProseMirror",
    'div[contenteditable="true"]',
    ".editor-content",
  ],
  bodyMode: "html",
  publishButtons: [
    'button:has-text("发布")',
    'button:has-text("提交")',
    '.submit-add:has-text("发布")',
  ],
  confirmButtons: [
    'button:has-text("确认提交")',
    'button:has-text("确定")',
    'button:has-text("确认")',
    'button:has-text("发布")',
  ],
  successUrl: (url) =>
    /bilibili\.com\/read\/cv\d+/i.test(url) ||
    /member\.bilibili\.com\/.*article/i.test(url),
});
