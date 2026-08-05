import { createSimplePublisher } from "@/lib/publishers/helpers";

export const doubanPublisher = createSimplePublisher({
  id: "douban",
  name: "豆瓣",
  loginUrl: "https://accounts.douban.com/passport/login",
  editorUrl: "https://www.douban.com/note/create",
  cookieOrigins: ["https://www.douban.com", "https://accounts.douban.com"],
  cookieNamePattern: /dbcl2|ck|bid|session/i,
  loginUrlPattern: /accounts\.douban|\/login|passport/i,
  titleSelectors: [
    'input[name="title"]',
    'input[placeholder*="标题"]',
    "#note-title",
  ],
  titleMaxLen: 100,
  bodySelectors: [
    "textarea[name='text']",
    "textarea#note-text",
    ".ProseMirror",
    'div[contenteditable="true"]',
    "textarea",
  ],
  bodyMode: "text",
  publishButtons: [
    'input[type="submit"][value*="发表"]',
    'button:has-text("发表")',
    'button:has-text("发布")',
    'input[value="发表"]',
  ],
  successUrl: (url) =>
    /douban\.com\/note\/\d+/i.test(url) ||
    /douban\.com\/people\//i.test(url),
});
