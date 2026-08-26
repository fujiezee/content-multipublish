"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/useAuth";
import type { WorkspacePlanView } from "@/lib/billing/types";
import { formatFen } from "@/lib/billing/plans";

export function AccountPanel() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [billing, setBilling] = useState<WorkspacePlanView | null>(null);

  useEffect(() => {
    void fetch("/api/billing/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { billing?: WorkspacePlanView }) => {
        if (data.billing) setBilling(data.billing);
      })
      .catch(() => {});
  }, []);

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  if (!user) {
    return <p className="text-sm text-[var(--muted)]">请先登录</p>;
  }

  return (
    <div className="account-page">
      <header>
        <h1>你的账号</h1>
        <p className="text-sm text-[var(--muted)]">
          这是你现在用的账号。改套餐去费用，装扩展去工作区。
        </p>
      </header>

      <section className="card plan-hero">
        <div>
          <p className="plan-hero__kicker">登录的是你</p>
          <h2>{user.displayName}</h2>
          <p>{user.email}</p>
          <p className="account-page__meta">
            工作台 {billing?.workspaceName || user.workspaceId}
            <span>{user.workspaceId}</span>
          </p>
          {billing ? (
            <p className="plan-hero__wallet">
              {billing.planName} · 余额 {formatFen(billing.walletFen)}
              <span>{billing.forWho}</span>
            </p>
          ) : null}
        </div>
        <div className="plan-hero__links">
          <Link href="/plan" className="btn btn-ghost">
            费用
          </Link>
          <Link href="/settings" className="btn btn-ghost">
            工作区
          </Link>
          {user.isAdmin ? (
            <Link href="/admin" className="btn btn-primary">
              后台
            </Link>
          ) : null}
        </div>
      </section>

      {billing ? (
        <ul className="plan-meters">
          {billing.quotas.map((quota) => {
            const empty = quota.remaining !== "unlimited" && quota.remaining <= 0;
            return (
              <li key={quota.kind} className="card plan-meter">
                <div className="plan-meter__head">
                  <strong>{quota.label}</strong>
                  <span>
                    {empty
                      ? "用完了"
                      : quota.remaining === "unlimited"
                        ? `已用 ${quota.used} ${quota.unit}`
                        : `还可出 ${quota.remaining} ${quota.unit}`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="account-page__actions">
        <button type="button" className="btn btn-ghost" onClick={() => void onLogout()}>
          退出登录
        </button>
      </div>
    </div>
  );
}
