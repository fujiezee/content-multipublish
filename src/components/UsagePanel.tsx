"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { BillingUsage } from "@/lib/billing/types";
import { splitBillingUsage } from "@/lib/billing/types";
import { formatFen } from "@/lib/billing/plans";

function usageWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function usageLine(row: BillingUsage): string {
  const refund = row.walletFen < 0;
  const meter = row.meter?.trim();
  const quantity =
    row.kind === "api" || row.kind === "music"
      ? null
      : `${Math.abs(row.fromWallet) || Math.abs(row.amount)} ${row.unit}`;
  const parts = [
    usageWhen(row.createdAt),
    row.label,
    meter || null,
    quantity,
    refund ? "退回" : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function UsageList({ rows }: { rows: BillingUsage[] }) {
  if (rows.length === 0) {
    return <p className="plan-usage__empty">暂无</p>;
  }
  return (
    <ul>
      {rows.map((row) => {
        const refund = row.walletFen < 0;
        return (
          <li key={row.id}>
            <span>{usageLine(row)}</span>
            <strong>
              {refund ? "+" : ""}
              {formatFen(Math.abs(row.walletFen))}
            </strong>
          </li>
        );
      })}
    </ul>
  );
}

export function UsagePanel() {
  const [usage, setUsage] = useState<BillingUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { model: modelUsage, other: otherUsage } = splitBillingUsage(usage ?? []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await fetch("/api/billing/me?full=1&limit=120", {
          cache: "no-store",
        }).then((r) => r.json());
        if (cancelled) return;
        setUsage(Array.isArray(me.usage) ? (me.usage as BillingUsage[]) : []);
      } catch {
        if (!cancelled) setError("记录没读出来");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="plan-page">
      <header>
        <p className="text-sm text-[var(--muted)]">
          <Link href="/plan" className="underline">
            费用
          </Link>
          {" · 消耗记录"}
        </p>
        <h1>消耗记录</h1>
        <p className="text-sm text-[var(--muted)]">
          扣余额才会出现在这里。套餐额度内的用量不记。配图 / 出片 / API /
          音乐在「模型」，文章 / 查排名在「其他」。
        </p>
      </header>

      {error ? (
        <div className="card px-4 py-3 text-sm text-[var(--danger)]">{error}</div>
      ) : null}

      {!usage ? (
        <p className="text-sm text-[var(--muted)]">加载中…</p>
      ) : (
        <section className="card plan-usage plan-usage--page">
          {usage.length === 0 ? (
            <p>还没有扣过余额。</p>
          ) : (
            <>
              <div className="plan-usage__group">
                <h4>模型</h4>
                <UsageList rows={modelUsage} />
              </div>
              <div className="plan-usage__group">
                <h4>其他</h4>
                <UsageList rows={otherUsage} />
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
