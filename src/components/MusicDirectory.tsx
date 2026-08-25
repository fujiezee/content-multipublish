"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MusicListenPanel } from "@/components/MusicListenPanel";
import { useInfiniteList } from "@/components/useInfiniteList";
import { hookStyleLabel } from "@/lib/ai/video-script-styles";
import type { MusicCatalogItem } from "@/lib/types";

async function fetchMusicCatalogPage(offset: number, limit: number) {
  const res = await fetch(`/api/music?limit=${limit}&offset=${offset}`, {
    cache: "no-store",
  });
  const data = (await res.json()) as {
    items?: MusicCatalogItem[];
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

export function MusicDirectory() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const articleFromUrl = searchParams.get("article")?.trim() || "";
  const [activeId, setActiveId] = useState(articleFromUrl);

  const { items, booting, sentinel } =
    useInfiniteList<MusicCatalogItem>(fetchMusicCatalogPage);

  useEffect(() => {
    if (articleFromUrl) {
      setActiveId(articleFromUrl);
      return;
    }
    if (!activeId && items[0]) setActiveId(items[0].article_id);
  }, [articleFromUrl, items, activeId]);

  const active = items.find((g) => g.article_id === activeId) || null;
  const activeMissing =
    Boolean(activeId) && !booting && items.length > 0 && !active;

  function selectSeries(articleId: string) {
    setActiveId(articleId);
    router.replace(`/music?article=${encodeURIComponent(articleId)}`, {
      scroll: false,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">音乐</h1>
          <p className="mt-1 text-[var(--muted)]">
            在这里听已经生成的歌。写词和出歌在剧本页。
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/podcasts" className="btn btn-ghost">
            播客
          </Link>
          <Link href="/scripts" className="btn btn-ghost">
            剧本
          </Link>
          <Link href="/videos" className="btn btn-ghost">
            视频
          </Link>
        </div>
      </div>

      {booting ? (
        <p className="text-sm text-[var(--muted)]">加载中…</p>
      ) : !items.length ? (
        <div className="card space-y-3 p-5">
          <p className="text-lg">还没有歌</p>
          <p className="text-sm text-[var(--muted)]">
            先去剧本页写词出歌，出好后会出现在这里。
          </p>
          <Link href="/scripts" className="btn btn-primary w-fit">
            去剧本出歌
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <div className="card space-y-2 p-3">
            <p className="px-2 pt-1 text-xs text-[var(--muted)]">已出歌的剧</p>
            <ul className="space-y-1">
              {items.map((group) => {
                const selected = group.article_id === activeId;
                return (
                  <li key={group.article_id}>
                    <button
                      type="button"
                      className={`music-dir__item${selected ? " is-on" : ""}`}
                      onClick={() => selectSeries(group.article_id)}
                    >
                      <span className="music-dir__name">
                        {group.series_title || group.article_title}
                      </span>
                      <span className="music-dir__meta">
                        {hookStyleLabel(group.hook_style || group.genre)}
                        {" · "}
                        {group.track_count} 首
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {sentinel}
          </div>

          <div className="space-y-3">
            {active ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-lg font-medium">
                      {active.series_title || active.article_title}
                    </p>
                    <p className="text-sm text-[var(--muted)]">
                      {hookStyleLabel(active.hook_style || active.genre)}
                      {" · "}
                      {active.track_count} 首
                    </p>
                  </div>
                  <Link
                    href={`/scripts/${active.article_id}`}
                    className="btn btn-ghost text-xs"
                  >
                    改剧本
                  </Link>
                </div>
                <MusicListenPanel
                  articleId={active.article_id}
                  seriesTitle={active.series_title || active.article_title}
                />
              </>
            ) : activeMissing ? (
              <div className="card space-y-3 p-5">
                <p className="text-sm text-[var(--muted)]">
                  这部剧还没有可听的歌。
                </p>
                <Link
                  href={`/scripts/${activeId}`}
                  className="btn btn-primary w-fit"
                >
                  去剧本出歌
                </Link>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">选左边一部剧听歌</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
