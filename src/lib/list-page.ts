/** 列表分页：默认 20，滚动加载更多 */

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 50;

export type ListPageQuery = {
  limit: number;
  offset: number;
};

export function parseListPage(url: URL): ListPageQuery {
  const rawLimit = Number(url.searchParams.get("limit"));
  const rawOffset = Number(url.searchParams.get("offset"));
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_LIST_LIMIT;
  const offset = Number.isFinite(rawOffset)
    ? Math.max(0, Math.floor(rawOffset))
    : 0;
  return { limit, offset };
}

/** 多取 1 条判断是否还有下一页 */
export function slicePage<T>(
  rows: T[],
  limit: number,
  offset: number,
): { items: T[]; nextOffset: number | null; hasMore: boolean } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextOffset: hasMore ? offset + limit : null,
    hasMore,
  };
}
