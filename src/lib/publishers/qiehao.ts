import { createSimplePublisher } from "@/lib/publishers/helpers";

/** 企鹅号 — Playwright 兜底（扩展优先走 /article/save） */
export const qiehaoPublisher = createSimplePublisher({
  id: "qiehao",
  name: "企鹅号",
  loginUrl: "https://om.qq.com/userAuth/index",
  editorUrl: "https://om.qq.com/article/articlePublish",
  cookieOrigins: ["https://om.qq.com", "https://qq.com"],
  cookieNamePattern: /uin|skey|p_skey|om_|RK|pt/i,
  loginUrlPattern: /userAuth|login|ptlogin/i,
  titleSelectors: [
    '#omEditorTitle span[data-placeholder*="标题"]',
    "#omEditorTitle",
    '[data-placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
  ],
  titleMaxLen: 64,
  bodySelectors: [
    'div.ProseMirror[contenteditable="true"]',
    ".ProseMirror",
    'div[contenteditable="true"]',
  ],
  bodyMode: "html",
  publishButtons: [
    'button:has-text("存草稿")',
    'button:has-text("保存草稿")',
    'li:has-text("存草稿")',
    'button:has-text("发布")',
  ],
  confirmButtons: [
    'button:has-text("存草稿")',
    'button:has-text("确定")',
    'button:has-text("发布")',
  ],
  successUrl: (url) =>
    /om\.qq\.com/i.test(url) && !/userAuth|login|ptlogin/i.test(url),
  toastPattern: /保存成功|已保存|存草稿成功|发布成功/,
  notLoginMessage: "企鹅号未登录或登录已过期，请先在「账号」页登录连接",
});
