"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PublishJob } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import { JobBadge } from "@/components/StatusBadge";

export function JobsPanel() {
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs ?? []);
    } catch {
      // Ignore transient fetch failures during polling.
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!jobs.some((j) => j.status === "pending" || j.status === "running")) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [jobs, load]);

  async function retry(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/jobs/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">发布记录</h1>
          <p className="mt-1 text-[var(--muted)]">
            串行执行 · 失败可重试 · 调试截图在 data/debug/
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => void load()}>
          刷新
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="card p-10 text-center text-[var(--muted)]">暂无发布任务</div>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => {
            const name = PLATFORMS.find((p) => p.id === job.platform)?.name ?? job.platform;
            return (
              <li key={job.id} className="card p-4 md:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <JobBadge status={job.status} />
                      <span className="font-medium">{name}</span>
                    </div>
                    <div className="mt-2 text-sm text-[var(--muted)]">
                      文章{" "}
                      <Link className="underline" href={`/articles/${job.article_id}`}>
                        {job.article_id.slice(0, 8)}…
                      </Link>
                      {" · "}
                      {new Date(job.updated_at).toLocaleString("zh-CN")}
                    </div>
                    {job.error && (
                      <p className="mt-2 text-sm text-[var(--danger)]">{job.error}</p>
                    )}
                    {job.result_url && (
                      <a
                        href={job.result_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-sm text-[var(--accent)] underline"
                      >
                        {job.result_url}
                      </a>
                    )}
                    {job.screenshot_path && (
                      <p className="mt-1 font-[family-name:var(--font-mono)] text-xs text-[var(--muted)]">
                        截图：{job.screenshot_path}
                      </p>
                    )}
                  </div>
                  {job.status === "failed" && (
                    <button
                      className="btn btn-primary"
                      disabled={busyId === job.id}
                      onClick={() => void retry(job.id)}
                    >
                      {busyId === job.id ? "重试中…" : "重试"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
