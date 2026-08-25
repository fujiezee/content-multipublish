"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  prefetchArticle,
  prefetchArticleEditor,
  rememberArticleHint,
} from "@/lib/article-prefetch";
import type { Article } from "@/lib/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { QuotaHint, QuotaMessage } from "@/components/QuotaHint";
import { parseQuotaError, useQuota } from "@/components/useQuota";
import { quotaRechargeText } from "@/lib/billing/copy";
import { useInfiniteList } from "@/components/useInfiniteList";

type ArticleRow = Article & {
  script_count?: number;
  video_count?: number;
  podcast_count?: number;
};

export function ArticleList() {
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const { snap, refresh, can } = useQuota();
  const articleQuota = snap("articles");
  const noArticleQuota = !can("articles");
  const router = useRouter();

  const fetchPage = useCallback(async (offset: number, limit: number) => {
    const res = await fetch(
      `/api/articles?limit=${limit}&offset=${offset}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "加载失败");
    return {
      items: (data.articles as ArticleRow[]) ?? [],
      nextOffset: data.nextOffset ?? null,
      hasMore: Boolean(data.hasMore),
    };
  }, []);

  const {
    items: articles,
    booting,
    reload,
    sentinel,
  } = useInfiniteList<ArticleRow>(fetchPage);

  useEffect(() => {
    let idleId: number | undefined;
    let timeoutId: number | undefined;
    if (typeof requestIdleCallback === "function") {
      idleId = requestIdleCallback(() => prefetchArticleEditor(), {
        timeout: 1800,
      });
    } else {
      timeoutId = window.setTimeout(() => prefetchArticleEditor(), 400);
    }
    return () => {
      if (idleId != null && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idleId);
      }
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, []);

  function warmArticle(article: ArticleRow) {
    rememberArticleHint(article.id, {
      title: article.title || "未命名文章",
      summary: article.summary,
    });
    void prefetchArticle(article.id);
  }

  async function createArticle() {
    if (noArticleQuota) {
      setCreateError(quotaRechargeText("articles"));
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "未命名文章", body: "" }),
      });
      const data = await res.json().catch(() => ({}));
      const quota = parseQuotaError(res, data);
      if (quota) {
        setCreateError(quota);
        void refresh();
        return;
      }
      if (!res.ok) {
        setCreateError(data.error || `创建失败（${res.status}）`);
        return;
      }
      if (data.article?.id) {
        void refresh();
        router.push(`/articles/${data.article.id}`);
      } else {
        setCreateError("创建成功但未返回文章 ID");
      }
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "创建失败，请检查服务是否在运行",
      );
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string, title: string) {
    const ok = await confirm({
      title: "确定删除这篇文章？",
      detail: `「${title || "未命名文章"}」的正文、变体和同步记录会一起删掉，删了找不回来。`,
      confirmLabel: "删除文章",
      cancelLabel: "先留着",
    });
    if (!ok) return;
    await fetch(`/api/articles/${id}`, { method: "DELETE" });
    await reload();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">文章</h1>
          <p className="mt-1 text-[var(--muted)]">
            同一篇稿三种出法：文、播客、短视频
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <QuotaHint snap={articleQuota} need={1} />
          <button
            className="btn btn-primary"
            onClick={createArticle}
            disabled={creating || noArticleQuota}
          >
            {creating ? "创建中…" : "新建文章"}
          </button>
        </div>
      </div>

      {createError ? (
        <QuotaMessage text={createError} className="text-sm text-[var(--danger)]" />
      ) : null}

      {booting ? (
        <div className="card p-8 text-[var(--muted)]">加载中…</div>
      ) : articles.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg">还没有文章</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            创建一篇，用浏览器扩展同步到各平台草稿，确认后再发布
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <button
              className="btn btn-primary"
              onClick={createArticle}
              disabled={creating || noArticleQuota}
            >
              开始写作
            </button>
            <QuotaHint snap={articleQuota} need={1} />
          </div>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {articles.map((article) => {
              const scripts = article.script_count ?? 0;
              const videos = article.video_count ?? 0;
              const pods = article.podcast_count ?? 0;
              return (
                <li
                  key={article.id}
                  className="card flex items-center justify-between gap-4 p-5 transition-shadow hover:shadow-[0_10px_30px_rgba(28,25,21,0.06)]"
                >
                  <Link
                    href={`/articles/${article.id}`}
                    className="min-w-0 flex-1"
                    onPointerEnter={() => warmArticle(article)}
                    onFocus={() => warmArticle(article)}
                    onPointerDown={() => warmArticle(article)}
                  >
                    <div className="truncate text-lg font-medium">
                      {article.title || "未命名文章"}
                    </div>
                    <div className="mt-1 text-sm text-[var(--muted)]">
                      更新于 {new Date(article.updated_at).toLocaleString("zh-CN")}
                      {scripts === 0
                        ? " · 还没拆剧本"
                        : ` · 剧本 ${scripts} 集${videos ? ` · 视频 ${videos} 条` : ""}`}
                      {pods ? " · 已有播客" : ""}
                      {article.summary ? ` · ${article.summary.slice(0, 48)}` : ""}
                    </div>
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <Link
                      href={
                        pods
                          ? `/podcasts?article=${article.id}`
                          : `/articles/${article.id}#podcast`
                      }
                      className="btn btn-ghost"
                    >
                      播客
                    </Link>
                    <Link
                      href={`/scripts/${article.id}`}
                      className="btn btn-ghost"
                    >
                      剧本
                    </Link>
                    <Link
                      href={videos ? "/videos" : `/scripts/${article.id}`}
                      className="btn btn-ghost"
                    >
                      视频
                    </Link>
                    <Link
                      href={`/articles/${article.id}`}
                      className="btn btn-ghost"
                      onPointerEnter={() => warmArticle(article)}
                      onFocus={() => warmArticle(article)}
                      onPointerDown={() => warmArticle(article)}
                    >
                      编辑
                    </Link>
                    <button
                      className="btn btn-danger"
                      onClick={() => void remove(article.id, article.title)}
                    >
                      删除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {sentinel}
        </>
      )}
    </div>
  );
}
