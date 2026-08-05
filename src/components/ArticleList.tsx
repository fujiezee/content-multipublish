"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Article } from "@/lib/types";

export function ArticleList() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  async function load() {
    setLoading(true);
    const res = await fetch("/api/articles");
    const data = await res.json();
    setArticles(data.articles ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createArticle() {
    setCreating(true);
    try {
      const res = await fetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "未命名文章", body: "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || `创建失败（${res.status}）`);
        return;
      }
      if (data.article?.id) {
        router.push(`/articles/${data.article.id}`);
      } else {
        alert("创建成功但未返回文章 ID");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "创建失败，请检查服务是否在运行");
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("确定删除这篇文章？")) return;
    await fetch(`/api/articles/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">文章</h1>
          <p className="mt-1 text-[var(--muted)]">
            写一篇，分发到微博、百家号、知乎
          </p>
        </div>
        <button className="btn btn-primary" onClick={createArticle} disabled={creating}>
          {creating ? "创建中…" : "新建文章"}
        </button>
      </div>

      {loading ? (
        <div className="card p-8 text-[var(--muted)]">加载中…</div>
      ) : articles.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg">还没有文章</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            创建一篇，再用 Playwright 推到各平台
          </p>
          <button className="btn btn-primary mt-6" onClick={createArticle}>
            开始写作
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {articles.map((article) => (
            <li
              key={article.id}
              className="card flex items-center justify-between gap-4 p-5 transition-shadow hover:shadow-[0_10px_30px_rgba(28,25,21,0.06)]"
            >
              <Link href={`/articles/${article.id}`} className="min-w-0 flex-1">
                <div className="truncate text-lg font-medium">
                  {article.title || "未命名文章"}
                </div>
                <div className="mt-1 text-sm text-[var(--muted)]">
                  更新于 {new Date(article.updated_at).toLocaleString("zh-CN")}
                  {article.summary ? ` · ${article.summary.slice(0, 48)}` : ""}
                </div>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <Link href={`/articles/${article.id}`} className="btn btn-ghost">
                  编辑
                </Link>
                <button className="btn btn-danger" onClick={() => remove(article.id)}>
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
