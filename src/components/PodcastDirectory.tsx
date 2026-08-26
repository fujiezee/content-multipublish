"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PodcastListen } from "@/components/PodcastListen";
import { useInfiniteList } from "@/components/useInfiniteList";
import type { PublicPodcast } from "@/lib/ai/podcast-shared";
import { rewritePublicMediaUrl } from "@/lib/content/media-urls";
import { DEFAULT_TTS_SPEECH_MODEL } from "@/lib/ai/tts-voice-ids";
import type { PodcastCatalogItem } from "@/lib/types";

async function fetchPodcastCatalogPage(offset: number, limit: number) {
  const res = await fetch(`/api/podcasts?limit=${limit}&offset=${offset}`, {
    cache: "no-store",
  });
  const data = (await res.json()) as {
    items?: PodcastCatalogItem[];
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

function formatClock(sec: number) {
  const n = Math.max(0, Math.round(sec));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function toPublic(item: PodcastCatalogItem): PublicPodcast {
  return {
    id: item.article_id,
    articleId: item.article_id,
    title: item.podcast_title,
    mode: item.mode,
    hostVoice: "",
    guestVoice: "",
    ttsModel: DEFAULT_TTS_SPEECH_MODEL,
    status: "ready",
    error: null,
    audioUrl: item.audio_url,
    coverUrl: rewritePublicMediaUrl(String(item.cover_url || "").trim()) || null,
    durationSec: item.duration_sec,
    turns: item.turns || [],
    createdAt: item.updated_at,
    updatedAt: item.updated_at,
  };
}

export function PodcastDirectory() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const articleFromUrl = searchParams.get("article")?.trim() || "";
  const [activeId, setActiveId] = useState(articleFromUrl);

  const { items, booting, sentinel } =
    useInfiniteList<PodcastCatalogItem>(fetchPodcastCatalogPage);

  useEffect(() => {
    if (articleFromUrl) {
      setActiveId(articleFromUrl);
      return;
    }
    if (!activeId && items[0]) setActiveId(items[0].article_id);
  }, [articleFromUrl, items, activeId]);

  const active = items.find((row) => row.article_id === activeId) || null;
  const activeMissing =
    Boolean(activeId) && !booting && items.length > 0 && !active;

  function selectItem(articleId: string) {
    setActiveId(articleId);
    router.replace(`/podcasts?article=${encodeURIComponent(articleId)}`, {
      scroll: false,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">播客</h1>
          <p className="mt-1 text-[var(--muted)]">
            听已经生成的文章对谈。写对谈、换音色在文章页。成片可发到小宇宙。
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/articles" className="btn btn-ghost">
            文章
          </Link>
          <Link href="/music" className="btn btn-ghost">
            音乐
          </Link>
          <Link href="/articles" className="btn btn-primary">
            从文章出
          </Link>
        </div>
      </div>

      {booting ? (
        <p className="text-sm text-[var(--muted)]">加载中…</p>
      ) : !items.length ? (
        <div className="card space-y-3 p-5">
          <p className="text-lg">还没有播客</p>
          <p className="text-sm text-[var(--muted)]">
            打开一篇文章，在正文下面点「生成播客」，出好后会出现在这里。
          </p>
          <Link href="/articles" className="btn btn-primary w-fit">
            去文章出播客
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <div className="card space-y-2 p-3">
            <p className="px-2 pt-1 text-xs text-[var(--muted)]">已出的对谈</p>
            <ul className="space-y-1">
              {items.map((row) => {
                const selected = row.article_id === activeId;
                const cover =
                  rewritePublicMediaUrl(String(row.cover_url || "").trim()) ||
                  "";
                return (
                  <li key={row.article_id}>
                    <button
                      type="button"
                      className={`music-dir__item podcast-dir__item${selected ? " is-on" : ""}`}
                      onClick={() => selectItem(row.article_id)}
                    >
                      {cover ? (
                        <img
                          className="podcast-dir__thumb"
                          src={cover}
                          alt=""
                        />
                      ) : (
                        <span className="podcast-dir__thumb is-empty" />
                      )}
                      <span>
                        <span className="music-dir__name">
                          {row.podcast_title || row.article_title}
                        </span>
                        <span className="music-dir__meta">
                          {row.mode === "solo" ? "口播" : "问答"}
                          {" · "}
                          {row.turn_count} 轮
                          {row.duration_sec
                            ? ` · ${formatClock(row.duration_sec)}`
                            : ""}
                        </span>
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
                      {active.article_title || active.podcast_title}
                    </p>
                    <p className="text-sm text-[var(--muted)]">
                      {active.mode === "solo" ? "口播" : "问答"}
                      {" · "}
                      {active.turn_count} 轮
                      {active.duration_sec
                        ? ` · ${formatClock(active.duration_sec)}`
                        : ""}
                    </p>
                  </div>
                  <Link
                    href={`/articles/${active.article_id}#podcast`}
                    className="btn btn-ghost text-xs"
                  >
                    去文章改
                  </Link>
                </div>
                <div className="card podcast-dir__stage">
                  <PodcastListen podcast={toPublic(active)} />
                </div>
              </>
            ) : activeMissing ? (
              <div className="card space-y-3 p-5">
                <p className="text-sm text-[var(--muted)]">
                  这篇文章还没有可听的对谈。
                </p>
                <Link
                  href={`/articles/${activeId}#podcast`}
                  className="btn btn-primary w-fit"
                >
                  去文章出播客
                </Link>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">选左边一条听</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
