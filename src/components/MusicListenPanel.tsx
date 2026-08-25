"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { musicStyleSummary } from "@/lib/ai/music-styles";
import type { SeriesMusicState, SeriesMusicTrack } from "@/lib/ai/video-music";
import { musicNeedsCoverFill } from "@/lib/ai/music-cover-fill";
import { MUSIC_PUBLISH_PLATFORMS } from "@/lib/music-publish-platforms";
import type { MusicPublishJob } from "@/lib/types";
import { JobBadge } from "@/components/StatusBadge";
import { JobErrorText } from "@/components/JobErrorText";
import { jobStatusFromExtensionResult } from "@/lib/job-status";
import {
  publishDouyinMusicViaExtension,
  waitForDianwuGeoExtension,
} from "@/lib/dianwu-geo";

type Props = {
  articleId: string;
  seriesTitle: string;
};

function playable(track: SeriesMusicTrack) {
  return (track.url || track.streamUrl || "").trim();
}

function durationLabel(sec?: number) {
  if (!sec || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function platformLabel(id: string) {
  return MUSIC_PUBLISH_PLATFORMS.find((row) => row.id === id)?.name || id;
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

export function MusicListenPanel({ articleId, seriesTitle }: Props) {
  const [music, setMusic] = useState<SeriesMusicState | null>(null);
  const [playingId, setPlayingId] = useState("");
  const [error, setError] = useState("");
  const [booting, setBooting] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [publishJobs, setPublishJobs] = useState<MusicPublishJob[]>([]);
  const awaitingJobIdRef = useRef("");
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const node = pickerRef.current;
      if (!node || node.contains(event.target as Node)) return;
      setPickerOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pickerOpen]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/articles/${articleId}/video-music`);
    const data = (await res.json()) as {
      music?: SeriesMusicState;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error || "加载失败");
    if (data.music) {
      setMusic(data.music);
      setPlayingId((cur) => {
        const tracks = data.music?.tracks.filter((row) => playable(row)) || [];
        if (cur && tracks.some((row) => row.id === cur)) return cur;
        return data.music?.selectedTrackId || tracks[0]?.id || "";
      });
    }
    if (data.error) setError(data.error);
  }, [articleId]);

  const loadJobs = useCallback(async () => {
    const res = await fetch("/api/music/publish", {
      method: "GET",
      cache: "no-store",
    });
    const data = (await res.json()) as {
      jobs?: MusicPublishJob[];
      error?: string;
    };
    if (!res.ok) throw new Error(data.error || "加载发布记录失败");
    if (data.jobs) {
      setPublishJobs(
        data.jobs.filter((job) => job.article_id === articleId).slice(0, 8),
      );
    }
  }, [articleId]);

  useEffect(() => {
    let gone = false;
    setBooting(true);
    setError("");
    void Promise.all([load(), loadJobs().catch(() => undefined)])
      .catch((err) => {
        if (!gone) setError(err instanceof Error ? err.message : "加载失败");
      })
      .finally(() => {
        if (!gone) setBooting(false);
      });
    return () => {
      gone = true;
    };
  }, [load, loadJobs]);

  const waitingSuno =
    music?.status === "pending" || music?.status === "processing";
  const waitingCovers = music ? musicNeedsCoverFill(music) : false;

  useEffect(() => {
    if (!waitingSuno && !waitingCovers) return;
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
    }, waitingSuno ? 4000 : 2500);
    return () => window.clearInterval(timer);
  }, [waitingSuno, waitingCovers, load]);

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

  const tracks = music?.tracks.filter((row) => playable(row)) || [];
  const current =
    tracks.find((row) => row.id === playingId) ||
    tracks.find((row) => row.id === music?.selectedTrackId) ||
    tracks[0] ||
    null;
  const src = current ? playable(current) : "";
  const coverUrl = (current?.coverUrl || music?.coverUrl || "").trim();
  const generating =
    music?.status === "pending" || music?.status === "processing";
  const style = music
    ? musicStyleSummary(music.styleTags, music.styleExtra)
    : "";
  const vocal =
    music?.vocal === "f" ? "女声" : music?.vocal === "m" ? "男声" : "";

  async function pickTrack(trackId: string) {
    setPlayingId(trackId);
    setMusic((cur) => (cur ? { ...cur, selectedTrackId: trackId } : cur));
    await fetch(`/api/articles/${articleId}/video-music`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedTrackId: trackId }),
    });
  }

  async function patchMusicJob(
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
    const res = await fetch("/api/music/publish", {
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
      jobs?: MusicPublishJob[];
      error?: string;
    };
    if (!res.ok) throw new Error(data.error || "更新发布记录失败");
    if (data.jobs) {
      setPublishJobs(
        data.jobs.filter((job) => job.article_id === articleId).slice(0, 8),
      );
    }
  }

  async function publishMusic(
    platform: (typeof MUSIC_PUBLISH_PLATFORMS)[number]["id"],
  ) {
    if (!current || !src) return;
    setPublishing(true);
    setPublishMsg(
      platform === "qishui" ? "正在用扩展打开汽水…" : "正在用扩展打开抖音音乐…",
    );
    let jobId = "";
    try {
      const extOk = await waitForDianwuGeoExtension(3_000);
      if (!extOk) {
        throw new Error("发歌需要点物扩展，请加载扩展后再发布");
      }
      const res = await fetch("/api/music/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleId,
          trackId: current.id,
          platform,
        }),
      });
      const data = (await res.json()) as {
        jobId?: string;
        audioUrl?: string;
        coverUrl?: string;
        title?: string;
        lyrics?: string;
        message?: string;
        error?: string;
        jobs?: MusicPublishJob[];
      };
      if (!res.ok) throw new Error(data.error || "发布失败");
      if (data.jobs) {
        setPublishJobs(
          data.jobs.filter((job) => job.article_id === articleId).slice(0, 8),
        );
      }
      jobId = data.jobId || "";
      awaitingJobIdRef.current = jobId;
      if (!jobId || !data.audioUrl) throw new Error("发布任务没有准备好");
      setPublishMsg(data.message || "正在把歌曲传到开放平台…");
      setPickerOpen(false);
      const out = await publishDouyinMusicViaExtension({
        audioUrl: data.audioUrl,
        coverUrl: absoluteMediaUrl(
          data.coverUrl || current.coverUrl || music?.coverUrl || "",
        ),
        title: data.title || music?.songTitle || current.title || "未名曲",
        lyrics: data.lyrics || "",
        platform,
      });
      await patchMusicJob(jobId, out);
      setPublishMsg(
        out.message ||
          (out.success
            ? "歌曲已传到开放平台，请在打开的标签里点发布"
            : out.error || "发布失败"),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "发布失败";
      if (jobId) {
        await patchMusicJob(jobId, { success: false, error: message }).catch(
          () => undefined,
        );
      }
      setPublishMsg(message);
    } finally {
      setPublishing(false);
    }
  }

  if (booting) {
    return <p className="text-sm text-[var(--muted)]">加载中…</p>;
  }

  if (!tracks.length) {
    return (
      <section className="card music-listen music-listen--empty">
        <p className="video-music-lead__kicker">听歌</p>
        <h2>{generating ? "正在出歌" : "还没有歌"}</h2>
        <p>
          {generating
            ? "大约一两分钟。出好后会直接出现在这里。"
            : "写词和出歌在剧本页。这里只听已经生成的歌。"}
        </p>
        {error ? <p className="music-listen__err">{error}</p> : null}
        {!generating ? (
          <Link href={`/scripts/${articleId}`} className="btn btn-primary w-fit">
            去剧本页出歌
          </Link>
        ) : null}
      </section>
    );
  }

  return (
    <div className="music-listen">
      <section className="card music-listen__stage">
        <div
          className={`music-listen__hero${coverUrl ? " has-cover" : ""}`}
        >
          {coverUrl ? (
            <div className="music-listen__cover">
              <img
                src={coverUrl}
                alt={music?.songTitle || current?.title || "封面"}
              />
            </div>
          ) : null}
          <div className="music-listen__info">
            <div className="music-listen__stage-head">
              <div className="music-listen__stage-title">
                <p className="video-music-lead__kicker">正在听</p>
                <h2 className="music-listen__now">
                  {music?.songTitle ||
                    current?.title ||
                    seriesTitle ||
                    "未名曲"}
                </h2>
              </div>
              <div className="music-listen__publish" ref={pickerRef}>
                <button
                  type="button"
                  className="btn btn-primary text-xs"
                  disabled={publishing || !src}
                  onClick={() => setPickerOpen((open) => !open)}
                >
                  {publishing ? "发布中…" : "发布"}
                </button>
                {pickerOpen ? (
                  <div className="music-listen__publish-menu">
                    {MUSIC_PUBLISH_PLATFORMS.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        className="flex w-full cursor-pointer items-center rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed"
                        disabled={publishing}
                        onClick={() => void publishMusic(row.id)}
                      >
                        {row.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <p className="music-listen__meta">
              {[
                vocal,
                style !== "选曲风" ? style : "",
                durationLabel(current?.duration),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {waitingCovers ? (
              <p className="music-listen__meta">封面还在出，每首歌各一张。</p>
            ) : null}
            {generating ? (
              <p className="music-listen__wait">还有版本在出，大约一两分钟。</p>
            ) : null}
            {error ? <p className="music-listen__err">{error}</p> : null}
            {publishMsg ? (
              <p
                className={`music-listen__publish-msg ${
                  /失败|找不到|先等|没有|需要/.test(publishMsg) ? "is-err" : ""
                }`}
              >
                {publishMsg}
              </p>
            ) : null}
            {src ? (
              <div className="music-listen__player">
                <audio key={src} controls src={src} preload="metadata" />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="card music-listen__list">
        <div className="music-listen__list-head">
          <h3>已生成 {tracks.length} 首</h3>
          <Link href={`/scripts/${articleId}`} className="btn btn-ghost text-xs">
            再出一版
          </Link>
        </div>
        <ul>
          {tracks.map((track, index) => {
            const on = track.id === (current?.id || "");
            const chosen =
              track.id === (music?.selectedTrackId || tracks[0]?.id);
            return (
              <li key={track.id || index}>
                <button
                  type="button"
                  className={`music-listen__take${on ? " is-on" : ""}`}
                  onClick={() => void pickTrack(track.id)}
                >
                  {track.coverUrl ? (
                    <img
                      src={track.coverUrl}
                      alt=""
                      className="music-listen__take-cover"
                    />
                  ) : (
                    <span className="music-listen__take-n">
                      {waitingCovers ? "…" : index + 1}
                    </span>
                  )}
                  <span className="music-listen__take-body">
                    <strong>
                      {track.title ||
                        music?.songTitle ||
                        `版本 ${index + 1}`}
                    </strong>
                    <em>
                      {durationLabel(track.duration) || "可播放"}
                      {chosen ? " · 合成用这首" : ""}
                    </em>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {publishJobs.length > 0 ? (
        <section className="card music-listen__jobs">
          <h3>发布记录</h3>
          <ul className="space-y-2">
            {publishJobs.map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]"
              >
                <JobBadge status={job.status} />
                <span>{platformLabel(job.platform)}</span>
                {job.error ? (
                  <JobErrorText error={job.error} platform="douyin" />
                ) : null}
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
