"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { VideoScriptPanel } from "@/components/VideoScriptPanel";

type Props = { articleId: string };

export function ScriptWorkspace({ articleId }: Props) {
  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/articles/${articleId}`);
        const data = (await res.json()) as {
          article?: { title?: string; body?: string };
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.article) {
          setError(data.error || "文章不存在");
          return;
        }
        setTitle(data.article.title || "");
        setBodyHtml(data.article.body || "");
        setReady(true);
      } catch {
        if (!cancelled) setError("加载文章失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">改剧本</h1>
          <p className="mt-1 text-[var(--muted)]">
            {title || "加载中…"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/scripts" className="btn btn-ghost">
            全部剧本
          </Link>
          <Link href={`/articles/${articleId}`} className="btn btn-ghost">
            看文章
          </Link>
          <Link href="/videos" className="btn btn-ghost">
            视频
          </Link>
        </div>
      </div>
      {error ? (
        <div className="card p-8 text-[var(--danger)]">{error}</div>
      ) : !ready ? (
        <div className="card p-8 text-[var(--muted)]">加载中…</div>
      ) : (
        <VideoScriptPanel
          articleId={articleId}
          title={title}
          bodyHtml={bodyHtml}
        />
      )}
    </div>
  );
}
