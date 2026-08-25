"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { JobStatus } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import { JobBadge } from "@/components/StatusBadge";
import { useAuth } from "@/components/useAuth";
import { useQuota } from "@/components/useQuota";
import type { WorkspacePlanView } from "@/lib/billing/types";

function platformName(id: string) {
  return PLATFORMS.find((p) => p.id === id)?.name ?? id;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    hour12: false,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const LANES = [
  {
    id: "factory",
    title: "内容工厂",
    body: "同一套语料成稿。文章、播客、剧本、视频挂在同一篇上。",
    href: "/writing",
    links: [
      { href: "/corpus", label: "语料" },
      { href: "/keywords", label: "挖词" },
      { href: "/writing", label: "写手" },
      { href: "/articles", label: "文章" },
      { href: "/podcasts", label: "播客" },
      { href: "/scripts", label: "剧本" },
      { href: "/characters", label: "角色" },
      { href: "/voices", label: "音色" },
      { href: "/videos", label: "视频" },
      { href: "/music", label: "音乐" },
    ],
  },
  {
    id: "ship",
    title: "投放",
    body: "自有号自己发。付费是软文代发。营销是百度、抖音这些广告代投。",
    href: "/ads",
    links: [
      { href: "/accounts", label: "自有号" },
      { href: "/media", label: "媒体" },
      { href: "/paid", label: "付费" },
      { href: "/ads", label: "营销" },
      { href: "/jobs", label: "同步" },
    ],
  },
  {
    id: "effect",
    title: "效果",
    body: "人问豆包、DeepSeek 时，能看到排第几。",
    href: "/mentions",
    links: [{ href: "/mentions", label: "查排名" }],
  },
] as const;

type DashArticle = { id: string; title: string; updated_at: string };
type DashJob = {
  id: string;
  platform: string;
  status: JobStatus;
  updated_at: string;
};
type DashMention = {
  hit_count: number;
  miss_count: number;
  error_count: number;
} | null;

export function DashboardPanel() {
  const { user, registered } = useAuth();
  const quota = useQuota();
  const [articles, setArticles] = useState<DashArticle[]>([]);
  const [articleCount, setArticleCount] = useState(0);
  const [jobs, setJobs] = useState<DashJob[]>([]);
  const [jobStats, setJobStats] = useState({
    draftOk: 0,
    published: 0,
    awaiting: 0,
    failed: 0,
  });
  const [mention, setMention] = useState<DashMention>(null);
  const [plan, setPlan] = useState<WorkspacePlanView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        setArticles(
          Array.isArray(data.articles) ? (data.articles as DashArticle[]) : [],
        );
        setArticleCount(Number(data.articleCount) || 0);
        setJobs(Array.isArray(data.jobs) ? (data.jobs as DashJob[]) : []);
        if (data.jobStats && typeof data.jobStats === "object") {
          setJobStats({
            draftOk: Number(data.jobStats.draftOk) || 0,
            published: Number(data.jobStats.published) || 0,
            awaiting: Number(data.jobStats.awaiting) || 0,
            failed: Number(data.jobStats.failed) || 0,
          });
        }
        setMention(
          data.mention && typeof data.mention === "object"
            ? (data.mention as DashMention)
            : null,
        );
        if (data.billing) setPlan(data.billing as WorkspacePlanView);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const billing = plan || quota.view;
  const draftOk = jobStats.draftOk;
  const published = jobStats.published;
  const awaiting = jobStats.awaiting;
  const failed = jobStats.failed;
  const mentionTotal = mention
    ? mention.hit_count + mention.miss_count + mention.error_count
    : 0;

  const laneStat: Record<string, string> = {
    factory: loading ? "—" : `${articleCount} 篇`,
    ship: loading ? "—" : `${draftOk + published} 次发布`,
    effect: loading
      ? "—"
      : mention
        ? `${mention.hit_count}/${mentionTotal}`
        : "还没测",
  };

  return (
    <div className="dash">
      <header className="dash-hero">
        <div>
          <h1>总览</h1>
          <p className="dash-lead">
            {registered && user ? user.displayName : "本地工作区"}
            {" · 工厂成稿，自己发或找媒体发，查 AI 搜索排名"}
            {awaiting ? ` · ${awaiting} 条待发布` : ""}
            {failed ? ` · ${failed} 条失败` : ""}
          </p>
        </div>
        <div className="dash-hero__actions">
          <Link href="/writing" className="btn btn-primary">
            写一篇
          </Link>
          <Link href="/mentions" className="btn btn-ghost">
            查排名
          </Link>
        </div>
      </header>

      {billing ? (
        <Link href="/plan" className="card dash-plan">
          <div>
            <strong>{billing.planName}</strong>
            <span>{billing.forWho}</span>
          </div>
          <ul>
            {billing.quotas.map((quotaItem) => (
              <li key={quotaItem.kind}>
                {quotaItem.label}{" "}
                {quotaItem.cap === "unlimited"
                  ? `${quotaItem.used}/不限`
                  : `${quotaItem.used}/${quotaItem.cap}`}
              </li>
            ))}
          </ul>
        </Link>
      ) : null}

      <ul className="dash-lanes">
        {LANES.map((lane) => (
          <li key={lane.id} className="card dash-lane">
            <Link href={lane.href} className="dash-lane__title">
              <h2>{lane.title}</h2>
              <strong>{laneStat[lane.id]}</strong>
            </Link>
            <p>{lane.body}</p>
            <div className="dash-lane__links">
              {lane.links.map((link) => (
                <Link key={link.href} href={link.href}>
                  {link.label}
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <ul className="dash-stats">
        <li>
          <span>文章</span>
          <strong>{loading ? "—" : articleCount}</strong>
        </li>
        <li>
          <span>草稿</span>
          <strong>{loading ? "—" : draftOk}</strong>
        </li>
        <li>
          <span>已发</span>
          <strong>{loading ? "—" : published}</strong>
        </li>
        <li>
          <span>查排名</span>
          <strong>
            {loading
              ? "—"
              : mention
                ? `${mention.hit_count}/${mentionTotal}`
                : "—"}
          </strong>
        </li>
      </ul>

      <div className="dash-grid">
        <section className="card dash-panel">
          <div className="dash-panel__head">
            <h2>工厂里的稿</h2>
            <Link href="/articles">全部</Link>
          </div>
          {loading ? (
            <p className="dash-empty">加载中…</p>
          ) : !articles.length ? (
            <p className="dash-empty">
              还没有文章。<Link href="/writing">写一篇</Link>
            </p>
          ) : (
            <ul className="dash-list">
              {articles.map((article) => (
                <li key={article.id}>
                  <Link href={`/articles/${article.id}`}>
                    <strong>{article.title || "未命名文章"}</strong>
                    <span>{formatTime(article.updated_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card dash-panel">
          <div className="dash-panel__head">
            <h2>最近投放</h2>
            <Link href="/jobs">全部</Link>
          </div>
          {loading ? (
            <p className="dash-empty">加载中…</p>
          ) : !jobs.length ? (
            <p className="dash-empty">还没有同步记录。</p>
          ) : (
            <ul className="dash-list">
              {jobs.map((job) => (
                <li key={job.id}>
                  <div className="dash-job">
                    <strong>{platformName(job.platform)}</strong>
                    <JobBadge status={job.status} />
                    <em>{formatTime(job.updated_at)}</em>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
