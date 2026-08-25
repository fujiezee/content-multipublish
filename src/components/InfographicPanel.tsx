"use client";

import { useEffect, useRef, useState } from "react";
import type { InfographicCard } from "@/lib/ai/infographic";
import { extractInfographicImgs } from "@/lib/ai/infographic-insert";
import type { ArticleVariant, PlatformFamily } from "@/lib/types";
import { QuotaHint, QuotaMessage } from "@/components/QuotaHint";
import { isQuotaMessage, parseQuotaError, useQuota } from "@/components/useQuota";
import { quotaRechargeText } from "@/lib/billing/copy";

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
  /** Reload article body from DB after server persisted infographics */
  onBodyPersisted?: () => void;
};

function recordFamily(target: "master" | PlatformFamily): "master" | "social" {
  return target === "social" ? "social" : "master";
}

export function InfographicPanel({
  articleId,
  title,
  bodyHtml,
  editingTarget,
  onApplyBody,
  onVariantsSynced,
  onBodyPersisted,
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
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;
  const bodyHtmlRef = useRef("");
  bodyHtmlRef.current = bodyHtml;
  const { snap, refresh } = useQuota();
  const imageSnap = snap("images");
  const imageLeft = imageSnap?.remaining;
  const maxCount =
    imageLeft === "unlimited" || imageLeft == null
      ? 5
      : Math.max(0, Math.min(5, imageLeft));
  const noImageQuota = imageLeft === 0;

  useEffect(() => {
    if (typeof imageLeft !== "number") return;
    setCount((c) => {
      if (imageLeft <= 0) return 1;
      return Math.min(Math.max(c, 1), imageLeft);
    });
  }, [imageLeft]);

  useEffect(() => {
    let cancelled = false;
    const family = recordFamily(editingTarget);
    void (async () => {
      try {
        const res = await fetch(
          `/api/ai/infographic?articleId=${encodeURIComponent(articleId)}&family=${family}`,
        );
        const data = (await res.json()) as { items?: Item[] };
        if (cancelled) return;
        if (data.items?.length) {
          setItems(data.items);
          return;
        }
        const extracted = extractInfographicImgs(bodyHtmlRef.current);
        if (extracted.length) {
          setItems(
            extracted.map((img) => ({
              url: img.url,
              card: {
                kind: "points",
                headline: img.alt || "信息图",
              },
            })),
          );
        }
      } catch {
        // keep empty until user generates
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId, editingTarget]);

  async function generate() {
    if (noImageQuota) {
      setError(quotaRechargeText("images"));
      return;
    }
    const ask =
      typeof imageLeft === "number" ? Math.min(count, imageLeft) : count;
    const previous = itemsRef.current;
    setBusy(true);
    setError(null);
    setStatus(null);
    setProgress(null);
    try {
      const res = await fetch("/api/ai/infographic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          bodyHtml,
          count: ask,
          articleId,
          family: editingTarget,
          syncVariants: editingTarget !== "social",
          stream: true,
        }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        throw new Error(
          parseQuotaError(res, data) || data.error || "生成失败",
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastItems: Item[] = [];
      let quotaStopped = false;
      let donePayload: {
        inserted?: number;
        syncedFamilies?: { family: string; label: string }[];
        variants?: ArticleVariant[];
      } | null = null;

      const handleLine = (raw: string) => {
        const trimmed = raw.trim();
        if (!trimmed) return;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          return;
        }

        if (event.type === "quota_cap" && typeof event.message === "string") {
          setStatus(event.message);
          return;
        }

        if (event.type === "status" && typeof event.message === "string") {
          setStatus(event.message);
          return;
        }

        if (event.type === "cards" && typeof event.total === "number") {
          setProgress({ current: 0, total: event.total });
          setStatus(`已规划 ${event.total} 张新图，开始逐张生图…`);
          return;
        }

        if (event.type === "image_start") {
          const total = Number(event.total) || ask;
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
          return;
        }

        if (event.type === "image_done" && event.item) {
          const item = event.item as Item;
          lastItems = [...lastItems, item];
          setItems([...previous, ...lastItems]);
          if (typeof event.bodyHtml === "string" && event.bodyHtml.trim()) {
            onApplyBody(event.bodyHtml);
          }
          const total = Number(event.total) || ask;
          const inserted = Number(event.inserted) || lastItems.length;
          setStatus(`已完成 ${inserted}/${total} 张，继续下一张…`);
          return;
        }

        if (event.type === "image_error") {
          const index = Number(event.index) || 0;
          const total = Number(event.total) || ask;
          const msg =
            typeof event.error === "string" ? event.error : "生图失败";
          const quota = event.code === "quota" || isQuotaMessage(msg);
          if (quota) {
            quotaStopped = true;
            setError(quotaRechargeText("images"));
            setStatus(
              lastItems.length
                ? `额度不够，已出 ${lastItems.length} 张`
                : quotaRechargeText("images"),
            );
            return;
          }
          setStatus(`第 ${index + 1}/${total} 张失败（${msg}），继续下一张…`);
          return;
        }

        if (event.type === "error") {
          throw new Error(
            typeof event.error === "string" ? event.error : "生成失败",
          );
        }

        if (event.type === "done") {
          donePayload = {
            inserted:
              typeof event.inserted === "number" ? event.inserted : undefined,
            syncedFamilies: Array.isArray(event.syncedFamilies)
              ? (event.syncedFamilies as { family: string; label: string }[])
              : undefined,
            variants: Array.isArray(event.variants)
              ? (event.variants as ArticleVariant[])
              : undefined,
          };
          if (Array.isArray(event.items)) {
            lastItems = event.items as Item[];
            setItems([...previous, ...lastItems]);
          }
          if (typeof event.bodyHtml === "string" && event.bodyHtml.trim()) {
            onApplyBody(event.bodyHtml);
          }
          if (Array.isArray(event.variants)) {
            onVariantsSynced?.(event.variants as ArticleVariant[]);
          }
          onBodyPersisted?.();
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        if (done) {
          buffer += decoder.decode();
          for (const line of buffer.split("\n")) handleLine(line);
          break;
        }
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) handleLine(line);
      }

      if (!lastItems.length) {
        throw new Error(
          quotaStopped
            ? quotaRechargeText("images")
            : "未生成任何新的信息图",
        );
      }

      const synced = donePayload?.syncedFamilies || [];
      const syncTip =
        synced.length > 0
          ? `，并已同步到：${synced.map((s) => s.label).join("、")}`
          : editingTarget === "social"
            ? "（社媒短内容单独配图，未同步其他稿）"
            : "";
      setStatus(
        quotaStopped
          ? `额度不够，这次只出了 ${donePayload?.inserted ?? lastItems.length} 张`
          : `已新增 ${donePayload?.inserted ?? lastItems.length} 张信息图${syncTip}`,
      );
      setProgress(null);
      void refresh();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "生成失败";
      const dropped = /failed to fetch|networkerror|load failed|aborted/i.test(
        raw,
      );
      if (dropped) {
        try {
          const family = recordFamily(editingTarget);
          const reload = await fetch(
            `/api/ai/infographic?articleId=${encodeURIComponent(articleId)}&family=${family}`,
          );
          const data = (await reload.json()) as { items?: Item[] };
          if (data.items?.length) setItems(data.items);
        } catch {
          // keep whatever already landed in the list
        }
        setError("生成要一两分钟，连接断了。已出的图还在，再点一次只补没出的。");
      } else {
        setError(raw);
      }
      setProgress(null);
      void refresh();
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
              : "正方形 1:1。先通读全文找出核心观点，再在对应位置总结插入；再次生成只补还没覆盖的观点，已有的图会保留"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            张数
            <select
              className="field py-1 text-sm"
              value={count}
              disabled={busy || noImageQuota}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {(maxCount <= 0 ? [1] : Array.from({ length: maxCount }, (_, i) => i + 1)).map(
                (n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ),
              )}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary text-sm"
            disabled={busy || noImageQuota}
            onClick={() => void generate()}
          >
            {busy
              ? progress
                ? `生成中 ${progress.current}/${progress.total}…`
                : "规划片段中…"
              : items.length > 0
                ? "再生成"
                : "生成信息图"}
          </button>
          <QuotaHint snap={imageSnap} need={count} />
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
        <QuotaMessage
          text={error}
          className="mt-3"
        />
      )}
      {status && status !== error && (
        <p
          className={`mt-3 text-sm ${error ? "text-[var(--muted)]" : "text-[var(--ok)]"}`}
        >
          {status}
        </p>
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
                className="mx-auto aspect-square w-full object-cover"
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
