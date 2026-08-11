import {
  createJobs,
  getArticle,
  getJob,
  listPendingJobs,
  updateJob,
  upsertSession,
} from "@/lib/db";
import { publishContentForPlatform } from "@/lib/content/publish-resolve";
import {
  contentToDraftArticle,
  getDraftAdapter,
} from "@/lib/draft-adapters";
import { jobStatusFromPublishResult } from "@/lib/job-status";
import { closeBrowser, openContext, saveSession } from "@/lib/publishers/browser";
import { getPublisher } from "@/lib/publishers";
import {
  cookiesHaveDouyinSession,
  readDouyinCookies,
} from "@/lib/publishers/douyin";
import { sessionPath } from "@/lib/paths";
import type { PlatformId, PublishEngine, PublishJob } from "@/lib/types";
import { normalizePublishEngine } from "@/lib/types";
import type { BrowserContext, Page } from "playwright";
import { randomUUID } from "crypto";

let processing = false;

export function enqueuePublish(
  articleId: string,
  platforms: PlatformId[],
  options: { engine?: PublishEngine } = {},
) {
  const article = getArticle(articleId);
  if (!article) throw new Error("文章不存在");
  if (!platforms.length) throw new Error("请至少选择一个平台");

  const engine = normalizePublishEngine(options.engine);
  const now = new Date().toISOString();
  const jobs: PublishJob[] = platforms.map((platform) => ({
    id: randomUUID(),
    article_id: articleId,
    platform,
    // Extension jobs start running — browser bridge updates them; never enter the Node queue
    status: engine === "extension" ? "running" : "pending",
    result_url: null,
    error: null,
    screenshot_path: null,
    engine,
    created_at: now,
    updated_at: now,
  }));
  createJobs(jobs);
  if (engine === "playwright" || engine === "api") {
    void processQueue();
  }
  return jobs;
}

export async function retryJob(jobId: string) {
  const job = getJob(jobId);
  if (!job) throw new Error("任务不存在");
  // Keep api retries on the API path; extension failures fall back to Playwright
  const engine: PublishEngine =
    job.engine === "api" ? "api" : "playwright";
  updateJob(jobId, {
    status: "pending",
    error: null,
    result_url: null,
    screenshot_path: null,
    engine,
  });
  void processQueue();
  return getJob(jobId);
}

/**
 * Strict serial queue: one platform at a time.
 * If a job keeps the window open for manual finish, wait until that
 * context is closed (or timed out) before starting the next job.
 */
export async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (true) {
      const pending = listPendingJobs();
      if (!pending.length) break;
      await runJob(pending[0]);
      // Brief pause so the previous window fully tears down
      await new Promise((r) => setTimeout(r, 800));
    }
  } finally {
    processing = false;
    await closeBrowser();
  }
}

/** keepOpen 等待期间若已登录则写入会话（必须在关窗前调用） */
async function persistContextSessionIfLoggedIn(
  platform: PlatformId,
  context: BrowserContext,
  page: Page | undefined,
): Promise<boolean> {
  try {
    const publisher = getPublisher(platform);
    const livePage =
      page && !page.isClosed()
        ? page
        : context.pages().find((p) => !p.isClosed());
    if (!livePage) return false;

    if (platform === "douyin") {
      // 只认真实 session Cookie；登录壳未消失时也先落盘，避免关窗丢失
      if (!cookiesHaveDouyinSession(await readDouyinCookies(livePage))) {
        return false;
      }
    } else if (!(await publisher.isLoggedIn(livePage))) {
      return false;
    }

    const storage = await saveSession(platform, context);
    upsertSession(platform, {
      storage_path: storage || sessionPath(platform),
      status: "connected",
      last_checked_at: new Date().toISOString(),
      connected_at: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForManualFinish(
  context: BrowserContext,
  page: Page,
  options: { timeoutMs?: number; platform?: PlatformId } = {},
) {
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const start = Date.now();
  let saved = false;
  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) return;
    const pages = context.pages();
    if (pages.length === 0) return;
    const anyOpen = pages.some((p) => !p.isClosed());
    if (!anyOpen) return;

    // 抖音等：用户在窗口里扫码后立刻落盘，避免关窗后 Cookie 丢失
    if (options.platform && !saved) {
      saved = await persistContextSessionIfLoggedIn(
        options.platform,
        context,
        page,
      );
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function runApiJob(job: PublishJob): Promise<void> {
  updateJob(job.id, { status: "running", error: null });
  const article = getArticle(job.article_id);
  if (!article) {
    updateJob(job.id, { status: "failed", error: "文章不存在" });
    return;
  }

  const adapter = getDraftAdapter(job.platform);
  if (!adapter) {
    updateJob(job.id, {
      status: "failed",
      error: `平台 ${job.platform} 暂无 Node 草稿 API`,
    });
    return;
  }

  const content = publishContentForPlatform(article.id, job.platform);
  if (!content) {
    updateJob(job.id, { status: "failed", error: "文章不存在" });
    return;
  }
  const auth = await adapter.checkAuth();
  if (!auth.isAuthenticated) {
    updateJob(job.id, {
      status: "failed",
      error:
        auth.error ||
        "本机会话未登录或已过期，请在「账号」页重新连接后再试",
    });
    return;
  }

  const result = await adapter.publishDraft(contentToDraftArticle(content));
  if (result.success) {
    updateJob(job.id, {
      status: "draft_ok",
      result_url: result.postUrl ?? null,
      error: null,
    });
  } else {
    updateJob(job.id, {
      status: "failed",
      error: result.error ?? "草稿同步失败",
    });
  }
}

async function runJob(job: PublishJob): Promise<void> {
  if (normalizePublishEngine(job.engine) === "api") {
    await runApiJob(job);
    return;
  }

  updateJob(job.id, { status: "running", error: null });
  const article = getArticle(job.article_id);
  if (!article) {
    updateJob(job.id, { status: "failed", error: "文章不存在" });
    return;
  }

  const publisher = getPublisher(job.platform);
  const content = publishContentForPlatform(article.id, job.platform);
  if (!content) {
    updateJob(job.id, { status: "failed", error: "文章不存在" });
    return;
  }
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let keepOpen = false;

  try {
    const opened = await openContext(job.platform, {
      headless: false,
      useSession: true,
    });
    context = opened.context;

    // Clipboard paste for rich text editors
    for (const origin of [
      "https://zhuanlan.zhihu.com",
      "https://www.zhihu.com",
      "https://card.weibo.com",
      "https://weibo.com",
      "https://baijiahao.baidu.com",
      "https://www.jianshu.com",
      "https://mp.csdn.net",
      "https://www.csdn.net",
      "https://blog.csdn.net",
      "https://editor.csdn.net",
      "https://mp.toutiao.com",
      "https://www.toutiao.com",
      "https://juejin.cn",
      "https://mp.weixin.qq.com",
      "https://member.bilibili.com",
      "https://www.bilibili.com",
      "https://www.douban.com",
      "https://mp.sohu.com",
      "https://mp.dayu.com",
      "https://mp.yidianzixun.com",
      "https://i.cnblogs.com",
      "https://www.cnblogs.com",
      "https://blog.51cto.com",
      "https://segmentfault.com",
      "https://www.imooc.com",
      "https://my.oschina.net",
      "https://www.oschina.net",
      "https://www.yuque.com",
      "https://www.woshipm.com",
      "https://xueqiu.com",
      "https://mp.focus.cn",
      "https://house.focus.cn",
      "https://creator.xiaohongshu.com",
      "https://www.xiaohongshu.com",
      "https://creator.douyin.com",
      "https://www.douyin.com",
      "https://mp.163.com",
      "https://www.163.com",
      "https://post.smzdm.com",
      "https://www.smzdm.com",
      "https://guba.eastmoney.com",
      "https://www.eastmoney.com",
      "https://x.com",
      "https://twitter.com",
      "https://om.qq.com",
      "https://mp.ifeng.com",
      "https://www.ifeng.com",
      "https://kuaichuan.360kuai.com",
      "https://www.360kuai.com",
      "https://api.kuaichuan.360kuai.com",
      "https://mp.sina.com.cn",
      "https://www.sina.com.cn",
      "https://mp.eastday.com",
      "https://mp.tt.cn",
      "https://www.eastday.com",
      "https://mp.btime.com",
      "https://www.btime.com",
      "https://user.btime.com",
      "https://pdcreator.pdnews.cn",
      "https://pdnews.cn",
      "https://xhh.app.xinhuanet.com",
      "https://app.xinhuanet.com",
      "https://mp.cyol.com",
      "https://www.cyol.com",
      "https://mp.youth.cn",
      "https://cloud.tencent.com",
      "https://developer.aliyun.com",
      "https://bbs.huaweicloud.com",
      "https://devdata.huaweicloud.com",
    ]) {
      await context
        .grantPermissions(["clipboard-read", "clipboard-write"], { origin })
        .catch(() => undefined);
    }

    page = await context.newPage();
    const result = await publisher.publish(page, content);
    keepOpen = Boolean(result.keepOpen);

    const status = jobStatusFromPublishResult(result);
    if (status !== "failed") {
      await saveSession(job.platform, context).catch(() => undefined);
      updateJob(job.id, {
        status,
        result_url: result.url ?? page.url(),
        error:
          status === "filled_awaiting_publish"
            ? result.error ?? "已填入，请在打开的窗口确认后点发布"
            : null,
        screenshot_path: result.screenshotPath ?? null,
      });
      // Fill-confirm platforms keep the window; true draft/publish success closes.
      if (status !== "filled_awaiting_publish") {
        keepOpen = false;
      }
    } else {
      updateJob(job.id, {
        status: "failed",
        error: result.error ?? "发布失败",
        screenshot_path: result.screenshotPath ?? null,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateJob(job.id, { status: "failed", error: message });
    keepOpen = true;
  } finally {
    if (context) {
      if (keepOpen && page && !page.isClosed()) {
        // Block the queue until this platform window is done / closed
        await waitForManualFinish(context, page, { platform: job.platform });
      }
      await context.close().catch(() => undefined);
    }
  }
}
