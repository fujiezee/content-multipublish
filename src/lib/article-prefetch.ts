import type { Article } from "@/lib/types";

type Hint = { title: string; summary?: string };

const articleCache = new Map<string, { article: Article; at: number }>();
const inflight = new Map<string, Promise<Article | null>>();
const hints = new Map<string, Hint>();

const FRESH_MS = 45_000;

export function rememberArticleHint(id: string, hint: Hint) {
  if (!id) return;
  hints.set(id, {
    title: hint.title || "未命名文章",
    summary: hint.summary,
  });
}

export function peekArticleHint(id: string): Hint | null {
  return hints.get(id) || null;
}

export function peekPrefetchedArticle(id: string): Article | null {
  const hit = articleCache.get(id);
  if (!hit) return null;
  if (Date.now() - hit.at > FRESH_MS) {
    articleCache.delete(id);
    return null;
  }
  return hit.article;
}

export function cacheArticle(article: Article) {
  if (!article?.id) return;
  articleCache.set(article.id, { article, at: Date.now() });
  rememberArticleHint(article.id, {
    title: article.title,
    summary: article.summary,
  });
}

export function prefetchArticle(id: string): Promise<Article | null> {
  if (!id || typeof window === "undefined") return Promise.resolve(null);
  const cached = peekPrefetchedArticle(id);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(id);
  if (pending) return pending;
  const req = fetch(`/api/articles/${id}`, { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as { article?: Article };
      if (!data.article) return null;
      cacheArticle(data.article);
      return data.article;
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(id);
    });
  inflight.set(id, req);
  return req;
}

export function prefetchArticleEditor() {
  if (typeof window === "undefined") return;
  void import("@/components/ArticleEditor");
}
