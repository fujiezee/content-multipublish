import { createSimplePublisher } from "@/lib/publishers/helpers";

/** X (Twitter) — compose tweet / long-form article when available. */
export const xPublisher = createSimplePublisher({
  id: "x",
  name: "X",
  loginUrl: "https://x.com/i/flow/login",
  editorUrl: "https://x.com/compose/article",
  cookieOrigins: ["https://x.com", "https://twitter.com", "https://api.x.com"],
  cookieNamePattern: /auth_token|ct0|twid|kdt/i,
  loginUrlPattern: /\/i\/flow\/login|\/login/i,
  titleSelectors: [
    'textarea[placeholder*="Title"]',
    'input[placeholder*="Title"]',
    'textarea[placeholder*="标题"]',
    'div[data-testid="articleTitle"]',
    'div[aria-label*="Title"]',
  ],
  titleMaxLen: 100,
  bodySelectors: [
    'div[data-testid="articleBody"]',
    'div[data-testid="tweetTextarea_0"]',
    'div[role="textbox"]',
    'div[contenteditable="true"]',
    ".DraftEditor-root",
  ],
  bodyMode: "text",
  publishButtons: [
    'button[data-testid="tweetButton"]',
    'button[data-testid="tweetButtonInline"]',
    'button:has-text("Post")',
    'button:has-text("发布")',
    'div[role="button"]:has-text("Post")',
  ],
  confirmButtons: [
    'button:has-text("Post")',
    'button:has-text("发布")',
    'button[data-testid="confirmationSheetConfirm"]',
  ],
  successUrl: (url) =>
    /x\.com\/[^/]+\/status\/\d+/i.test(url) ||
    /twitter\.com\/[^/]+\/status\/\d+/i.test(url) ||
    /x\.com\/i\/articles\//i.test(url),
  toastPattern: /Your post|已发布|Posted|Your Article/,
  notLoginMessage: "X 未登录或登录已过期，请先在「账号」页登录连接",
});
