import { shouldDeferPlaywrightToAgent } from "@/lib/agent";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import { isExtensionRequiredPlatform } from "@/lib/dianwu-geo";
import {
  clearJobClaim,
  createJobs,
  getArticle,
  getJob,
  listPendingJobs,
  tryClaimPendingJob,
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

function extensionRequiredPublishError(platform: PlatformId): string {
  if (platform === "weixin") {
    return "微信公众号请用 Chrome 扩展同步，本机不再自动开窗";
  }
  if (platform === "douyin") {
    return "抖音文章请用 Chrome 扩展同步，本机不再自动开窗";
  }
  return "该平台请用 Chrome 扩展同步，本机不再自动开窗";
}

let processing = false;

export async function enqueuePublish(
  articleId: string,
  platforms: PlatformId[],
  options: { engine?: PublishEngine } = {},
) {
  const article = getArticle(articleId);
  if (!article) throw new Error("文章不存在");
  if (!platforms.length) throw new Error("请至少选择一个平台");

  const engine = normalizePublishEngine(options.engine);
  const now = new Date().toISOString();
  const jobs: PublishJob[] = platforms.map((platform) => {
    const refuseLocal =
      engine === "playwright" && isExtensionRequiredPlatform(platform);
    return {
      id: randomUUID(),
      article_id: articleId,
      platform,
      // Extension jobs start running — browser bridge updates them; never enter the Node queue
      status: refuseLocal
        ? "failed"
        : engine === "extension"
          ? "running"
          : "pending",
      result_url: null,
      error: refuseLocal ? extensionRequiredPublishError(platform) : null,
      screenshot_path: null,
      engine,
      created_at: now,
      updated_at: now,
    };
  });
  createJobs(jobs);
  const workspaceId = article.workspace_id || "ws_local";
  if (engine === "api") {
    // Cloudflare Worker 会在请求结束后冻结 isolate；API 推送必须在响应前跑完并落库。
    await processQueue();
    return jobs.map((job) => getJob(job.id) ?? job);
  }
  if (
    engine === "playwright" &&
    !shouldDeferPlaywrightToAgent(workspaceId)
  ) {
    void processQueue();
  }
  return jobs;
}

export async function retryJob(jobId: string) {
  const job = getJob(jobId);
  if (!job) throw new Error("任务不存在");
  if (job.engine === "extension") {
    throw new Error("扩展同步请在文章页刷新登录后重试");
  }
  const engine: PublishEngine = job.engine === "api" ? "api" : "playwright";
  if (engine === "playwright" && isExtensionRequiredPlatform(job.platform)) {
    updateJob(jobId, {
      status: "failed",
      error: extensionRequiredPublishError(job.platform),
      result_url: null,
      screenshot_path: null,
      engine,
    });
    return getJob(jobId);
  }
  updateJob(jobId, {
    status: "pending",
    error: null,
    result_url: null,
    screenshot_path: null,
    engine,
  });
  clearJobClaim(jobId);
  const article = getArticle(job.article_id);
  const workspaceId = article?.workspace_id || "ws_local";
  if (engine === "api") {
    await processQueue();
  } else if (!shouldDeferPlaywrightToAgent(workspaceId)) {
    void processQueue();
  }
  return getJob(jobId);
}

/**
 * Strict serial queue: one platform at a time.
 * If a job keeps the window open for manual finish, wait until that
 * context is closed (or timed out) before starting the next job.
 */
function canRunJobInThisProcess(job: PublishJob): boolean {
  if (normalizePublishEngine(job.engine) === "api") return true;
  if (normalizePublishEngine(job.engine) !== "playwright") return false;
  const article = getArticle(job.article_id);
  const workspaceId = article?.workspace_id || "ws_local";
  return !shouldDeferPlaywrightToAgent(workspaceId);
}

export async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (true) {
      const pending = listPendingJobs().filter(canRunJobInThisProcess);
      if (!pending.length) break;
      await runJob(pending[0]);
      await persistCloudflareDb();
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

  const result = await adapter.publishDraft(
    contentToDraftArticle(content, { sourceId: article.id }),
  );
  if (result.success) {
    updateJob(job.id, {
      status: result.live ? "published" : "draft_ok",
      result_url: result.postUrl ?? null,
      error: null,
    });
  } else {
    updateJob(job.id, {
      status: "failed",
      error: result.error ?? "草稿同步失败",
    });
  }
  await persistCloudflareDb();
}

export type PlaywrightJobOutcome = {
  status: PublishJob["status"];
  result_url: string | null;
  error: string | null;
  screenshot_path: string | null;
};

/** Run one Playwright publish. Does not write the job row (caller persists). */
export async function executePlaywrightPublish(
  platform: PublishJob["platform"],
  content: NonNullable<ReturnType<typeof publishContentForPlatform>>,
  options?: {
    onOutcome?: (outcome: PlaywrightJobOutcome) => void | Promise<void>;
  },
): Promise<PlaywrightJobOutcome> {
  if (isExtensionRequiredPlatform(platform)) {
    const outcome: PlaywrightJobOutcome = {
      status: "failed",
      result_url: null,
      error: extensionRequiredPublishError(platform),
      screenshot_path: null,
    };
    await options?.onOutcome?.(outcome);
    return outcome;
  }
  const publisher = getPublisher(platform);
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let keepOpen = false;
  let waitTimeoutMs = 5 * 60 * 1000;

  try {
    const opened = await openContext(platform, {
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
      "https://cp.11467.com",
      "https://www.11467.com",
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
    if (status === "filled_awaiting_publish") {
      waitTimeoutMs = 2 * 60 * 60 * 1000;
    }
    const outcome: PlaywrightJobOutcome =
      status !== "failed"
        ? {
            status,
            result_url: result.url ?? page.url(),
            error:
              status === "filled_awaiting_publish"
                ? result.error ?? "已填入，请在打开的窗口确认后点发布"
                : null,
            screenshot_path: result.screenshotPath ?? null,
          }
        : {
            status: "failed",
            result_url: null,
            error: result.error ?? "发布失败",
            screenshot_path: result.screenshotPath ?? null,
          };
    if (status !== "failed") {
      await saveSession(platform, context).catch(() => undefined);
      if (status !== "filled_awaiting_publish") {
        keepOpen = false;
      }
    }
    if (options?.onOutcome) await options.onOutcome(outcome);
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    keepOpen = true;
    const outcome: PlaywrightJobOutcome = {
      status: "failed",
      result_url: null,
      error: message,
      screenshot_path: null,
    };
    if (options?.onOutcome) await options.onOutcome(outcome);
    return outcome;
  } finally {
    if (context) {
      if (keepOpen && page && !page.isClosed()) {
        await waitForManualFinish(context, page, {
          platform,
          timeoutMs: waitTimeoutMs,
        });
      }
      await context.close().catch(() => undefined);
    }
  }
}

async function runJob(job: PublishJob): Promise<void> {
  if (normalizePublishEngine(job.engine) === "api") {
    await runApiJob(job);
    return;
  }

  const claimed = tryClaimPendingJob(job.id, "inline");
  if (!claimed) return;

  const article = getArticle(claimed.article_id);
  if (!article) {
    updateJob(claimed.id, { status: "failed", error: "文章不存在" });
    return;
  }
  const content = publishContentForPlatform(article.id, claimed.platform);
  if (!content) {
    updateJob(claimed.id, { status: "failed", error: "文章不存在" });
    return;
  }
  const outcome = await executePlaywrightPublish(claimed.platform, content, {
    onOutcome: (next) => updateJob(claimed.id, next),
  });
  updateJob(claimed.id, outcome);
}
