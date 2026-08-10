"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { GeoKeyword, GeoKeywordArticleWithTitle, GeoKeywordMine } from "@/lib/types";
import { GEO_KEYWORD_INTENTS } from "@/lib/types";

type MineWithCount = GeoKeywordMine & { keyword_count?: number };

function intentLabel(id: string) {
  return GEO_KEYWORD_INTENTS.find((i) => i.id === id)?.label ?? id;
}

export function GeoKeywordPanel() {
  const router = useRouter();
  const [mines, setMines] = useState<MineWithCount[]>([]);
  const [activeMineId, setActiveMineId] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<GeoKeyword[]>([]);
  const [keywordArticles, setKeywordArticles] = useState<GeoKeywordArticleWithTitle[]>([]);
  const [seed, setSeed] = useState("");
  const [context, setContext] = useState("");
  const [count, setCount] = useState(40);
  const [mining, setMining] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const articlesByKeyword = useMemo(() => {
    const map = new Map<string, GeoKeywordArticleWithTitle[]>();
    for (const row of keywordArticles) {
      const list = map.get(row.keyword_id) ?? [];
      list.push(row);
      map.set(row.keyword_id, list);
    }
    return map;
  }, [keywordArticles]);

  const loadMines = useCallback(async () => {
    try {
      const res = await fetch("/api/geo/mines", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setMines(data.mines ?? []);
    } catch {
      // ignore transient errors
    }
  }, []);

  const loadMineDetail = useCallback(async (mineId: string) => {
    try {
      const res = await fetch(`/api/geo/mines/${mineId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setKeywords(data.keywords ?? []);
      setKeywordArticles(data.keywordArticles ?? []);
      setActiveMineId(mineId);
      setSeed(data.mine?.seed ?? "");
      setContext(data.mine?.context ?? "");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadMines();
  }, [loadMines]);

  async function runMine(append: boolean) {
    if (!seed.trim()) {
      setMessage("请先填写主词");
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
        setMessage(data.error || "挖词失败");
        return;
      }

      setActiveMineId(data.mine.id);
      setKeywords(data.keywords ?? []);
      setKeywordArticles(data.keywordArticles ?? []);
      const added = data.added ?? 0;
      const skipped = data.skipped_duplicates ?? 0;
      setMessage(
        `新增 ${added} 条${skipped ? `，去重跳过 ${skipped} 条` : ""}（库内全局不重复）`,
      );
      await loadMines();
    } finally {
      setMining(false);
    }
  }

  async function deleteMine(mineId: string) {
    if (!confirm("确定删除这组挖词记录？")) return;
    await fetch(`/api/geo/mines/${mineId}`, { method: "DELETE" });
    if (activeMineId === mineId) {
      setActiveMineId(null);
      setKeywords([]);
      setKeywordArticles([]);
    }
    await loadMines();
  }

  function goWriteWithAi(keyword: GeoKeyword) {
    const params = new URLSearchParams({
      kind: "article",
      geoKeywordId: keyword.id,
      brief: `围绕长尾词「${keyword.keyword}」写一篇 GEO 优化长文。${keyword.angle ? `写作角度：${keyword.angle}` : ""}`,
      title: keyword.title,
    });
    router.push(`/writing?${params.toString()}`);
  }

  const filtered = keywords.filter((k) => {
    if (!filter.trim()) return true;
    const q = filter.trim().toLowerCase();
    return (
      k.keyword.toLowerCase().includes(q) ||
      k.title.toLowerCase().includes(q) ||
      k.angle.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">GEO 挖词</h1>
          <p className="mt-1 text-[var(--muted)]">
            输入主词，AI 联想长尾词与文章标题；全库去重，可直接 AI 写文并记录关联
          </p>
        </div>
        <Link href="/writing" className="btn btn-ghost text-sm">
          AI 写文案 →
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="card space-y-4 p-5">
          <h2 className="text-lg font-medium">挖词需求</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm text-[var(--muted)]">主词 *</span>
              <input
                className="field"
                placeholder="例如：点物GEO、企业品牌营销、AI 客服"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm text-[var(--muted)]">
                背景说明（可选）
              </span>
              <textarea
                className="field min-h-[88px] resize-y"
                placeholder="行业、产品、目标人群、地域…帮助 AI 挖得更准"
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
              {mining ? "挖掘中…" : "开始挖词"}
            </button>
            {activeMineId && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={mining}
                onClick={() => void runMine(true)}
              >
                继续挖词（去重追加）
              </button>
            )}
          </div>

          {message && (
            <p className="text-sm text-[var(--accent)]">{message}</p>
          )}
        </div>

        <aside className="card p-5">
          <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">历史主词</h2>
          {mines.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">暂无记录</p>
          ) : (
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
                    onClick={() => void loadMineDetail(mine.id)}
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
          )}
        </aside>
      </div>

      {keywords.length > 0 && (
        <div className="card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-medium">
              长尾词列表
              <span className="ml-2 text-sm font-normal text-[var(--muted)]">
                共 {keywords.length} 条
              </span>
            </h2>
            <input
              className="field max-w-xs"
              placeholder="筛选关键词或标题…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--muted)]">
                  <th className="pb-2 pr-3 font-medium">长尾词</th>
                  <th className="pb-2 pr-3 font-medium">文章标题</th>
                  <th className="pb-2 pr-3 font-medium">意图</th>
                  <th className="pb-2 pr-3 font-medium">角度</th>
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
