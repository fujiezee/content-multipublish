"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PublishJob } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import { JobBadge } from "@/components/StatusBadge";
import { JobErrorText } from "@/components/JobErrorText";
import {
  platformLoginActionCopy,
  platformLoginUrl,
} from "@/lib/platform-login";
import { getDianwuGeoAccounts } from "@/lib/dianwu-geo";
import { useInfiniteList } from "@/components/useInfiniteList";

export function JobsPanel() {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loginHint, setLoginHint] = useState<{ id: string; text: string } | null>(
    null,
  );

  const fetchPage = useCallback(async (offset: number, limit: number) => {
    const res = await fetch(`/api/jobs?limit=${limit}&offset=${offset}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("加载失败");
    const data = await res.json();
    return {
      items: (data.jobs as PublishJob[]) ?? [],
      nextOffset: data.nextOffset ?? null,
      hasMore: Boolean(data.hasMore),
    };
  }, []);

  const {
    items: jobs,
    booting,
    reload,
    refreshLoaded,
    sentinel,
  } = useInfiniteList<PublishJob>(fetchPage);

  useEffect(() => {
    if (!jobs.some((j) => j.status === "pending" || j.status === "running")) {
      return;
    }
    const t = setInterval(() => void refreshLoaded(), 2000);
    return () => clearInterval(t);
  }, [jobs, refreshLoaded]);

  async function retry(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/jobs/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      });
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function refreshLogin(job: PublishJob) {
    const url = platformLoginUrl(job.platform);
    setBusyId(job.id);
    try {
      const accounts = await getDianwuGeoAccounts(4_000);
      const acc = accounts.find((a) => a.type === job.platform);
      const loggedIn = Boolean(
        acc &&
          (String(acc.uid || "").trim() ||
            String(acc.displayName || "").trim() ||
            String(acc.title || "").trim()),
      );
      const name =
        PLATFORMS.find((p) => p.id === job.platform)?.name || job.platform;
      if (loggedIn) {
        setLoginHint({
          id: job.id,
          text: `${name} 已登录，可回文章页重试`,
        });
        return;
      }
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      setLoginHint({
        id: job.id,
        text: platformLoginActionCopy(job.platform, name).opened,
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">同步记录</h1>
        </div>
        <button className="btn btn-ghost" onClick={() => void reload()}>
          刷新
        </button>
      </div>

      {booting ? (
        <div className="card p-8 text-[var(--muted)]">加载中…</div>
      ) : jobs.length === 0 ? (
        <div className="card p-10 text-center text-[var(--muted)]">暂无发布任务</div>
      ) : (
        <>
          <ul className="space-y-3">
            {jobs.map((job) => {
              const name =
                PLATFORMS.find((p) => p.id === job.platform)?.name ?? job.platform;
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
                        {job.engine === "extension"
                          ? "扩展"
                          : job.engine === "api"
                            ? "API"
                            : "本机自动"}
                        {" · "}
                        {job.status === "running" || job.status === "pending"
                          ? `已 ${Math.max(
                              0,
                              Math.floor(
                                (Date.now() - Date.parse(job.updated_at)) / 1000,
                              ),
                            )} 秒 · ${new Date(job.updated_at).toLocaleString("zh-CN")}`
                          : new Date(job.updated_at).toLocaleString("zh-CN")}
                      </div>
                      {job.error && (
                        <p className="mt-2 text-sm text-[var(--danger)]">
                          <JobErrorText error={job.error} platform={job.platform} />
                        </p>
                      )}
                      {loginHint?.id === job.id ? (
                        <p className="mt-2 text-sm text-[var(--muted)]">
                          {loginHint.text}
                        </p>
                      ) : null}
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
                    {job.status === "failed" && job.engine === "extension" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {platformLoginUrl(job.platform) ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busyId === job.id}
                            onClick={() => void refreshLogin(job)}
                          >
                            {busyId === job.id ? "检测中…" : "刷新登录"}
                          </button>
                        ) : null}
                        <Link
                          className="btn btn-primary"
                          href={`/articles/${job.article_id}`}
                        >
                          去文章重试
                        </Link>
                      </div>
                    ) : job.status === "failed" ? (
                      <button
                        className="btn btn-primary"
                        disabled={busyId === job.id}
                        onClick={() => void retry(job.id)}
                      >
                        {busyId === job.id ? "重试中…" : "重试"}
                      </button>
                    ) : null}
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
