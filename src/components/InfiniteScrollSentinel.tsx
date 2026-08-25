"use client";

import { useEffect, useRef } from "react";

/** 滚到底部附近时触发 onLoadMore（无限滚动哨兵） */
export function InfiniteScrollSentinel({
  hasMore,
  loading,
  onLoadMore,
  label = "加载更多…",
  rootRef,
}: {
  hasMore: boolean;
  loading?: boolean;
  onLoadMore: () => void;
  label?: string;
  rootRef?: { current: HTMLElement | null };
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting);
        if (!hit || busyRef.current || loading) return;
        busyRef.current = true;
        Promise.resolve(onLoadMore()).finally(() => {
          busyRef.current = false;
        });
      },
      {
        root: rootRef?.current ?? null,
        rootMargin: rootRef?.current ? "80px 0px" : "240px 0px",
        threshold: 0,
      },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasMore, loading, onLoadMore, rootRef]);

  if (!hasMore && !loading) return null;

  return (
    <div
      ref={ref}
      className="list-scroll-sentinel"
      aria-hidden={!hasMore && !loading}
    >
      {loading || hasMore ? label : null}
    </div>
  );
}
