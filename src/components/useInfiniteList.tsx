"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_LIST_LIMIT } from "@/lib/list-page";
import { InfiniteScrollSentinel } from "@/components/InfiniteScrollSentinel";

export type PagePayload<T> = {
  items: T[];
  nextOffset: number | null;
  hasMore: boolean;
};

/**
 * 通用分页列表：首屏 limit 条，滚到底追加。
 * fetchPage(offset, limit) → { items, nextOffset, hasMore }
 */
export function useInfiniteList<T>(
  fetchPage: (offset: number, limit: number) => Promise<PagePayload<T>>,
  options?: {
    limit?: number;
    enabled?: boolean;
    scrollRootRef?: { current: HTMLElement | null };
  },
) {
  const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
  const enabled = options?.enabled !== false;
  const [items, setItems] = useState<T[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const loadingRef = useRef(false);

  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      if (!enabled) return;
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const page = await fetchRef.current(offset, limit);
        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setNextOffset(page.hasMore ? page.nextOffset : null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载失败");
        if (!append) {
          setItems([]);
          setNextOffset(null);
        }
      } finally {
        loadingRef.current = false;
        setLoading(false);
        setBooting(false);
      }
    },
    [enabled, limit],
  );

  const reload = useCallback(() => loadPage(0, false), [loadPage]);

  const loadMore = useCallback(() => {
    if (nextOffset == null) return;
    return loadPage(nextOffset, true);
  }, [loadPage, nextOffset]);

  /** 刷新已加载区间（轮询用）：按当前条数从 offset 0 重拉 */
  const refreshLoaded = useCallback(async () => {
    if (!enabled || loadingRef.current) return;
    const take = Math.max(items.length, limit);
    loadingRef.current = true;
    try {
      const page = await fetchRef.current(0, take);
      setItems(page.items);
      setNextOffset(page.hasMore ? page.nextOffset : null);
    } catch {
      // 轮询失败忽略
    } finally {
      loadingRef.current = false;
    }
  }, [enabled, items.length, limit]);

  useEffect(() => {
    if (!enabled) {
      setBooting(false);
      return;
    }
    void loadPage(0, false);
  }, [enabled, loadPage]);

  const hasMore = nextOffset != null;
  const sentinel: ReactNode = (
    <InfiniteScrollSentinel
      hasMore={hasMore}
      loading={loading && !booting}
      onLoadMore={() => void loadMore()}
      rootRef={options?.scrollRootRef}
    />
  );

  return {
    items,
    setItems,
    loading,
    booting,
    error,
    hasMore,
    loadMore,
    reload,
    refreshLoaded,
    sentinel,
  };
}
