"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { GeoKeyword, GeoKeywordArticleWithTitle, GeoKeywordMine } from "@/lib/types";
import { GEO_KEYWORD_INTENTS } from "@/lib/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { useInfiniteList } from "@/components/useInfiniteList";

type MineWithCount = GeoKeywordMine & { keyword_count?: number };

type MineDetail = {
  seed: string;
  context: string;
  keywords: GeoKeyword[];
  keywordArticles: GeoKeywordArticleWithTitle[];
};

function intentLabel(id: string) {
  return GEO_KEYWORD_INTENTS.find((i) => i.id === id)?.label ?? id;
}

export function GeoKeywordPanel() {
  const confirm = useConfirm();
  const router = useRouter();
  const [activeMineId, setActiveMineId] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<GeoKeyword[]>([]);
  const [keywordArticles, setKeywordArticles] = useState<GeoKeywordArticleWithTitle[]>([]);
  const [seed, setSeed] = useState("");
  const [context, setContext] = useState("");
  const [count, setCount] = useState(40);
  const [mining, setMining] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const detailCache = useRef(new Map<string, MineDetail>());
  const detailInflight = useRef(new Map<string, Promise<MineDetail | null>>());
  const selectedIdRef = useRef<string | null>(null);
  const [composingNew, setComposingNew] = useState(false);

  const [mineScrollEl, setMineScrollEl] = useState<HTMLDivElement | null>(null);
  const mineScrollRef = useMemo(
    () => ({ current: mineScrollEl }),
    [mineScrollEl],
  );

  const fetchMines = useCallback(async (offset: number, limit: number) => {
    const res = await fetch(
      `/api/geo/mines?limit=${limit}&offset=${offset}`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error("加载失败");
    const data = await res.json();
    return {
      items: (data.mines as MineWithCount[]) ?? [],
      nextOffset: data.nextOffset ?? null,
      hasMore: Boolean(data.hasMore),
    };
  }, []);

  const {
    items: mines,
    setItems: setMines,
    booting,
    reload: loadMines,
    sentinel,
  } = useInfiniteList<MineWithCount>(fetchMines, {
    scrollRootRef: mineScrollRef,
  });

  const articlesByKeyword = useMemo(() => {
    const map = new Map<string, GeoKeywordArticleWithTitle[]>();
    for (const row of keywordArticles) {
      const list = map.get(row.keyword_id) ?? [];
      list.push(row);
      map.set(row.keyword_id, list);
    }
    return map;
  }, [keywordArticles]);

  const applyDetail = useCallback((mineId: string, detail: MineDetail) => {
    setActiveMineId(mineId);
    setSeed(detail.seed);
    setContext(detail.context);
    setKeywords(detail.keywords);
    setKeywordArticles(detail.keywordArticles);
  }, []);

  const fetchMineDetail = useCallback(async (mineId: string) => {
    const pending = detailInflight.current.get(mineId);
    if (pending) return pending;
    const job = (async () => {
      try {
        const res = await fetch(`/api/geo/mines/${mineId}`, { cache: "no-store" });
        if (!res.ok) return null;
        const data = await res.json();
        const detail: MineDetail = {
          seed: data.mine?.seed ?? "",
          context: data.mine?.context ?? "",
          keywords: data.keywords ?? [],
          keywordArticles: data.keywordArticles ?? [],
        };
        detailCache.current.set(mineId, detail);
        return detail;
      } catch {
        return null;
      } finally {
        detailInflight.current.delete(mineId);
      }
    })();
    detailInflight.current.set(mineId, job);
    return job;
  }, []);

  const selectMine = useCallback(
    async (mine: Pick<MineWithCount, "id" | "seed" | "context">) => {
      setComposingNew(false);
      selectedIdRef.current = mine.id;
      const cached = detailCache.current.get(mine.id);
      if (cached) {
        applyDetail(mine.id, cached);
        setDetailLoading(false);
        return;
      }
      setActiveMineId(mine.id);
      setSeed(mine.seed);
      setContext(mine.context ?? "");
      setKeywords([]);
      setKeywordArticles([]);
      setDetailLoading(true);
      const detail = await fetchMineDetail(mine.id);
      if (selectedIdRef.current !== mine.id) return;
      if (detail) applyDetail(mine.id, detail);
      setDetailLoading(false);
    },
    [applyDetail, fetchMineDetail],
  );

  const prefetchMine = useCallback(
    (mineId: string) => {
      if (detailCache.current.has(mineId) || detailInflight.current.has(mineId)) {
        return;
      }
      void fetchMineDetail(mineId);
    },
    [fetchMineDetail],
  );

  useEffect(() => {
    if (composingNew || activeMineId || !mines[0]) return;
    void selectMine(mines[0]);
  }, [mines, activeMineId, composingNew, selectMine]);

  function startNewMine() {
    selectedIdRef.current = null;
    setComposingNew(true);
    setActiveMineId(null);
    setSeed("");
    setContext("");
    setKeywords([]);
    setKeywordArticles([]);
    setMessage(null);
    setFilter("");
    setDetailLoading(false);
  }

  function upsertMineInList(mine: MineWithCount) {
    setMines((prev) => [mine, ...prev.filter((item) => item.id !== mine.id)]);
  }

  useEffect(() => {
    if (booting || mines.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const mine of mines.slice(0, 12)) prefetchMine(mine.id);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [booting, mines, prefetchMine]);

  async function runMine(append: boolean) {
    if (!seed.trim()) {
      setMessage("请先填写产品或主题");
      return;
    }

    setMining(true);
    setMessage(null);
    try {
      const res = await fetch("/api/geo/mines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seed: seed.trim(),
          context: context.trim(),
          count,
          mineId: append && activeMineId ? activeMineId : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "挖痛点失败");
        return;
      }

      const detail: MineDetail = {
        seed: data.mine?.seed ?? seed.trim(),
        context: data.mine?.context ?? context.trim(),
        keywords: data.keywords ?? [],
        keywordArticles: data.keywordArticles ?? [],
      };
      detailCache.current.set(data.mine.id, detail);
      setComposingNew(false);
      applyDetail(data.mine.id, detail);
      upsertMineInList({
        ...data.mine,
        keyword_count: detail.keywords.length,
      });
      const added = data.added ?? 0;
      const skipped = data.skipped_duplicates ?? 0;
      setMessage(
        `新增 ${added} 条痛点${skipped ? `，去重跳过 ${skipped} 条` : ""}（库内全局不重复）`,
      );
      await loadMines();
      upsertMineInList({
        ...data.mine,
        keyword_count: detail.keywords.length,
      });
    } finally {
      setMining(false);
    }
  }

  async function deleteMine(mineId: string) {
    const ok = await confirm({
      title: "确定删除这组痛点？",
      detail: "这组痛点和关联记录会一起清掉，不影响已经写成的文章。",
      confirmLabel: "删除这组",
      cancelLabel: "先留着",
    });
    if (!ok) return;
    await fetch(`/api/geo/mines/${mineId}`, { method: "DELETE" });
    detailCache.current.delete(mineId);
    detailInflight.current.delete(mineId);
    setMines((prev) => prev.filter((item) => item.id !== mineId));
    if (activeMineId === mineId) {
      startNewMine();
    }
    await loadMines();
    setMines((prev) => prev.filter((item) => item.id !== mineId));
  }

  function goWriteWithAi(keyword: GeoKeyword) {
    const params = new URLSearchParams({
      kind: "article",
      family: "tech",
      geoKeywordId: keyword.id,
      pain: keyword.keyword,
      title: keyword.title,
      brief: `围绕目标用户痛点「${keyword.keyword}」写一篇 GEO 长文。${keyword.angle ? `目标用户与场景：${keyword.angle}` : ""}`,
    });
    if (keyword.angle.trim()) params.set("scene", keyword.angle.trim());
    router.push(`/writing?${params.toString()}`);
  }

  const filtered = useMemo(() => {
    if (!filter.trim()) return keywords;
    const q = filter.trim().toLowerCase();
    return keywords.filter(
      (k) =>
        k.keyword.toLowerCase().includes(q) ||
        k.title.toLowerCase().includes(q) ||
        k.angle.toLowerCase().includes(q),
    );
  }, [keywords, filter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">GEO 挖词</h1>
          <p className="mt-1 text-[var(--muted)]">
            挖的是目标用户的痛点：他们卡在哪、会怎么问。再配能回答痛点的文章标题，可直接 AI 写文
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-ghost text-sm"
            disabled={mining}
            onClick={startNewMine}
          >
            新建一组
          </button>
          <Link href="/writing" className="btn btn-ghost text-sm">
            写手 →
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="card space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-medium">
              {composingNew || !activeMineId ? "新建一组痛点" : "这组痛点"}
            </h2>
            {activeMineId && (
              <button
                type="button"
                className="btn btn-ghost text-sm"
                disabled={mining}
                onClick={startNewMine}
              >
                新建一组
              </button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm text-[var(--muted)]">产品 / 主题 *</span>
              <input
                className="field"
                placeholder="例如：点物、企业品牌营销、AI 客服"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm text-[var(--muted)]">
                目标用户（行业、岗位、日常场景）
              </span>
              <textarea
                className="field min-h-[88px] resize-y"
                placeholder="谁在用、他们日常卡在哪。写得越具体，痛点越准"
                value={context}
                onChange={(e) => setContext(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-[var(--muted)]">每次生成数量</span>
              <select
                className="field"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              >
                <option value={20}>20 条</option>
                <option value={40}>40 条</option>
                <option value={60}>60 条</option>
                <option value={80}>80 条</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={mining}
              onClick={() => void runMine(false)}
            >
              {mining ? "挖掘中…" : activeMineId ? "另挖一组" : "开始挖痛点"}
            </button>
            {activeMineId && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={mining}
                onClick={() => void runMine(true)}
              >
                继续挖这组（去重追加）
              </button>
            )}
          </div>

          {message && (
            <p className="text-sm text-[var(--accent)]">{message}</p>
          )}
        </div>

        <aside className="card geo-mine-topics">
          <div className="geo-mine-topics__head">
            <h2 className="text-sm font-medium text-[var(--muted)]">已挖的主题</h2>
            {(mines.length > 0 || activeMineId) && (
              <button
                type="button"
                className="btn btn-ghost px-2 text-xs"
                disabled={mining}
                onClick={startNewMine}
              >
                新建一组
              </button>
            )}
          </div>
          <div className="geo-mine-topics__scroller" ref={setMineScrollEl}>
            {booting ? (
              <p className="text-sm text-[var(--muted)]">加载中…</p>
            ) : mines.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                还没有一组。填产品/主题后点「开始挖痛点」
              </p>
            ) : (
              <>
                <ul className="space-y-2">
                  {mines.map((mine) => (
                    <li key={mine.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        className={`flex-1 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                          activeMineId === mine.id
                            ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                            : "hover:bg-black/5"
                        }`}
                        onMouseEnter={() => prefetchMine(mine.id)}
                        onFocus={() => prefetchMine(mine.id)}
                        onClick={() => void selectMine(mine)}
                      >
                        <div className="font-medium">{mine.seed}</div>
                        <div className="text-xs text-[var(--muted)]">
                          {mine.keyword_count ?? 0} 条 ·{" "}
                          {new Date(mine.updated_at).toLocaleDateString("zh-CN")}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost px-2 text-xs"
                        onClick={() => void deleteMine(mine.id)}
                      >
                        删
                      </button>
                    </li>
                  ))}
                </ul>
                {sentinel}
              </>
            )}
          </div>
        </aside>
      </div>

      {detailLoading && keywords.length === 0 && (
        <div className="card p-5">
          <p className="text-sm text-[var(--muted)]">正在加载这组痛点…</p>
        </div>
      )}

      {keywords.length > 0 && (
        <div className="card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-medium">
              痛点列表
              <span className="ml-2 text-sm font-normal text-[var(--muted)]">
                共 {keywords.length} 条
              </span>
            </h2>
            <input
              className="field max-w-xs"
              placeholder="筛选痛点或标题…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--muted)]">
                  <th className="pb-2 pr-3 font-medium">痛点</th>
                  <th className="pb-2 pr-3 font-medium">文章标题</th>
                  <th className="pb-2 pr-3 font-medium">类型</th>
                  <th className="pb-2 pr-3 font-medium">谁会痛</th>
                  <th className="pb-2 pr-3 font-medium">AI 写文</th>
                  <th className="pb-2 font-medium">已生成文章</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((k) => {
                  const articles = articlesByKeyword.get(k.id) ?? [];
                  return (
                    <tr key={k.id} className="border-b border-[var(--line)]/60">
                      <td className="py-3 pr-3 align-top font-medium">{k.keyword}</td>
                      <td className="py-3 pr-3 align-top">{k.title}</td>
                      <td className="py-3 pr-3 align-top text-[var(--muted)]">
                        {intentLabel(k.intent)}
                      </td>
                      <td className="max-w-[200px] py-3 pr-3 align-top text-[var(--muted)]">
                        {k.angle || "—"}
                      </td>
                      <td className="py-3 pr-3 align-top">
                        <button
                          type="button"
                          className="btn btn-ghost px-2 py-1 text-xs"
                          onClick={() => goWriteWithAi(k)}
                        >
                          AI 写文
                        </button>
                      </td>
                      <td className="py-3 align-top">
                        {articles.length === 0 ? (
                          <span className="text-[var(--muted)]">—</span>
                        ) : (
                          <ul className="space-y-1">
                            {articles.map((row) => (
                              <li key={row.id}>
                                <Link
                                  href={`/articles/${row.article_id}`}
                                  className="text-[var(--accent)] underline-offset-2 hover:underline"
                                  title={row.brief || undefined}
                                >
                                  {row.article_title}
                                </Link>
                                <span className="ml-1 text-xs text-[var(--muted)]">
                                  {new Date(row.created_at).toLocaleDateString("zh-CN")}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <p className="py-8 text-center text-[var(--muted)]">没有匹配的结果</p>
          )}
        </div>
      )}
    </div>
  );
}
