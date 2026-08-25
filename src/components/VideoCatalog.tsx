"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScriptSourceDialog } from "@/components/ScriptSourceDialog";
import { QuotaHint, QuotaMessage } from "@/components/QuotaHint";
import { parseQuotaError, useQuota } from "@/components/useQuota";
import { quotaRechargeText } from "@/lib/billing/copy";
import { EpisodeVideoPlayer } from "@/components/EpisodeVideoPlayer";
import { FilmCaptionEditor } from "@/components/FilmCaptionEditor";
import type {
  VideoCatalogItem,
  VideoEpisodeStatus,
  VideoPublishJob,
} from "@/lib/types";
import { hookStyleLabel } from "@/lib/ai/video-script-styles";
import { VIDEO_PUBLISH_PLATFORMS } from "@/lib/video-publish-platforms";
import { PLATFORM_ICONS } from "@/lib/platform-icons";
import { JobBadge } from "@/components/StatusBadge";
import { JobErrorText } from "@/components/JobErrorText";
import { jobStatusFromExtensionResult } from "@/lib/job-status";
import {
  publishDouyinVideoViaExtension,
  subscribeDianwuGeoSyncResults,
  waitForDianwuGeoExtension,
} from "@/lib/dianwu-geo";
import { useInfiniteList } from "@/components/useInfiniteList";

async function fetchVideoCatalogPage(offset: number, limit: number) {
  const res = await fetch(
    `/api/video-scripts?limit=${limit}&offset=${offset}`,
    { cache: "no-store" },
  );
  const data = (await res.json()) as {
    items?: VideoCatalogItem[];
    nextOffset?: number | null;
    hasMore?: boolean;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || "加载失败");
  return {
    items: data.items ?? [],
    nextOffset: data.nextOffset ?? null,
    hasMore: Boolean(data.hasMore),
  };
}

function genreLabel(item: Pick<VideoCatalogItem, "genre" | "hook_style">): string {
  return hookStyleLabel(item.hook_style || item.genre);
}

function videoStatusLabel(status: VideoEpisodeStatus): string {
  if (status === "ready") return "已出片";
  if (status === "generating") return "出片中";
  if (status === "failed") return "出片失败";
  return "未出片";
}

function scriptHref(articleId: string, episodeId?: string): string {
  return episodeId
    ? `/scripts/${articleId}#ep-${episodeId}`
    : `/scripts/${articleId}`;
}

function videoPublishWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", { hour12: false });
}

function hashEpisodeId(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash.replace(/^#/, "");
  return raw.startsWith("ep-") ? raw.slice(3) : null;
}

export function ScriptCatalog() {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const { snap, refresh, can } = useQuota();
  const articleQuota = snap("articles");
  const noArticleQuota = !can("articles");

  const { items, booting, sentinel } =
    useInfiniteList<VideoCatalogItem>(fetchVideoCatalogPage);

  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        article_id: string;
        article_title: string;
        series_title: string;
        genre: VideoCatalogItem["genre"];
        hook_style?: string;
        episodes: VideoCatalogItem[];
      }
    >();
    for (const item of items) {
      const cur = map.get(item.article_id);
      if (cur) {
        cur.episodes.push(item);
      } else {
        map.set(item.article_id, {
          article_id: item.article_id,
          article_title: item.article_title,
          series_title: item.series_title,
          genre: item.genre,
          hook_style: item.hook_style,
          episodes: [item],
        });
      }
    }
    return [...map.values()].map((g) => ({
      ...g,
      episodes: [...g.episodes].sort((a, b) => a.episode_no - b.episode_no),
    }));
  }, [items]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">剧本</h1>
          <p className="mt-1 text-[var(--muted)]">
            可以新建空本，也可以导入别人的本改写。点「改剧本」直接改。
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link href="/characters" className="btn btn-ghost">
            角色
          </Link>
          <Link href="/voices" className="btn btn-ghost">
            音色
          </Link>
          <Link href="/podcasts" className="btn btn-ghost">
            播客
          </Link>
          <Link href="/videos" className="btn btn-ghost">
            视频
          </Link>
          <Link href="/articles" className="btn btn-ghost">
            从文章拆
          </Link>
          <QuotaHint snap={articleQuota} need={1} />
          <button
            type="button"
            className="btn btn-primary"
            disabled={noArticleQuota}
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
          >
            添加剧本
          </button>
        </div>
      </div>

      {booting ? (
        <div className="card p-8 text-[var(--muted)]">加载中…</div>
      ) : groups.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg">还没有剧本</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            添加一本，或把别人的对本贴进来改写。也可以从文章拆。
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={noArticleQuota}
              onClick={() => setCreateOpen(true)}
            >
              添加剧本
            </button>
            <Link href="/articles" className="btn btn-ghost">
              去文章
            </Link>
            <QuotaHint snap={articleQuota} need={1} />
          </div>
        </div>
      ) : (
        <>
        <ul className="space-y-4">
          {groups.map((group) => (
            <li key={group.article_id} className="card space-y-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link
                    href={scriptHref(group.article_id)}
                    className="text-lg font-medium hover:underline"
                  >
                    {group.article_title || "未命名文章"}
                  </Link>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    剧本「{group.series_title}」· {genreLabel(group)} ·{" "}
                    {group.episodes.length} 集
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/articles/${group.article_id}`}
                    className="btn btn-ghost text-xs"
                  >
                    看文章
                  </Link>
                  <Link
                    href={scriptHref(group.article_id)}
                    className="btn btn-ghost text-xs"
                  >
                    改剧本
                  </Link>
                </div>
              </div>
              <ul className="space-y-2">
                {group.episodes.map((ep) => (
                  <li
                    key={ep.episode_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
                  >
                    <Link
                      href={scriptHref(group.article_id, ep.episode_id)}
                      className="hover:underline"
                    >
                      第 {ep.episode_no} 集 · {ep.episode_title || "未命名"}
                    </Link>
                    <span className="text-xs text-[var(--muted)]">
                      {ep.confirmed ? "已确认" : "待确认"}
                      {" · "}
                      {videoStatusLabel(ep.video_status)}
                      {ep.video_url ? (
                        <>
                          {" · "}
                          <Link
                            href={`/videos#ep-${ep.episode_id}`}
                            className="underline"
                          >
                            看视频
                          </Link>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
          {sentinel}
        </>
      )}
      {createError ? (
        <QuotaMessage text={createError} className="text-sm text-[var(--danger)]" />
      ) : null}
      <ScriptSourceDialog
        open={createOpen}
        mode="create"
        busy={creating}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (input) => {
          if (noArticleQuota) {
            setCreateError(quotaRechargeText("articles"));
            return;
          }
          setCreating(true);
          setCreateError(null);
          try {
            const res = await fetch("/api/articles", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                title: input.title,
                body: input.body,
                script_title: input.title,
              }),
            });
            const data = (await res.json()) as {
              article?: { id?: string };
              error?: string;
              code?: string;
            };
            const quota = parseQuotaError(res, data);
            if (quota) {
              setCreateError(quota);
              void refresh();
              setCreating(false);
              return;
            }
            if (!res.ok || !data.article?.id) {
              throw new Error(data.error || "创建失败");
            }
            void refresh();
            const qs = new URLSearchParams();
            if (input.rewrite && input.body.trim()) {
              qs.set("rewrite", "1");
              qs.set("count", String(input.episodeCount));
              if (input.hasSequel) qs.set("sequel", "1");
            }
            router.push(
              qs.size
                ? `/scripts/${data.article.id}?${qs}`
                : `/scripts/${data.article.id}`,
            );
          } catch (err) {
            setCreateError(err instanceof Error ? err.message : "创建失败");
            setCreating(false);
          }
        }}
      />
    </div>
  );
}

export function VideoCatalog() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editEpisodeId, setEditEpisodeId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState("");
  const [publishJobs, setPublishJobs] = useState<VideoPublishJob[]>([]);
  const awaitingJobIdRef = useRef<string>("");
  const pickedRef = useRef(false);
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

  const {
    items,
    setItems,
    booting,
    sentinel,
  } = useInfiniteList<VideoCatalogItem>(fetchVideoCatalogPage);

  useEffect(() => {
    if (pickedRef.current || booting || !items.length) return;
    const wanted = hashEpisodeId();
    const playable = items.filter((item) => item.video_url);
    const pick =
      playable.find((item) => item.episode_id === wanted) || playable[0];
    if (pick) {
      setActiveId(pick.episode_id);
      pickedRef.current = true;
    }
  }, [booting, items]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/videos/publish", {
        method: "GET",
        cache: "no-store",
      });
      const data = (await res.json()) as { jobs?: VideoPublishJob[] };
      if (!cancelled && res.ok) setPublishJobs(data.jobs ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const publishBusy = publishJobs.some(
    (job) =>
      job.status === "running" ||
      job.status === "pending" ||
      job.status === "filled_awaiting_publish",
  );

  useEffect(() => {
    if (!publishBusy) return;
    const t = setInterval(() => {
      void fetch("/api/videos/publish", { method: "GET", cache: "no-store" })
        .then((res) => res.json())
        .then((data: { jobs?: VideoPublishJob[] }) => {
          if (data.jobs) setPublishJobs(data.jobs);
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(t);
  }, [publishBusy]);

  useEffect(() => {
    return subscribeDianwuGeoSyncResults((result) => {
      if (String(result.platform || "").toLowerCase() !== "douyin_video") return;
      const jobId = awaitingJobIdRef.current;
      if (!jobId) return;
      const status = jobStatusFromExtensionResult(result);
      if (status !== "published" && status !== "draft_ok") return;
      void fetch("/api/videos/publish", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          status,
          error: null,
          resultUrl: result.postUrl || result.url || null,
        }),
      })
        .then((res) => res.json())
        .then((data: { jobs?: VideoPublishJob[] }) => {
          if (data.jobs) setPublishJobs(data.jobs);
        })
        .catch(() => undefined);
    });
  }, []);

  const videos = items.filter((item) => item.video_url);
  const pending = items.filter((item) => !item.video_url);
  const active = videos.find((item) => item.episode_id === activeId) || videos[0];

  const groups = useMemo(() => {
    const map = new Map<string, VideoCatalogItem[]>();
    for (const item of videos) {
      const cur = map.get(item.article_id) || [];
      cur.push(item);
      map.set(item.article_id, cur);
    }
    return [...map.entries()].map(([article_id, episodes]) => ({
      article_id,
      article_title: episodes[0].article_title,
      series_title: episodes[0].series_title,
      genre: episodes[0].genre,
      hook_style: episodes[0].hook_style,
      episodes: [...episodes].sort((a, b) => a.episode_no - b.episode_no),
    }));
  }, [videos]);

  function selectEpisode(id: string) {
    setActiveId(id);
    setPickerOpen(false);
    setEditEpisodeId(null);
    setPublishMsg("");
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#ep-${id}`);
    }
  }

  async function patchVideoJob(
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
    const res = await fetch("/api/videos/publish", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        status,
        error: result.success === false ? result.error || result.message : null,
        resultUrl: result.postUrl || result.url || null,
      }),
    });
    const data = (await res.json()) as { jobs?: VideoPublishJob[]; error?: string };
    if (!res.ok) throw new Error(data.error || "更新发布记录失败");
    if (data.jobs) setPublishJobs(data.jobs);
  }

  async function publishVideo(platform: (typeof VIDEO_PUBLISH_PLATFORMS)[number]["id"]) {
    if (!active?.episode_id || !active.video_url) return;
    setPublishing(true);
    setPublishMsg("正在用扩展打开抖音…");
    let jobId = "";
    try {
      const extOk = await waitForDianwuGeoExtension(3_000);
      if (!extOk) {
        throw new Error("抖音视频需要点物扩展，本机不再自动开窗。请加载扩展后再发布");
      }
      const res = await fetch("/api/videos/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeId: active.episode_id,
          platform,
        }),
      });
      const data = (await res.json()) as {
        jobId?: string;
        videoUrl?: string;
        title?: string;
        description?: string;
        message?: string;
        error?: string;
        jobs?: VideoPublishJob[];
      };
      if (!res.ok) throw new Error(data.error || "发布失败");
      if (data.jobs) setPublishJobs(data.jobs);
      jobId = data.jobId || "";
      awaitingJobIdRef.current = jobId;
      if (!jobId || !data.videoUrl) throw new Error("发布任务没有准备好");
      setPublishMsg(data.message || "正在把成片传到抖音…");
      setPickerOpen(false);
      const out = await publishDouyinVideoViaExtension({
        videoUrl: data.videoUrl,
        title: data.title || active.episode_title || "成片",
        description: data.description || "",
      });
      await patchVideoJob(jobId, out);
      setPublishMsg(
        out.message ||
          (out.success
            ? "成片已传到抖音，请在打开的标签里点发布"
            : out.error || "发布失败"),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "发布失败";
      if (jobId) {
        await patchVideoJob(jobId, { success: false, error: message }).catch(
          () => undefined,
        );
      }
      setPublishMsg(message);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">视频</h1>
          <p className="mt-1 text-[var(--muted)]">
            在这里直接看已出的片。重出时上一版还能播。
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/podcasts" className="btn btn-ghost">
            播客
          </Link>
          <Link href="/scripts" className="btn btn-ghost">
            剧本
          </Link>
          <Link href="/characters" className="btn btn-ghost">
            角色
          </Link>
          <Link href="/articles" className="btn btn-primary">
            从文章出片
          </Link>
        </div>
      </div>

      {booting ? (
        <div className="card p-8 text-[var(--muted)]">加载中…</div>
      ) : videos.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg">还没有成片</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {pending.length
              ? `已有 ${pending.length} 集剧本待出片。先确认剧本，再按集生成视频。`
              : "先从文章拆出剧本，确认后再生成视频。"}
          </p>
          <Link
            href={pending.length ? "/scripts" : "/articles"}
            className="btn btn-primary mt-6"
          >
            {pending.length ? "去剧本" : "去文章"}
          </Link>
        </div>
      ) : (
        <>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
          <div className="card p-4">
            {active?.video_url ? (
              <EpisodeVideoPlayer
                src={active.video_url}
                title={`第 ${active.episode_no} 集 · ${active.episode_title || "未命名"}`}
                regenerating={active.video_status === "generating"}
              />
            ) : null}
            {active && (
              <div className="mt-3 space-y-2 text-sm">
                <p className="text-[var(--muted)]">
                  剧本「{active.series_title}」· {genreLabel(active)}
                </p>
                <div className="relative flex flex-wrap items-center gap-2">
                  <Link
                    href={scriptHref(active.article_id)}
                    className="btn btn-ghost text-xs"
                  >
                    回剧本重出
                  </Link>
                  <Link
                    href={`/articles/${active.article_id}`}
                    className="btn btn-ghost text-xs"
                  >
                    看文章
                  </Link>
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    disabled={!active.video_url}
                    onClick={() => {
                      setPickerOpen(false);
                      setEditEpisodeId(active.episode_id);
                    }}
                  >
                    编辑
                  </button>
                  <div className="relative" ref={pickerRef}>
                    <button
                      type="button"
                      className="btn btn-primary text-xs"
                      disabled={publishing || !active.video_url}
                      onClick={() => setPickerOpen((open) => !open)}
                    >
                      {publishing ? "发布中…" : "发布"}
                    </button>
                    {pickerOpen ? (
                      <div className="absolute right-0 top-full z-10 mt-1 min-w-44 rounded-lg border border-[var(--line)] bg-white p-2 shadow-md">
                        {VIDEO_PUBLISH_PLATFORMS.map((row) => {
                          const icon = PLATFORM_ICONS[row.id];
                          return (
                            <button
                              key={row.id}
                              type="button"
                              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed"
                              disabled={publishing}
                              onClick={() => void publishVideo(row.id)}
                            >
                              {icon?.icon ? (
                                <img
                                  src={icon.icon}
                                  alt=""
                                  width={14}
                                  height={14}
                                  className="h-3.5 w-3.5"
                                />
                              ) : null}
                              <span>{row.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
                {publishMsg ? (
                  <p
                    className={`text-xs ${
                      /失败|找不到|先等|没有/.test(publishMsg)
                        ? "text-[var(--danger)]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    {publishMsg}
                  </p>
                ) : null}
                {editEpisodeId ? (
                  <FilmCaptionEditor
                    articleId={active.article_id}
                    episodeId={editEpisodeId}
                    seriesTitle={active.series_title || ""}
                    onClose={() => setEditEpisodeId(null)}
                    onApplied={(videoUrl) => {
                      setItems((rows) =>
                        (rows || []).map((row) =>
                          row.episode_id === editEpisodeId
                            ? { ...row, video_url: videoUrl }
                            : row,
                        ),
                      );
                    }}
                  />
                ) : null}
              </div>
            )}
          </div>
          <ul className="space-y-4">
            {groups.map((group) => (
              <li key={group.article_id} className="card space-y-2 p-4">
                <div className="text-sm font-medium">
                  {group.article_title || "未命名文章"}
                </div>
                <p className="text-xs text-[var(--muted)]">
                  剧本「{group.series_title}」· {genreLabel(group)}
                </p>
                <ul className="space-y-1">
                  {group.episodes.map((ep) => {
                    const selected = ep.episode_id === active?.episode_id;
                    return (
                      <li key={ep.episode_id}>
                        <button
                          type="button"
                          className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm ${
                            selected
                              ? "bg-[var(--accent-soft)]"
                              : "hover:bg-white"
                          }`}
                          onClick={() => selectEpisode(ep.episode_id)}
                        >
                          <span>
                            第 {ep.episode_no} 集 · {ep.episode_title || "未命名"}
                          </span>
                          <span className="text-xs text-[var(--muted)]">
                            {ep.video_status === "generating"
                              ? "上一版可看 · 重出中"
                              : "播放"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
          {sentinel}
        </>
      )}

      <div className="card p-5">
        <h2 className="text-lg font-medium">发布记录</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          发到抖音的成片会记在这里。扩展传到创作页后点发布，关掉标签后这里会更新。
        </p>
        {publishJobs.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">还没有发过视频。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {publishJobs.map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[#fffdf9] px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {job.status === "running" ? (
                    <span className="badge badge-run">发布中</span>
                  ) : (
                    <JobBadge status={job.status} />
                  )}
                  <span>抖音</span>
                  <span className="text-sm">
                    {job.series_title ? `「${job.series_title}」` : ""}
                    {job.episode_no
                      ? ` 第 ${job.episode_no} 集`
                      : ""}
                    {job.episode_title ? ` · ${job.episode_title}` : ""}
                  </span>
                </div>
                <div className="max-w-md text-right text-sm text-[var(--muted)]">
                  <div>{videoPublishWhen(job.created_at)}</div>
                  {job.error ? (
                    <div className="mt-0.5">
                      <JobErrorText error={job.error} platform="douyin" />
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
