import { createSimplePublisher } from "@/lib/publishers/helpers";

export const peoplehaoPublisher = createSimplePublisher({
  id: "peoplehao",
  name: "人民号",
  loginUrl: "https://pdcreator.pdnews.cn/login",
  editorUrl: "https://pdcreator.pdnews.cn/producer",
  cookieOrigins: [
    "https://pdcreator.pdnews.cn",
    "https://pdnews.cn",
    "https://www.people.com.cn",
  ],
  cookieNamePattern: /session|token|CASTGC|JSESSIONID|pd_|rmh/i,
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
    /pdcreator\.pdnews\.cn/i.test(url) && !/login/i.test(url),
});
