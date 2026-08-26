"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicPodcast } from "@/lib/ai/podcast-shared";
import type { PodcastPublishJob, PodcastTurn } from "@/lib/types";
import { JobBadge } from "@/components/StatusBadge";
import { jobStatusFromExtensionResult } from "@/lib/job-status";
import {
  publishXiaoyuzhouPodcastViaExtension,
  waitForDianwuGeoExtension,
} from "@/lib/dianwu-geo";
import { podcastPublishPlatformName } from "@/lib/podcast-publish-platforms";

function formatClock(sec: number) {
  const n = Math.max(0, Math.round(sec));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function absoluteMediaUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/") && typeof window !== "undefined") {
    return `${window.location.origin}${s}`;
  }
  return s;
}

export function PodcastListen({ podcast }: { podcast: PublicPodcast }) {
  const turns = podcast.turns || [];
  const [currentTurn, setCurrentTurn] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState("");
  const [publishJobs, setPublishJobs] = useState<PodcastPublishJob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const turnsRef = useRef<PodcastTurn[]>(turns);
  turnsRef.current = turns;

  useEffect(() => {
    setCurrentTurn(0);
  }, [podcast.id, podcast.audioUrl]);

  const loadJobs = useCallback(async () => {
    const res = await fetch("/api/podcasts/publish", {
      method: "GET",
      cache: "no-store",
    });
    const data = (await res.json()) as {
      jobs?: PodcastPublishJob[];
      error?: string;
    };
    if (!res.ok) throw new Error(data.error || "加载发布记录失败");
    if (data.jobs) {
      setPublishJobs(
        data.jobs.filter((job) => job.article_id === podcast.articleId).slice(0, 8),
      );
    }
  }, [podcast.articleId]);

  useEffect(() => {
    void loadJobs().catch(() => undefined);
  }, [loadJobs]);

  const publishBusy = publishJobs.some(
    (job) =>
      job.status === "pending" ||
      job.status === "running" ||
      job.status === "filled_awaiting_publish",
  );

  useEffect(() => {
    if (!publishBusy) return;
    const timer = window.setInterval(() => {
      void loadJobs().catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [publishBusy, loadJobs]);

  const duration =
    podcast.durationSec ||
    turns.reduce((sum, row) => sum + (row.durationSec || 0), 0);

  function playFrom(index: number) {
    const turn = turnsRef.current[index];
    const stitched = podcast.audioUrl;
    const el = audioRef.current;
    if (!el) return;
    if (stitched && index === 0) {
      setCurrentTurn(0);
      el.src = stitched;
      void el.play().catch(() => undefined);
      return;
    }
    if (!turn?.audioUrl) return;
    setCurrentTurn(index);
    el.src = turn.audioUrl;
    void el.play().catch(() => undefined);
  }

  function onEnded() {
    if (podcast.audioUrl) {
      setCurrentTurn(0);
      return;
    }
    const next = currentTurn + 1;
    if (next < turnsRef.current.length) playFrom(next);
    else setCurrentTurn(-1);
  }

  async function patchPodcastJob(
    jobId: string,
    result: {
      success?: boolean;
      error?: string;
      postUrl?: string;
      url?: string;
      awaitingUserPublish?: boolean;
      outcome?: string;
      message?: string;
    },
  ) {
    const status = jobStatusFromExtensionResult(result);
    const res = await fetch("/api/podcasts/publish", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        status,
        error: result.success === false ? result.error || result.message : null,
        resultUrl: result.postUrl || result.url || null,
      }),
    });
    const data = (await res.json()) as {
      jobs?: PodcastPublishJob[];
      error?: string;
    };
    if (!res.ok) throw new Error(data.error || "更新发布记录失败");
    if (data.jobs) {
      setPublishJobs(
        data.jobs.filter((job) => job.article_id === podcast.articleId).slice(0, 8),
      );
    }
  }

  async function publishXiaoyuzhou() {
    if (!podcast.audioUrl || !podcast.articleId) return;
    setPublishing(true);
    setPublishMsg("正在用扩展打开小宇宙…");
    let jobId = "";
    try {
      const extOk = await waitForDianwuGeoExtension(3_000);
      if (!extOk) {
        throw new Error("发到小宇宙需要点物扩展，请加载扩展后再发布");
      }
      const res = await fetch("/api/podcasts/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleId: podcast.articleId,
          platform: "xiaoyuzhou",
        }),
      });
      const data = (await res.json()) as {
        jobId?: string;
        audioUrl?: string;
        coverUrl?: string;
        title?: string;
        shownotes?: string;
        message?: string;
        error?: string;
        jobs?: PodcastPublishJob[];
      };
      if (!res.ok) throw new Error(data.error || "发布失败");
      if (data.jobs) {
        setPublishJobs(
          data.jobs.filter((job) => job.article_id === podcast.articleId).slice(0, 8),
        );
      }
      jobId = data.jobId || "";
      if (!jobId || !data.audioUrl) throw new Error("发布任务没有准备好");
      setPublishMsg(data.message || "正在把音频传到小宇宙主播后台…");
      const out = await publishXiaoyuzhouPodcastViaExtension({
        audioUrl: data.audioUrl,
        coverUrl: absoluteMediaUrl(data.coverUrl || podcast.coverUrl || ""),
        title: data.title || podcast.title || "未命名单集",
        shownotes: data.shownotes || "",
      });
      await patchPodcastJob(jobId, out);
      setPublishMsg(
        out.message ||
          (out.success
            ? "已打开小宇宙主播后台，请在打开的标签里点发布"
            : out.error || "发布失败"),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "发布失败";
      if (jobId) {
        await patchPodcastJob(jobId, { success: false, error: message }).catch(
          () => undefined,
        );
      }
      setPublishMsg(message);
    } finally {
      setPublishing(false);
    }
  }

  if (turns.length === 0 && !podcast.audioUrl) return null;

  const coverUrl = String(podcast.coverUrl || "").trim();
  const canPublish = Boolean(podcast.audioUrl);

  return (
    <div className="podcast-player">
      <div className={`podcast-player__hero${coverUrl ? " has-cover" : ""}`}>
        {coverUrl ? (
          <div className="podcast-player__cover">
            <img src={coverUrl} alt={podcast.title || "播客封面"} />
          </div>
        ) : null}
        <div className="podcast-player__info">
          <div className="podcast-player__stage-head">
            <div className="podcast-player__stage-title">
              <p className="video-music-lead__kicker">正在听</p>
              <h2 className="podcast-player__title">
                {podcast.title || "未命名对谈"}
              </h2>
            </div>
            <div className="podcast-player__actions">
              {podcast.audioUrl ? (
                <a
                  className="btn btn-ghost text-xs"
                  href={podcast.audioUrl}
                  download
                  target="_blank"
                  rel="noreferrer"
                >
                  下载
                </a>
              ) : null}
              {canPublish ? (
                <button
                  type="button"
                  className="btn btn-primary text-xs"
                  disabled={publishing}
                  onClick={() => void publishXiaoyuzhou()}
                >
                  {publishing ? "发布中…" : "发到小宇宙"}
                </button>
              ) : null}
            </div>
          </div>
          <p className="podcast-player__meta">
            {[
              podcast.mode === "solo" ? "口播" : "问答",
              turns.length ? `${turns.length} 轮` : "",
              duration ? formatClock(duration) : "",
              podcast.audioUrl ? "" : "按轮播放",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {publishMsg ? (
            <p
              className={`podcast-player__publish-msg ${
                /失败|找不到|先等|没有|需要|未登录/.test(publishMsg)
                  ? "is-err"
                  : ""
              }`}
            >
              {publishMsg}
            </p>
          ) : null}
          <div className="podcast-player__audio-wrap">
            <audio
              ref={audioRef}
              className="podcast-player__audio"
              controls
              src={podcast.audioUrl || turns[0]?.audioUrl || undefined}
              onEnded={onEnded}
              onPlay={() => {
                if (podcast.audioUrl) setCurrentTurn(0);
              }}
            />
          </div>
        </div>
      </div>
      {turns.length > 0 ? (
        <ol className="podcast-turns">
          {turns.map((turn, i) => (
            <li
              key={`${turn.index}-${i}`}
              className={
                currentTurn === i ? "podcast-turn is-current" : "podcast-turn"
              }
            >
              <button
                type="button"
                className="podcast-turn__who"
                disabled={!turn.audioUrl && !podcast.audioUrl}
                onClick={() => playFrom(i)}
              >
                {turn.name}
              </button>
              <p>{turn.text}</p>
            </li>
          ))}
        </ol>
      ) : null}
      {publishJobs.length > 0 ? (
        <section className="podcast-player__jobs">
          <h3>发布记录</h3>
          <ul>
            {publishJobs.map((job) => (
              <li key={job.id}>
                <JobBadge status={job.status} />
                <span>{podcastPublishPlatformName(job.platform)}</span>
                {job.error ? <span>{job.error}</span> : null}
                {job.result_url ? (
                  <a
                    href={job.result_url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    打开
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
