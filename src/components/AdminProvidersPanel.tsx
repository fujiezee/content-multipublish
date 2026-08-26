"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  ProviderBalance,
  ProviderBalanceStatus,
} from "@/lib/ai/provider-balance";

const STATUS_LABEL: Record<ProviderBalanceStatus, string> = {
  ok: "够用",
  low: "偏低，该充了",
  empty: "没钱了",
  error: "查不到",
  unconfigured: "没配密钥",
  manual: "请打开控制台",
};

function StatusBadge({ status }: { status: ProviderBalanceStatus }) {
  const kind =
    status === "ok"
      ? "ok"
      : status === "low" || status === "manual"
        ? "warn"
        : status === "empty" || status === "error"
          ? "danger"
          : "off";
  return (
    <span className={`admin-status admin-status--${kind}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function when(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function AdminProvidersPanel() {
  const [rows, setRows] = useState<ProviderBalance[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/providers/balance", {
        cache: "no-store",
      });
      if (res.status === 403) {
        setLoadError("没有管理权限");
        return;
      }
      const data = (await res.json()) as {
        providers?: ProviderBalance[];
        fetchedAt?: string;
        error?: string;
      };
      if (!res.ok) {
        setLoadError(data.error || `加载失败（${res.status}）`);
        return;
      }
      setRows(Array.isArray(data.providers) ? data.providers : []);
      setFetchedAt(data.fetchedAt || new Date().toISOString());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const attention = rows.filter(
    (row) => row.status === "low" || row.status === "empty",
  );

  return (
    <div className="admin-providers">
      <div className="admin-models__toolbar">
        <p className="admin-models__hint">
          {loading
            ? "正在问还剩多少钱…"
            : fetchedAt
              ? `刚才查过 · ${when(fetchedAt)}`
              : null}
        </p>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? "查询中…" : "再查一次"}
        </button>
      </div>

      {loadError ? (
        <p className="text-sm text-[var(--danger)]">{loadError}</p>
      ) : null}

      {!loading && attention.length > 0 ? (
        <p className="admin-providers__alert">
          {attention
            .map((row) => `${row.label} ${row.amount || STATUS_LABEL[row.status]}`)
            .join(" · ")}
        </p>
      ) : null}

      <div className="card admin-table-wrap">
        <table className="admin-table admin-table--static admin-providers-table">
          <thead>
            <tr>
              <th>来源</th>
              <th>用在哪</th>
              <th>余额</th>
              <th>状态</th>
              <th>充值</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? [0, 1, 2, 3, 4, 5].map((i) => (
                  <tr key={`skel-${i}`} className="catalog-skel-row">
                    <td colSpan={5}>
                      <span className="catalog-skel-bar" />
                    </td>
                  </tr>
                ))
              : rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.label}</strong>
                    </td>
                    <td className="admin-providers-table__uses">{row.uses}</td>
                    <td>
                      <strong>{row.amount || "—"}</strong>
                      <em>{row.detail || row.error || ""}</em>
                    </td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td>
                      {row.rechargeUrl ? (
                        <a
                          className="btn btn-ghost"
                          href={row.rechargeUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {row.rechargeLabel || "打开"}
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
