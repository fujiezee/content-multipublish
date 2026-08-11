import { createSimplePublisher } from "@/lib/publishers/helpers";

/** 华为云社区博客 — Playwright 兜底 */
export const huaweicloudPublisher = createSimplePublisher({
  id: "huaweicloud",
  name: "华为云社区",
  loginUrl:
    "https://auth.huaweicloud.com/authui/login?service=https%3A%2F%2Fbbs.huaweicloud.com%2Fblogs%2Farticle",
  editorUrl: "https://bbs.huaweicloud.com/blogs/article",
  cookieOrigins: [
    "https://bbs.huaweicloud.com",
    "https://devdata.huaweicloud.com",
    "https://auth.huaweicloud.com",
    "https://huaweicloud.com",
  ],
  cookieNamePattern: /hwc|huawei|HWS|SESSION|csrf|login/i,
  loginUrlPattern: /auth\.huaweicloud|login|authui/i,
  titleSelectors: [
    "#blogTitle",
    'input.write-blog-blog-title',
    'input[placeholder*="标题"]',
  ],
  titleMaxLen: 64,
  bodySelectors: [
    ".CodeMirror",
    "textarea.markdown-editor",
    'div[contenteditable="true"]',
    "textarea",
  ],
  bodyMode: "text",
  publishButtons: [
    "#draft-btn",
    'a:has-text("保存草稿")',
    'button:has-text("保存草稿")',
  ],
  successUrl: (url) =>
    /bbs\.huaweicloud\.com/i.test(url) && !/login|authui/i.test(url),
  toastPattern: /草稿保存成功|已保存|保存成功/,
  notLoginMessage: "华为云社区未登录，请先在「账号」页连接或浏览器登录",
});
