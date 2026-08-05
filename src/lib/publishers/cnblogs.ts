import { createSimplePublisher } from "@/lib/publishers/helpers";

export const cnblogsPublisher = createSimplePublisher({
  id: "cnblogs",
  name: "博客园",
  loginUrl: "https://account.cnblogs.com/signin",
  editorUrl: "https://i.cnblogs.com/articles/edit",
  cookieOrigins: ["https://www.cnblogs.com", "https://i.cnblogs.com", "https://account.cnblogs.com"],
  cookieNamePattern: /\.CNBlogsCookie|LoginName|session/i,
  loginUrlPattern: /signin|login|account\.cnblogs/i,
  titleSelectors: [
    '#post-title',
    'input[placeholder*="标题"]',
    'input#Editor_Edit_txbTitle',
    'input[name*="title" i]',
  ],
  titleMaxLen: 200,
  bodySelectors: [
    "#md-editor",
    ".CodeMirror",
    "textarea#Editor_Edit_EditorBody",
    "textarea",
    ".ProseMirror",
    'div[contenteditable="true"]',
  ],
  bodyMode: "text",
  publishButtons: [
    'button:has-text("发布")',
    'button:has-text("保存")',
    '#Editor_Edit_lkbPublish',
    'input[value="发布"]',
  ],
  confirmButtons: [
    'button:has-text("确定")',
    'button:has-text("确认")',
    'button:has-text("发布")',
  ],
  successUrl: (url) =>
    /cnblogs\.com\/[^/]+\/p\/\d+/i.test(url) ||
    /i\.cnblogs\.com\/posts/i.test(url),
});
