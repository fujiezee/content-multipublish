"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Article, PlatformId, PlatformSession, PublishJob } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import { JobBadge } from "@/components/StatusBadge";
import { RichTextEditor } from "@/components/RichTextEditor";
import { toEditorHtml } from "@/lib/content/adapt";
import {
  beginOpenDianwuGeoPanel,
  stashArticleForDianwuGeo,
  formatDianwuGeoOpenMessage,
  getExtensionIdFromDom,
  isDianwuGeoExtensionPresent,
  pingDianwuGeoExtension,
  waitForDianwuGeoExtension,
  DIANWU_GEO_PRODUCT_NAME,
  type DianwuGeoOpenResult,
} from "@/lib/dianwu-geo";

export function ArticleEditor({ id }: { id: string }) {
  const router = useRouter();
  const [article, setArticle] = useState<Article | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [summary, setSummary] = useState("");
  const [coverPath, setCoverPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [showPublish, setShowPublish] = useState(false);
  const [sessions, setSessions] = useState<PlatformSession[]>([]);
  // Default: core set only — avoid launching every platform at once
  const [selected, setSelected] = useState<PlatformId[]>([
    "zhihu",
    "weibo",
    "baijiahao",
    "jianshu",
    "csdn",
    "toutiao",
    "juejin",
  ]);
  const [publishing, setPublishing] = useState(false);
  const [syncingExt, setSyncingExt] = useState(false);
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [extensionReady, setExtensionReady] = useState<boolean | null>(null);
  const [clientMounted, setClientMounted] = useState(false);
  const manualSyncRunningRef = useRef(false);
  const manualSyncWaitRef = useRef<Promise<DianwuGeoOpenResult> | null>(null);
  const jobsLoadingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles/${id}`, { cache: "no-store" });
      if (!res.ok) {
        router.push("/");
        return;
      }
      const data = await res.json();
      const a = data.article as Article;
      const html = toEditorHtml(a.body);
      setArticle({ ...a, body: html });
      setTitle(a.title);
      setBody(html);
      setSummary(a.summary);
      setCoverPath(a.cover_path);
    } catch {
      // Transient network errors (e.g. dev server restart) — keep current editor state.
    }
  }, [id, router]);

  const loadJobs = useCallback(async () => {
    if (jobsLoadingRef.current) return;
    jobsLoadingRef.current = true;
    try {
      const res = await fetch(`/api/articles/${id}/jobs`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs ?? []);
    } catch {
      // Polling must not crash the page when the API is briefly unavailable.
    } finally {
      jobsLoadingRef.current = false;
    }
  }, [id]);

  useEffect(() => {
    setArticle(null);
    setTitle("");
    setBody("");
    setSummary("");
    setCoverPath(null);
    setJobs([]);
    manualSyncWaitRef.current = null;
    void load();
    void loadJobs();
  }, [id, load, loadJobs]);

  useEffect(() => {
    if (!article) return;
    const timer = window.setTimeout(() => {
      stashArticleForDianwuGeo(buildManualSyncArticle());
    }, 200);
    return () => window.clearTimeout(timer);
  }, [article, title, body, summary, coverPath]);

  useEffect(() => {
    if (!article) return;
    const pageTitle = title.trim() || "未命名";
    const previousTitle = document.title;
    document.title = pageTitle;
    return () => {
      document.title = previousTitle;
    };
  }, [article, title]);

  useEffect(() => {
    setClientMounted(true);
  }, []);

  useEffect(() => {
    if (!clientMounted) return;
    let cancelled = false;
    const check = async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (cancelled) return;
        if (await pingDianwuGeoExtension(2000)) {
          if (!cancelled) setExtensionReady(true);
          return;
        }
        await new Promise((r) => setTimeout(r, 350));
      }
      if (!cancelled) setExtensionReady(false);
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [id, clientMounted]);

  const dirty = useMemo(() => {
    if (!article) return false;
    return (
      title !== article.title ||
      body !== article.body ||
      summary !== article.summary ||
      coverPath !== article.cover_path
    );
  }, [article, title, body, summary, coverPath]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/articles/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          summary,
          cover_path: coverPath,
        }),
      });
      const data = await res.json();
      setArticle(data.article);
      setSavedAt(new Date().toLocaleTimeString("zh-CN"));
    } finally {
      setSaving(false);
    }
  }

  async function openPublish() {
    if (dirty) await save();
    const res = await fetch("/api/platforms");
    const data = await res.json();
    setSessions(data.sessions ?? []);
    setShowPublish(true);
  }

  async function publish() {
    setPublishing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId: id, platforms: selected }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "发布失败");
        return;
      }
      setShowPublish(false);
      setMessage("已加入发布队列：一次只开一个平台，完成或关闭窗口后再发下一个");
      await loadJobs();
    } finally {
      setPublishing(false);
    }
  }

  async function onCover(file: File | null) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await res.json();
    if (data.path) setCoverPath(data.path);
  }

  function buildManualSyncArticle() {
    let thumb: string | undefined;
    if (coverPath) {
      if (coverPath.startsWith("http")) {
        thumb = coverPath;
      } else {
        const name = coverPath.split("/").pop();
        thumb = name
          ? `${window.location.origin}/api/uploads/${name}`
          : undefined;
      }
    }
    return {
      title: title.trim() || "未命名",
      desc: summary.trim() || undefined,
      content: body || "<p></p>",
      thumb,
    };
  }

  useEffect(() => {
    if (!jobs.some((j) => j.status === "pending" || j.status === "running")) return;
    const t = setInterval(() => void loadJobs(), 2000);
    return () => clearInterval(t);
  }, [jobs, loadJobs]);

  async function runManualSync() {
    if (manualSyncRunningRef.current || syncingExt) return;
    manualSyncRunningRef.current = true;
    setSyncingExt(true);
    setMessage(null);

    if (!isDianwuGeoExtensionPresent()) {
      const ready = await waitForDianwuGeoExtension(3_000);
      if (!ready) {
        const domMarker = getExtensionIdFromDom();
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        setExtensionReady(false);
        setMessage(
          domMarker
            ? `${DIANWU_GEO_PRODUCT_NAME}已连接但页面桥接未就绪，请硬刷新（Cmd+Shift+R）后重试。`
            : `未检测到${DIANWU_GEO_PRODUCT_NAME}。请确认：① chrome://extensions 已加载「未打包的扩展程序」目录 tools/dianwu-geo（不是 tools/wechatsync）；② 扩展已启用；③ 用 ${origin.includes("localhost") ? origin : "http://localhost:3000"} 打开本页；④ 加载扩展后硬刷新本页。`,
        );
        manualSyncRunningRef.current = false;
        setSyncingExt(false);
        return;
      }
    }

    const wait =
      manualSyncWaitRef.current ??
      beginOpenDianwuGeoPanel(buildManualSyncArticle()).wait;
    manualSyncWaitRef.current = null;
    stashArticleForDianwuGeo(buildManualSyncArticle());
    const saveTask = dirty ? save() : Promise.resolve();

    try {
      const [result] = await Promise.all([wait, saveTask]);
      setExtensionReady(true);
      setMessage(formatDianwuGeoOpenMessage(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage(msg);
    } finally {
      manualSyncRunningRef.current = false;
      setSyncingExt(false);
    }
  }

  function handleManualSyncPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 || manualSyncRunningRef.current || !title.trim()) return;
    const { wait } = beginOpenDianwuGeoPanel(buildManualSyncArticle());
    manualSyncWaitRef.current = wait;
    void runManualSync();
  }

  if (!article) {
    return <div className="card p-8 text-[var(--muted)]">加载中…</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button className="btn btn-ghost" onClick={() => router.push("/")}>
          ← 返回
        </button>
        <div className="flex items-center gap-2">
          {savedAt && (
            <span className="text-sm text-[var(--muted)]">已保存 {savedAt}</span>
          )}
          <button className="btn btn-ghost" onClick={save} disabled={saving || !dirty}>
            {saving ? "保存中…" : dirty ? "保存" : "已保存"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onPointerDown={handleManualSyncPointerDown}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void runManualSync();
              }
            }}
            disabled={syncingExt || !title.trim()}
            title={
              clientMounted && extensionReady === false
                ? `未检测到扩展，请重新加载 tools/dianwu-geo`
                : `打开浏览器扩展「${DIANWU_GEO_PRODUCT_NAME}」面板（建议先固定到工具栏）`
            }
          >
            {syncingExt ? "拉起中…" : "手动多平台同步"}
          </button>
          <button className="btn btn-primary" onClick={openPublish}>
            全自动发布到平台
          </button>
        </div>
      </div>

      {message && (
        <div className="card border-[var(--accent)]/30 bg-[var(--accent-soft)]/50 px-4 py-3 text-sm">
          {message}
        </div>
      )}

      <div className="card space-y-4 p-5 md:p-7">
        <input
          className="field text-2xl font-semibold"
          placeholder="文章标题"
          value={title}
          data-dwgeo-article-title
          data-value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="field"
          placeholder="摘要（可选，用于部分平台简介）"
          value={summary}
          data-dwgeo-article-summary
          onChange={(e) => setSummary(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          {coverPath && (
            <span
              className="hidden"
              aria-hidden
              data-dwgeo-article-cover={
                coverPath.startsWith("http")
                  ? coverPath
                  : `/api/uploads/${coverPath.split("/").pop()}`
              }
            />
          )}
          <label className="btn btn-ghost cursor-pointer">
            上传封面
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void onCover(e.target.files?.[0] ?? null)}
            />
          </label>
          {coverPath && (
            <span className="text-sm text-[var(--muted)]">
              封面已选 ·{" "}
              <button
                className="underline"
                onClick={() => setCoverPath(null)}
                type="button"
              >
                清除
              </button>
            </span>
          )}
        </div>
        <div data-dwgeo-article-body>
          <RichTextEditor
            value={body}
            onChange={setBody}
            placeholder="在这里写正文，支持标题、加粗、列表、链接、图片…"
          />
        </div>
      </div>

      {jobs.length > 0 && (
        <div className="card p-5">
          <h2 className="text-lg font-medium">本文发布记录</h2>
          <ul className="mt-3 space-y-2">
            {jobs.slice(0, 8).map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[#fffdf9] px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <JobBadge status={job.status} />
                  <span>{PLATFORMS.find((p) => p.id === job.platform)?.name}</span>
                </div>
                <div className="text-sm text-[var(--muted)]">
                  {job.result_url ? (
                    <a
                      href={job.result_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      查看链接
                    </a>
                  ) : (
                    job.error || new Date(job.updated_at).toLocaleString("zh-CN")
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showPublish && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/35 p-4">
          <div className="card flex max-h-[min(85vh,720px)] w-full max-w-lg flex-col p-0 shadow-2xl">
            <div className="shrink-0 border-b border-[var(--line)] px-6 py-5">
              <h2 className="text-xl font-semibold">选择发布平台</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                将串行打开发布浏览器窗口，请保持本机可用
              </p>
            </div>
            <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
              {PLATFORMS.map((p) => {
                const session = sessions.find((s) => s.platform === p.id);
                const connected = session?.status === "connected";
                return (
                  <li
                    key={p.id}
                    className="rounded-xl border border-[var(--line)] bg-[#fffdf9] p-3"
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.includes(p.id)}
                        onChange={(e) => {
                          setSelected((prev) =>
                            e.target.checked
                              ? [...prev, p.id]
                              : prev.filter((x) => x !== p.id),
                          );
                        }}
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{p.name}</span>
                          <span
                            className={`badge ${connected ? "badge-ok" : "badge-warn"}`}
                          >
                            {connected ? "已连接" : "未连接"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--muted)]">{p.limits}</p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--line)] px-6 py-4">
              <button className="btn btn-ghost" onClick={() => setShowPublish(false)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                disabled={publishing || selected.length === 0}
                onClick={publish}
              >
                {publishing ? "提交中…" : "开始发布"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
