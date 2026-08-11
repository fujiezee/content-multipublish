import type { Page } from "playwright";
import { captureDebugScreenshot } from "@/lib/publishers/browser";
import { createSimplePublisher } from "@/lib/publishers/helpers";
import type { PublishContent, PublishResult } from "@/lib/types";

const base = createSimplePublisher({
  id: "sinakandian",
  name: "新浪看点",
  loginUrl: "https://mp.sina.com.cn/",
  editorUrl: "https://mp.sina.com.cn/",
  cookieOrigins: [
    "https://mp.sina.com.cn",
    "https://www.sina.com.cn",
    "https://weibo.com",
    "https://card.weibo.com",
  ],
  cookieNamePattern: /session|token|SINAGLOBAL|SUB|SCF|ALF/i,
  loginUrlPattern: /\/login|passport|sso/i,
  titleSelectors: [
    'textarea[placeholder*="标题"]',
    'input[placeholder*="标题"]',
    'textarea[placeholder*="文章标题"]',
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
    'button:has-text("保存")',
    'button:has-text("发布")',
  ],
  successUrl: (url) =>
    (/mp\.sina\.com\.cn/i.test(url) || /card\.weibo\.com|weibo\.com/i.test(url)) &&
    !/login|passport/i.test(url),
});

async function publish(
  page: Page,
  content: PublishContent,
): Promise<PublishResult> {
  const result = await base.publish(page, content);
  if (result.success) return result;

  // Merged product: often lands on Weibo 头条文章
  const url = page.isClosed() ? "" : page.url();
  if (/weibo\.com|card\.weibo\.com/i.test(url)) {
    return {
      success: false,
      error:
        "新浪看点已并入微博「头条文章」。请改用「微博」平台同步，或在此窗口用微博编辑器手动完成；完成后关闭窗口",
      screenshotPath: await captureDebugScreenshot(
        page,
        "sinakandian-weibo-merge",
      ),
      keepOpen: true,
    };
  }

  const msg = result.error || "";
  if (/找不到|未登录|登录/i.test(msg) || /login|passport/i.test(url)) {
    return {
      ...result,
      error:
        result.error ||
        "未进入新浪看点编辑器。若后台提示改用微博头条文章，请改选「微博」平台",
      keepOpen: true,
    };
  }
  return result;
}

export const sinakandianPublisher = {
  ...base,
  publish,
};
