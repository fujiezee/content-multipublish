"use client";

import { useEffect, useMemo, useState } from "react";
import { LICENSE_PLANS, formatFen } from "@/lib/billing/plans";
import {
  splitBillingUsage,
  type BillingUsage,
  type WorkspacePlanView,
} from "@/lib/billing/types";

type AdminRow = WorkspacePlanView & {
  createdAt: string;
  users: { email: string; displayName: string }[];
};

function remain(cap: number | "unlimited", used: number): string {
  if (cap === "unlimited") return `${used}/不限`;
  return `${used}/${cap}`;
}

function usageWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function usageSource(row: BillingUsage): string {
  if (row.amount < 0 || row.walletFen < 0) {
    return row.walletFen !== 0
      ? `退回 ${formatFen(Math.abs(row.walletFen))}`
      : "退回套餐";
  }
  if (row.fromWallet > 0 && row.fromIncluded > 0) {
    return `套餐 ${row.fromIncluded} + 余额 ${row.fromWallet} ${formatFen(row.walletFen)}`;
  }
  if (row.fromWallet > 0 || row.walletFen > 0) {
    return `余额 ${formatFen(row.walletFen)}`;
  }
  return "套餐";
}

function AdminUsageGroup({
  title,
  rows,
}: {
  title: string;
  rows: BillingUsage[];
}) {
  return (
    <div className="admin-usage__group">
      <h4>{title}</h4>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">暂无</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.id}>
              <span>
                {usageWhen(row.createdAt)}
                {row.actorEmail ? ` · ${row.actorEmail}` : ""}
              </span>
              <span>
                {row.label}
                {row.meter?.trim() ? ` · ${row.meter.trim()}` : ""}
                {row.kind === "api" || row.kind === "music"
                  ? ""
                  : ` ${row.amount} ${row.unit}`}
              </span>
              <em>{usageSource(row)}</em>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AdminBillingPanel({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [form, setForm] = useState({
    planId: "trial",
    addArticles: "",
    addImages: "",
    addMentions: "",
    addVideoSeconds: "",
    addWalletYuan: "",
    capArticles: "",
    capImages: "",
    capMentions: "",
    capVideoSeconds: "",
    note: "",
    resetUsed: false,
  });
  const [usage, setUsage] = useState<BillingUsage[]>([]);

  async function refresh() {
    const res = await fetch("/api/admin/workspaces", { cache: "no-store" });
    if (res.status === 403) {
      setForbidden(true);
      return;
    }
    const data = await res.json();
    setRows((data.workspaces as AdminRow[]) ?? []);
  }

  async function loadUsage(workspaceId: string) {
    const res = await fetch(
      `/api/admin/workspaces?workspaceId=${encodeURIComponent(workspaceId)}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      setUsage([]);
      return;
    }
    const data = await res.json();
    setUsage(Array.isArray(data.usage) ? (data.usage as BillingUsage[]) : []);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const hay = [
        row.workspaceName,
        row.planName,
        ...row.users.map((u) => `${u.email} ${u.displayName}`),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [q, rows]);

  const current = rows.find((row) => row.workspaceId === picked) ?? null;
  const { model: modelUsage, other: otherUsage } = splitBillingUsage(usage);

  function openRow(row: AdminRow) {
    setPicked(row.workspaceId);
    setMessage(null);
    setUsage([]);
    setForm({
      planId: row.planId,
      addArticles: "",
      addImages: "",
      addMentions: "",
      addVideoSeconds: "",
      addWalletYuan: "",
      capArticles: row.caps.articles == null ? "" : String(row.caps.articles),
      capImages: row.caps.images == null ? "" : String(row.caps.images),
      capMentions: row.caps.mentions == null ? "" : String(row.caps.mentions),
      capVideoSeconds: row.caps.videoSeconds == null ? "" : String(row.caps.videoSeconds),
      note: row.note,
      resetUsed: false,
    });
    void loadUsage(row.workspaceId);
  }

  async function save() {
    if (!picked) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/workspaces", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: picked,
          planId: form.planId,
          addArticles: Number(form.addArticles) || 0,
          addImages: Number(form.addImages) || 0,
          addMentions: Number(form.addMentions) || 0,
          addVideoSeconds: Number(form.addVideoSeconds) || 0,
          addWalletYuan: Number(form.addWalletYuan) || 0,
          capArticles: form.capArticles.trim() === "" ? null : Number(form.capArticles),
          capImages: form.capImages.trim() === "" ? null : Number(form.capImages),
          capMentions: form.capMentions.trim() === "" ? null : Number(form.capMentions),
          capVideoSeconds:
            form.capVideoSeconds.trim() === "" ? null : Number(form.capVideoSeconds),
          note: form.note,
          resetUsed: form.resetUsed,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setMessage("已保存");
      await refresh();
      await loadUsage(picked);
      const next = (data.billing as WorkspacePlanView) ?? null;
      if (next) {
        setForm((prev) => ({
          ...prev,
          addArticles: "",
          addImages: "",
          addMentions: "",
          addVideoSeconds: "",
          addWalletYuan: "",
          note: next.note,
          resetUsed: false,
        }));
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) {
    return (
      <div className="space-y-3">
        {!embedded ? <h1 className="text-2xl font-semibold">后台</h1> : null}
        <p className="text-sm text-[var(--muted)]">没有管理权限。</p>
      </div>
    );
  }

  const body = (
    <>
      <input
        className="field admin-billing__search"
        placeholder="搜邮箱、名字、方案"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="admin-billing__layout">
        <div className="card admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>用户</th>
                <th>方案</th>
                <th>文章</th>
                <th>配图</th>
                <th>排名</th>
                <th>视频</th>
                <th>余额</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const user = row.users[0];
                const qmap = Object.fromEntries(row.quotas.map((item) => [item.kind, item]));
                return (
                  <tr
                    key={row.workspaceId}
                    className={picked === row.workspaceId ? "is-on" : undefined}
                    onClick={() => openRow(row)}
                  >
                    <td>
                      <strong>{user?.displayName || row.workspaceName}</strong>
                      <em>{user?.email || row.workspaceId.slice(0, 8)}</em>
                    </td>
                    <td>{row.planName}</td>
                    <td>{remain(qmap.articles.cap, qmap.articles.used)}</td>
                    <td>{remain(qmap.images.cap, qmap.images.used)}</td>
                    <td>{remain(qmap.mentions.cap, qmap.mentions.used)}</td>
                    <td>{remain(qmap.videoSeconds.cap, qmap.videoSeconds.used)}</td>
                    <td>{formatFen(row.walletFen ?? 0)}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="admin-table__empty">
                    没有匹配的工作区
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <section className="card admin-edit">
          {!current ? (
            <p className="text-sm text-[var(--muted)]">点左边一行，改方案或加量。</p>
          ) : (
            <>
              <h2>
                {current.users[0]?.displayName || current.workspaceName}
              </h2>
              <p className="text-sm text-[var(--muted)]">
                {current.users.map((u) => u.email).join("、") || current.workspaceId}
                {" · "}
                余额 {formatFen(current.walletFen ?? 0)}
              </p>
              <label className="admin-field">
                <span>方案</span>
                <select
                  className="field"
                  value={form.planId}
                  onChange={(e) => setForm((f) => ({ ...f, planId: e.target.value }))}
                >
                  {LICENSE_PLANS.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} · {plan.forWho}
                    </option>
                  ))}
                </select>
              </label>
              <div className="admin-adds">
                <label>
                  <span>加文章</span>
                  <input
                    className="field"
                    inputMode="numeric"
                    placeholder="0"
                    value={form.addArticles}
                    onChange={(e) => setForm((f) => ({ ...f, addArticles: e.target.value }))}
                  />
                </label>
                <label>
                  <span>加配图</span>
                  <input
                    className="field"
                    inputMode="numeric"
                    placeholder="0"
                    value={form.addImages}
                    onChange={(e) => setForm((f) => ({ ...f, addImages: e.target.value }))}
                  />
                </label>
                <label>
                  <span>加查排名</span>
                  <input
                    className="field"
                    inputMode="numeric"
                    placeholder="0"
                    value={form.addMentions}
                    onChange={(e) => setForm((f) => ({ ...f, addMentions: e.target.value }))}
                  />
                </label>
                <label>
                  <span>加视频秒</span>
                  <input
                    className="field"
                    inputMode="numeric"
                    placeholder="0"
                    value={form.addVideoSeconds}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, addVideoSeconds: e.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>加余额（元）</span>
                  <input
                    className="field"
                    inputMode="numeric"
                    placeholder="0"
                    value={form.addWalletYuan}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, addWalletYuan: e.target.value }))
                    }
                  />
                </label>
              </div>
              <p className="text-xs text-[var(--muted)]">
                加量叠在方案上。余额给配图、视频、查排名共用，套餐用完按次扣。
              </p>
              <div className="admin-adds">
                <label>
                  <span>文章上限</span>
                  <input
                    className="field"
                    placeholder="跟方案"
                    value={form.capArticles}
                    onChange={(e) => setForm((f) => ({ ...f, capArticles: e.target.value }))}
                  />
                </label>
                <label>
                  <span>配图上限</span>
                  <input
                    className="field"
                    placeholder="跟方案"
                    value={form.capImages}
                    onChange={(e) => setForm((f) => ({ ...f, capImages: e.target.value }))}
                  />
                </label>
                <label>
                  <span>排名上限</span>
                  <input
                    className="field"
                    placeholder="跟方案"
                    value={form.capMentions}
                    onChange={(e) => setForm((f) => ({ ...f, capMentions: e.target.value }))}
                  />
                </label>
                <label>
                  <span>视频上限</span>
                  <input
                    className="field"
                    placeholder="跟方案"
                    value={form.capVideoSeconds}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, capVideoSeconds: e.target.value }))
                    }
                  />
                </label>
              </div>
              <label className="admin-field">
                <span>备注</span>
                <input
                  className="field"
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                />
              </label>
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={form.resetUsed}
                  onChange={(e) => setForm((f) => ({ ...f, resetUsed: e.target.checked }))}
                />
                本月已用清零
              </label>
              {message ? <p className="text-sm">{message}</p> : null}
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void save()}
              >
                保存
              </button>
              <div className="admin-usage">
                <h3>消耗记录</h3>
                {usage.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">还没有消耗。</p>
                ) : (
                  <>
                    <AdminUsageGroup title="模型" rows={modelUsage} />
                    <AdminUsageGroup title="其他" rows={otherUsage} />
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );

  if (embedded) return body;

  return (
    <div className="admin-billing">
      <header>
        <h1>后台</h1>
        <p>
          给用户开方案、加量。用户在自己的「费用」里看余量。新注册默认免费。
          管理员是摩根。
        </p>
      </header>
      {body}
    </div>
  );
}
