import type { Page } from "playwright";
import { captureDebugScreenshot, clickFirstVisible } from "@/lib/publishers/browser";
import {
  dismissCommonOverlays,
  fillBySelectors,
  hasCookieMatch,
  pasteIntoFirst,
  waitForUrlOrToast,
} from "@/lib/publishers/helpers";
import type { PlatformPublisher } from "@/lib/publishers/types";
import type { PublishContent, PublishResult } from "@/lib/types";

const EDITOR = "https://blog.51cto.com/blogger/publish";
const HOME = "https://home.51cto.com/index";

const PRIMARY_CATEGORIES = [
  "人工智能",
  "AIGC",
  "AI 编程",
  "AI 智能体",
  "AI 助手",
  "AI 办公",
  "大模型",
  "软件研发",
  "前端开发",
  "后端开发",
  "云计算",
  "大数据",
  "运维",
  "软件测试",
  "开源",
  "代码人生",
] as const;

function isEditorUrl(url: string) {
  // Only the writing/editing surfaces — success pages may also live under /blogger/
  return /blog\.51cto\.com\/blogger\/(?:publish|edit|draft)/i.test(url);
}

function isSuccessUrl(url: string) {
  if (isEditorUrl(url)) return false;
  if (/blogger\/(?:publish|edit|draft)/i.test(url)) return false;
  // 发布成功页（待审核）常见路径
  if (/blog\.51cto\.com\/blogger\/.*(?:success|succ|result|complete)/i.test(url)) {
    return true;
  }
  // 已发布文章：blog.51cto.com/{user}/{id}
  return /blog\.51cto\.com\/[A-Za-z0-9_-]+\/\d+(?:\/|\?|$)/i.test(url);
}

async function pageShowsPublishSuccess(page: Page) {
  return (
    (await page
      .getByText(/发布成功|发表成功|待审核/)
      .count()
      .catch(() => 0)) > 0
  );
}

async function isLoggedIn(page: Page): Promise<boolean> {
  if (/login|passport/i.test(page.url())) return false;
  return hasCookieMatch(
    page,
    ["https://www.51cto.com", "https://blog.51cto.com", "https://home.51cto.com"],
    /PHPSESSID|session|token|UserName|51cto/i,
  );
}

function pickCategory(content: PublishContent): string {
  const hay = `${content.title}\n${content.bodyText || ""}\n${content.summary || ""}`;
  const rules: Array<{ re: RegExp; cat: string }> = [
    { re: /前端|React|Vue|CSS|JavaScript|TypeScript|小程序/, cat: "前端开发" },
    { re: /后端|Java|Go|Python|接口|微服务|Spring/, cat: "后端开发" },
    { re: /数据库|MySQL|Redis|SQL|Mongo/, cat: "数据库" },
    { re: /运维|Docker|K8s|Kubernetes|Linux|监控/, cat: "运维" },
    { re: /测试|自动化测试|质量/, cat: "软件测试" },
    { re: /云原生|云计算|AWS|阿里云|腾讯云/, cat: "云计算" },
    { re: /大数据|Spark|Hive|数仓/, cat: "大数据" },
    { re: /智能体|Agent/, cat: "AI 智能体" },
    { re: /AIGC|文生图|AI\s*绘画/, cat: "AIGC" },
    { re: /大模型|LLM|GPT|DeepSeek|提示词|Prompt/, cat: "大模型" },
    { re: /AI\s*编程|Cursor|Copilot|代码生成/, cat: "AI 编程" },
    { re: /GEO|生成式引擎|AI\s*搜索|人工智能|机器学习/, cat: "人工智能" },
  ];
  for (const { re, cat } of rules) {
    if (re.test(hay)) return cat;
  }
  return "人工智能";
}

async function clickExactChip(page: Page, label: string): Promise<boolean> {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const loc = page
    .locator("span, div, li, a, button, label")
    .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) });
  const n = await loc.count();
  for (let i = 0; i < n; i++) {
    const item = loc.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;
    await item.click({ force: true }).catch(() => undefined);
    return true;
  }
  return page.evaluate((text) => {
    const want = text.replace(/\s+/g, "");
    const nodes = [
      ...document.querySelectorAll("span, div, li, a, button, label"),
    ] as HTMLElement[];
    for (const el of nodes) {
      if ((el.textContent || "").replace(/\s+/g, "") !== want) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 16) continue;
      if (r.top < 0 || r.top > innerHeight) continue;
      el.click();
      return true;
    }
    return false;
  }, label);
}

async function selectSecondaryCategory(page: Page, content: PublishContent) {
  // After L1 click, L2 chips appear; required: 请选择二级分类
  await page.waitForTimeout(600);
  const prefer = [
    /NLP|自然语言|搜索|推荐/,
    /机器学习|深度学习/,
    /大模型|LLM/,
    /计算机视觉/,
    /数据结构/,
  ];
  const hay = `${content.title} ${content.bodyText || ""}`;

  const chips = await page.evaluate(() => {
    const block = [...document.querySelectorAll("*")].find((el) =>
      /请选择二级分类|二级分类/.test(el.textContent || ""),
    ) as HTMLElement | undefined;
    // Collect short visible chips near the classification area
    const nodes = [
      ...document.querySelectorAll("span, div, li, a, button, label"),
    ] as HTMLElement[];
    const out: string[] = [];
    for (const el of nodes) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t || t.length > 16 || t.length < 2) continue;
      if (/一级|二级|分类|请选择|基础信息|个人分类|标签|发布|取消/.test(t)) {
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 16 || r.width > 220) continue;
      if (r.top < 80 || r.top > innerHeight - 40) continue;
      // Likely L2 chips sit below selected L1
      if (!out.includes(t)) out.push(t);
    }
    return { near: !!block, chips: out.slice(0, 40) };
  });

  // Prefer keyword match among visible chips
  for (const re of prefer) {
    if (!re.test(hay) && !/GEO|人工智能|搜索/.test(hay)) continue;
    const hit = chips.chips.find((c) => re.test(c));
    if (hit && (await clickExactChip(page, hit))) return hit;
  }
  // GEO / AI search → NLP if present
  for (const name of ["NLP", "自然语言处理", "机器学习", "深度学习", "推荐系统"]) {
    if (chips.chips.includes(name) && (await clickExactChip(page, name))) {
      return name;
    }
  }
  // Otherwise first plausible L2 chip that isn't a known L1
  const l1 = new Set(PRIMARY_CATEGORIES.map((c) => c.replace(/\s+/g, "")));
  for (const c of chips.chips) {
    if (l1.has(c.replace(/\s+/g, ""))) continue;
    if (await clickExactChip(page, c)) return c;
  }
  return null;
}

async function selectCategories(page: Page, content: PublishContent) {
  // Wait for publish settings panel (文章分类 list)
  const panel = page.getByText("文章分类").or(page.getByText("基础信息"));
  await panel
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => undefined);

  const preferred = pickCategory(content);
  const order = [
    preferred,
    ...PRIMARY_CATEGORIES.filter((c) => c !== preferred),
  ];

  let primary: string | null = null;
  for (const cat of order) {
    if (await clickExactChip(page, cat)) {
      primary = cat;
      break;
    }
  }
  if (!primary) {
    throw new Error("未选择一级分类（文章分类），请在打开发布面板后手动选择");
  }

  const secondary = await selectSecondaryCategory(page, content);
  if (!secondary) {
    // One more wait — some L2 lists render late
    await page.waitForTimeout(800);
    const again = await selectSecondaryCategory(page, content);
    if (!again) {
      throw new Error(
        `已选一级分类「${primary}」，但未选二级分类。请在打开的窗口点选二级分类后发布`,
      );
    }
    return { primary, secondary: again };
  }
  return { primary, secondary };
}

async function fillOptionalMeta(page: Page, content: PublishContent) {
  // Tags — optional but often helpful
  const tag = page
    .locator(
      'input[placeholder*="标签"], input[placeholder*="设置标签"], .el-select.subject-parent input',
    )
    .first();
  if ((await tag.count()) > 0 && (await tag.isVisible().catch(() => false))) {
    const value =
      (content.summary || content.title).replace(/\s+/g, "").slice(0, 12) ||
      "技术";
    await tag.click().catch(() => undefined);
    await tag.fill(value).catch(() => undefined);
    await page.keyboard.press("Enter").catch(() => undefined);
    await page.waitForTimeout(400);
  }

  // Article type if empty
  const typeInput = page.locator('input[placeholder*="文章类型"]').first();
  if (
    (await typeInput.count()) > 0 &&
    (await typeInput.isVisible().catch(() => false))
  ) {
    const cur = await typeInput.inputValue().catch(() => "");
    if (!cur.trim()) {
      await typeInput.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(400);
      await page
        .getByText(/原创|翻译|转载/)
        .first()
        .click({ force: true })
        .catch(() => undefined);
    }
  }
}

async function publish(
  page: Page,
  content: PublishContent,
): Promise<PublishResult> {
  try {
    await page.goto(EDITOR, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);
    await dismissCommonOverlays(page);

    if (
      /login|passport/i.test(page.url()) ||
      !(await isLoggedIn(page)) ||
      (await page.getByText(/登录|请先登录/).count()) > 0 &&
        (await page.locator("input.title_input").count()) === 0
    ) {
      return {
        success: false,
        error: "51CTO 未登录或登录已过期，请先在「账号」页重新连接",
        screenshotPath: await captureDebugScreenshot(page, "cto51-not-login"),
        keepOpen: true,
      };
    }

    const title = content.title.slice(0, 100);
    await fillBySelectors(
      page,
      [
        "input.title_input",
        'input[placeholder*="标题"]',
        'input[name*="title" i]',
        "#title",
      ],
      title,
    );

    const html = content.bodyHtml || `<p>${content.bodyText || ""}</p>`;
    const plain = content.bodyText || content.bodyMarkdown || "";
    await pasteIntoFirst(
      page,
      [
        "textarea.write-area",
        'textarea[placeholder="请输入正文"]',
        "textarea.auto-textarea-input",
        ".CodeMirror",
        ".ProseMirror",
        ".ql-editor",
        'div[contenteditable="true"]',
        "textarea",
      ],
      html,
      plain,
      "text",
    );
    await page.waitForTimeout(800);

    // Step 1: open publish settings panel
    await clickFirstVisible(page, [
      "span.edit-submit-text",
      'button:has-text("发布文章")',
      ".edit-submit-text",
    ]);
    await page.waitForTimeout(1500);

    // Step 2: required L1 + L2 categories
    const chosen = await selectCategories(page, content);
    console.log("[cto51] category:", chosen);

    await fillOptionalMeta(page, content);
    await page.waitForTimeout(400);

    // Clear validation tip if still present
    if (
      (await page.getByText("请选择二级分类").count().catch(() => 0)) > 0
    ) {
      await selectSecondaryCategory(page, content);
      await page.waitForTimeout(300);
    }

    // Step 3: final publish in the panel (底部「发布」, 不是顶部「发布文章」)
    const finalPublish = page
      .locator(
        ".el-dialog__footer button, .dialog-footer button, .el-drawer__footer button, .publish-footer button",
      )
      .filter({ hasText: /^\s*发布\s*$/ })
      .last();

    if (
      (await finalPublish.count()) > 0 &&
      (await finalPublish.isVisible().catch(() => false))
    ) {
      await finalPublish.click({ timeout: 8000 }).catch(() => undefined);
    } else {
      await page.evaluate(() => {
        const buttons = [
          ...document.querySelectorAll("button, a"),
        ] as HTMLElement[];
        for (const el of buttons.reverse()) {
          const t = (el.textContent || "").replace(/\s+/g, "");
          if (t !== "发布") continue;
          const r = el.getBoundingClientRect();
          // Bottom action area of the settings modal
          if (r.width > 40 && r.height > 24 && r.top > innerHeight * 0.55) {
            el.click();
            return true;
          }
        }
        return false;
      });
    }

    const toastRe = /发布成功|发表成功|文章发布成功|已成功发布|待审核/;
    let published = await waitForUrlOrToast(
      page,
      isSuccessUrl,
      toastRe,
      30_000,
      isEditorUrl,
    );
    if (!published && (await pageShowsPublishSuccess(page))) {
      published = page.url();
    }
    if (published) return { success: true, url: published };

    await captureDebugScreenshot(page, "cto51-await-manual");
    published = await waitForUrlOrToast(
      page,
      isSuccessUrl,
      toastRe,
      3 * 60_000,
      isEditorUrl,
    );
    if (!published && (await pageShowsPublishSuccess(page))) {
      published = page.url();
    }
    if (published) return { success: true, url: published };

    return {
      success: false,
      error:
        "51CTO 未确认发布成功。请在打开的窗口选择一级分类后点「发布」；完成后请关闭该窗口，才会开始下一个平台",
      screenshotPath: await captureDebugScreenshot(page, "cto51-not-published"),
      keepOpen: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `${message}（完成后请关闭窗口，才会开始下一个平台）`,
      screenshotPath: await captureDebugScreenshot(page, "cto51-error"),
      keepOpen: true,
    };
  }
}

export const cto51Publisher: PlatformPublisher = {
  id: "cto51",
  name: "51CTO",
  loginUrl: HOME,
  editorUrl: EDITOR,
  isLoggedIn,
  publish,
};
