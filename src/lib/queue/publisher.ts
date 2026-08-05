import {
  createJobs,
  getArticle,
  getJob,
  listPendingJobs,
  updateJob,
} from "@/lib/db";
import { articleToPublishContent } from "@/lib/content/adapt";
import { closeBrowser, openContext, saveSession } from "@/lib/publishers/browser";
import { getPublisher } from "@/lib/publishers";
import type { PlatformId, PublishJob } from "@/lib/types";
import type { BrowserContext, Page } from "playwright";
import { randomUUID } from "crypto";

let processing = false;

export function enqueuePublish(articleId: string, platforms: PlatformId[]) {
  const article = getArticle(articleId);
  if (!article) throw new Error("文章不存在");
  if (!platforms.length) throw new Error("请至少选择一个平台");

  const now = new Date().toISOString();
  const jobs: PublishJob[] = platforms.map((platform) => ({
    id: randomUUID(),
    article_id: articleId,
    platform,
    status: "pending",
    result_url: null,
    error: null,
    screenshot_path: null,
    created_at: now,
    updated_at: now,
  }));
  createJobs(jobs);
  void processQueue();
  return jobs;
}

export async function retryJob(jobId: string) {
  const job = getJob(jobId);
  if (!job) throw new Error("任务不存在");
  updateJob(jobId, {
    status: "pending",
    error: null,
    result_url: null,
    screenshot_path: null,
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

async function waitForManualFinish(
  context: BrowserContext,
  page: Page,
  timeoutMs = 5 * 60 * 1000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) return;
    const pages = context.pages();
    if (pages.length === 0) return;
    // User closed all tabs / windows for this context
    const anyOpen = pages.some((p) => !p.isClosed());
    if (!anyOpen) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function runJob(job: PublishJob): Promise<void> {
  updateJob(job.id, { status: "running", error: null });
  const article = getArticle(job.article_id);
  if (!article) {
    updateJob(job.id, { status: "failed", error: "文章不存在" });
    return;
  }

  const publisher = getPublisher(job.platform);
  const content = articleToPublishContent(article);
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
    ]) {
      await context
        .grantPermissions(["clipboard-read", "clipboard-write"], { origin })
        .catch(() => undefined);
    }

    page = await context.newPage();
    const result = await publisher.publish(page, content);
    keepOpen = Boolean(result.keepOpen);

    if (result.success) {
      await saveSession(job.platform, context).catch(() => undefined);
      updateJob(job.id, {
        status: "success",
        result_url: result.url ?? page.url(),
        error: null,
        screenshot_path: result.screenshotPath ?? null,
      });
      keepOpen = false;
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
        await waitForManualFinish(context, page);
      }
      await context.close().catch(() => undefined);
    }
  }
}
