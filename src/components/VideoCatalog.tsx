"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EpisodeVideoPlayer } from "@/components/EpisodeVideoPlayer";
import type { VideoCatalogItem, VideoEpisodeStatus } from "@/lib/types";
import { hookStyleLabel } from "@/lib/ai/video-script-styles";

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

function hashEpisodeId(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash.replace(/^#/, "");
  return raw.startsWith("ep-") ? raw.slice(3) : null;
}

export function ScriptCatalog() {
  const [items, setItems] = useState<VideoCatalogItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/video-scripts", { cache: "no-store" });
      const data = (await res.json()) as { items?: VideoCatalogItem[] };
      if (!cancelled) setItems(data.items ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        article_id: string;
        article_title: string;
        series_title: string;
        genre: string;
        hook_style?: string;
        episodes: VideoCatalogItem[];
      }
    >();
    for (const item of items || []) {
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
            每集剧本都挂在一篇文章上。点「改剧本」直接改，不用先开文章。
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/characters" className="btn btn-ghost">
            角色
          </Link>
          <Link href="/videos" className="btn btn-ghost">
            视频
          </Link>
          <Link href="/articles" className="btn btn-primary">
            从文章拆剧本
          </Link>
        </div>
      </div>

      {items === null ? (
        <div className="card p-8 text-[var(--muted)]">加载中…</div>
      ) : groups.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg">还没有剧本</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            打开一篇文章，在正文下面拆短视频剧本。剧本会挂在这篇文章上。
          </p>
          <Link href="/articles" className="btn btn-primary mt-6">
            去文章
          </Link>
        </div>
      ) : (
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
      )}
    </div>
  );
}

export function VideoCatalog() {
  const [items, setItems] = useState<VideoCatalogItem[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/video-scripts", { cache: "no-store" });
      const data = (await res.json()) as { items?: VideoCatalogItem[] };
      if (cancelled) return;
      const list = data.items ?? [];
      setItems(list);
      const wanted = hashEpisodeId();
      const playable = list.filter((item) => item.video_url);
      const pick =
        playable.find((item) => item.episode_id === wanted) || playable[0];
      if (pick) setActiveId(pick.episode_id);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const videos = (items || []).filter((item) => item.video_url);
  const pending = (items || []).filter((item) => !item.video_url);
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
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#ep-${id}`);
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

      {items === null ? (
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
                <div className="flex flex-wrap gap-2">
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
                </div>
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
                          className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm ${
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
      )}
    </div>
  );
}
