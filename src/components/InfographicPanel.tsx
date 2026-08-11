"use client";

import { useState } from "react";
import type { InfographicCard } from "@/lib/ai/infographic";
import type { ArticleVariant, PlatformFamily } from "@/lib/types";

type Item = {
  card: InfographicCard;
  url: string;
  model?: string;
};

type Props = {
  articleId: string;
  title: string;
  bodyHtml: string;
  editingTarget: "master" | PlatformFamily;
  /** Apply body HTML with images already inserted at matched anchors */
  onApplyBody: (html: string) => void;
  /** Refresh variant list after server-side sync */
  onVariantsSynced?: (variants: ArticleVariant[]) => void;
};

export function InfographicPanel({
  articleId,
  title,
  bodyHtml,
  editingTarget,
  onApplyBody,
  onVariantsSynced,
}: Props) {
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    headline?: string;
  } | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    setStatus(null);
    setItems([]);
    setProgress(null);
    try {
      const res = await fetch("/api/ai/infographic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          bodyHtml,
          count,
          articleId,
          family: editingTarget,
          syncVariants: editingTarget !== "social",
          stream: true,
        }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "生成失败");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastItems: Item[] = [];
      let donePayload: {
        inserted?: number;
        syncedFamilies?: { family: string; label: string }[];
        variants?: ArticleVariant[];
      } | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(trimmed) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (event.type === "status" && typeof event.message === "string") {
            setStatus(event.message);
            continue;
          }

          if (event.type === "cards" && typeof event.total === "number") {
            setProgress({ current: 0, total: event.total });
            setStatus(`已规划 ${event.total} 张，开始逐张生图…`);
            continue;
          }

          if (event.type === "image_start") {
            const total = Number(event.total) || count;
            const index = Number(event.index) || 0;
            setProgress({
              current: index + 1,
              total,
              headline:
                typeof event.headline === "string" ? event.headline : undefined,
            });
            setStatus(
              `正在生成第 ${index + 1}/${total} 张${
                typeof event.headline === "string" ? `：${event.headline}` : ""
              }`,
            );
            continue;
          }

          if (event.type === "image_done" && event.item) {
            const item = event.item as Item;
            lastItems = [...lastItems, item];
            setItems(lastItems);
            if (typeof event.bodyHtml === "string" && event.bodyHtml.trim()) {
              onApplyBody(event.bodyHtml);
            }
            const total = Number(event.total) || count;
            const inserted = Number(event.inserted) || lastItems.length;
            setStatus(`已完成 ${inserted}/${total} 张，继续下一张…`);
            continue;
          }

          if (event.type === "image_error") {
            const index = Number(event.index) || 0;
            const total = Number(event.total) || count;
            const msg =
              typeof event.error === "string" ? event.error : "生图失败";
            setStatus(`第 ${index + 1}/${total} 张失败（${msg}），继续下一张…`);
            continue;
          }

          if (event.type === "error") {
            throw new Error(
              typeof event.error === "string" ? event.error : "生成失败",
            );
          }

          if (event.type === "done") {
            donePayload = event as typeof donePayload;
            if (Array.isArray(event.items)) {
              lastItems = event.items as Item[];
              setItems(lastItems);
            }
            if (typeof event.bodyHtml === "string" && event.bodyHtml.trim()) {
              onApplyBody(event.bodyHtml);
            }
            if (Array.isArray(event.variants)) {
              onVariantsSynced?.(event.variants as ArticleVariant[]);
            }
          }
        }
      }

      if (!lastItems.length) {
        throw new Error("未生成任何信息图");
      }

      const synced = donePayload?.syncedFamilies || [];
      const syncTip =
        synced.length > 0
          ? `，并已同步到：${synced.map((s) => s.label).join("、")}`
          : editingTarget === "social"
            ? "（社媒短内容单独配图，未同步其他稿）"
            : "";
      setStatus(
        `已生成并居中插入 ${donePayload?.inserted ?? lastItems.length} 张信息图${syncTip}`,
      );
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[12px] border border-[var(--line)] bg-[#fffdf9] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">正文信息图</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {editingTarget === "social"
              ? "社媒短内容单独生图并插入"
              : "一张一张生成并插入；长文变体（除社媒）最后统一复用"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            张数
            <select
              className="field py-1 text-sm"
              value={count}
              disabled={busy}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary text-sm"
            disabled={busy}
            onClick={() => void generate()}
          >
            {busy
              ? progress
                ? `生成中 ${progress.current}/${progress.total}…`
                : "规划片段中…"
              : "生成信息图"}
          </button>
        </div>
      </div>

      {progress && busy && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
              style={{
                width: `${Math.min(
                  100,
                  Math.round((progress.current / Math.max(progress.total, 1)) * 100),
                )}%`,
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
      {status && !error && (
        <p className="mt-3 text-sm text-[var(--ok)]">{status}</p>
      )}

      {items.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => (
            <li
              key={`${item.url}-${index}`}
              className="overflow-hidden rounded-xl border border-[var(--line)] bg-white"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.url}
                alt={item.card.headline}
                className="mx-auto aspect-[16/9] w-full object-cover"
              />
              <div className="space-y-1.5 p-3">
                <div className="text-sm font-medium leading-snug">
                  {item.card.headline}
                </div>
                {(item.card.insertHint || item.card.anchorText) && (
                  <p className="text-xs text-[var(--muted)]">
                    {item.card.insertHint
                      ? `已插入：${item.card.insertHint}`
                      : `锚点：${item.card.anchorText}`}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
