import type { Page } from "playwright";
import { createSimplePublisher } from "@/lib/publishers/helpers";

async function passDoubanBotCheck(page: Page) {
  const hint = page.getByText(/访问豆瓣的方式有点像机器人|请向我们证明你是人类/);
  if ((await hint.count().catch(() => 0)) === 0) return;

  const prove = page.getByRole("button", { name: /点击证明|证明/ }).or(
    page.getByText("点击证明"),
  );
  if ((await prove.count()) > 0) {
    await prove.first().click({ force: true }).catch(() => undefined);
  }

  // Wait for editor or manual completion (user may need to finish captcha)
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (page.isClosed()) return;
    const stillBot =
      (await page
        .getByText(/访问豆瓣的方式有点像机器人|请向我们证明你是人类/)
        .count()
        .catch(() => 0)) > 0;
    const hasTitle =
      (await page
        .locator(
          'textarea[placeholder="请输入标题"], textarea.DRE-topic-editor-title-inputor',
        )
        .count()
        .catch(() => 0)) > 0;
    if (!stillBot && hasTitle) return;
    if (!stillBot && !hasTitle) {
      // Maybe still loading
      await page.waitForTimeout(800);
      continue;
    }
    await page.waitForTimeout(1500);
  }

  if (
    (await page
      .getByText(/访问豆瓣的方式有点像机器人|请向我们证明你是人类/)
      .count()
      .catch(() => 0)) > 0
  ) {
    throw new Error(
      "豆瓣要求人机验证，请在打开的窗口点击「点击证明」完成后关闭窗口再重试",
    );
  }
}

export const doubanPublisher = createSimplePublisher({
  id: "douban",
  name: "豆瓣",
  loginUrl: "https://accounts.douban.com/passport/login",
  // /note/create 会跳到新版话题编辑器
  editorUrl: "https://www.douban.com/topic/create?subtype=note",
  cookieOrigins: ["https://www.douban.com", "https://accounts.douban.com"],
  // bid 是游客浏览器 ID；真正登录态是 dbcl2
  cookieNamePattern: /^dbcl2$/i,
  loginUrlPattern: /accounts\.douban|\/login|passport/i,
  titleSelectors: [
    'textarea[placeholder="请输入标题"]',
    "textarea.DRE-topic-editor-title-inputor",
    'textarea[placeholder*="标题"]',
    'input[name="title"]',
    'input[placeholder*="标题"]',
    "#note-title",
  ],
  titleMaxLen: 100,
  bodySelectors: [
    "div.DRE-inputor.DRE-root[role='textbox']",
    "div.DRE-inputor[contenteditable='true']",
    'div[role="textbox"][contenteditable="true"]',
    'div[contenteditable="true"]',
    "textarea[name='text']",
    "textarea#note-text",
    "textarea",
  ],
  bodyMode: "text",
  publishButtons: [
    'button:has-text("发布")',
    'button.DRE-primary-button:has-text("发布")',
    'button:has-text("发表")',
    'input[type="submit"][value*="发表"]',
    'input[value="发表"]',
  ],
  successUrl: (url) =>
    /douban\.com\/(?:note|topic)\/\d+/i.test(url) ||
    /douban\.com\/people\//i.test(url),
  beforeFill: async (page) => {
    const denied = await page
      .getByText(/没有权限访问|请登录后重试/)
      .count()
      .catch(() => 0);
    if (denied > 0) {
      throw new Error("豆瓣未登录或登录已过期，请先在「账号」页重新连接");
    }
    await passDoubanBotCheck(page);

    // Ensure title field is present after redirects / captcha
    const title = page.locator(
      'textarea[placeholder="请输入标题"], textarea.DRE-topic-editor-title-inputor',
    );
    await title
      .first()
      .waitFor({ state: "visible", timeout: 20_000 })
      .catch(() => undefined);
    if ((await title.count()) === 0) {
      throw new Error(
        "未打开豆瓣日记编辑器。若出现人机验证请先完成，然后关闭窗口重试",
      );
    }
  },
  notLoginMessage: "豆瓣未登录或登录已过期，请先在「账号」页重新连接",
});
