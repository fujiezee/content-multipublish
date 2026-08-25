"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { VideoScriptPanel } from "@/components/VideoScriptPanel";
import { ScriptSourceDialog } from "@/components/ScriptSourceDialog";
import { resolveScriptSourceKind } from "@/lib/ai/script-import";

type Props = { articleId: string };

function scriptHref(
  articleId: string,
  input?: { rewrite?: boolean; episodeCount?: number; hasSequel?: boolean },
): string {
  if (!input?.rewrite) return `/scripts/${articleId}`;
  const qs = new URLSearchParams({ rewrite: "1" });
  if (input.episodeCount) qs.set("count", String(input.episodeCount));
  if (input.hasSequel) qs.set("sequel", "1");
  return `/scripts/${articleId}?${qs}`;
}

export function ScriptWorkspace({ articleId }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoRewrite, setAutoRewrite] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("rewrite") === "1";
  });
  const [initialCount, setInitialCount] = useState<number | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    const count = Number(new URLSearchParams(window.location.search).get("count"));
    return Number.isFinite(count) && count > 0 ? count : undefined;
  });
  const [initialSequel, setInitialSequel] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("sequel") === "1";
  });
  const [panelKey, setPanelKey] = useState(0);

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
        if (!cancelled) setError("加载失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  async function saveSource(input: {
    title: string;
    body: string;
    rewrite: boolean;
    episodeCount: number;
    hasSequel: boolean;
  }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles/${articleId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: input.title || title,
          body: input.body,
          script_title: input.title || title,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "保存失败");
      setTitle(input.title || title);
      setBodyHtml(input.body);
      setImportOpen(false);
      if (input.rewrite) {
        setInitialCount(input.episodeCount);
        setInitialSequel(input.hasSequel);
        setAutoRewrite(true);
        setPanelKey((n) => n + 1);
        router.replace(
          scriptHref(articleId, {
            rewrite: true,
            episodeCount: input.episodeCount,
            hasSequel: input.hasSequel,
          }),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">改剧本</h1>
          <p className="mt-1 text-[var(--muted)]">{title || "加载中…"}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/scripts" className="btn btn-ghost">
            全部剧本
          </Link>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!ready}
            onClick={() => setImportOpen(true)}
          >
            导入改写
          </button>
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
          key={`${articleId}-${panelKey}`}
          articleId={articleId}
          title={title}
          bodyHtml={bodyHtml}
          sourceKind={resolveScriptSourceKind(undefined, bodyHtml)}
          autoGenerate={autoRewrite}
          forceGenerate={panelKey > 0}
          initialEpisodeCount={initialCount}
          initialHasSequel={initialSequel}
        />
      )}
      <ScriptSourceDialog
        open={importOpen}
        mode="import"
        busy={saving}
        defaultTitle={title}
        onClose={() => setImportOpen(false)}
        onSubmit={saveSource}
      />
    </div>
  );
}
