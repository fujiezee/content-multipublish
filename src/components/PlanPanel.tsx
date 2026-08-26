"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import type { BillingOrder, WorkspacePlanView } from "@/lib/billing/types";
import {
  LICENSE_PLANS,
  USAGE_RATES,
  WALLET_PACKS,
  formatFen,
  formatYuan,
  usageRatesForPaid,
  walletCreditYuan,
  walletPackYields,
  type LicensePlan,
} from "@/lib/billing/plans";

function periodLabel(start: string): string {
  const [y, m] = start.split("-");
  if (!y || !m) return start;
  return `${y}年${Number(m)}月`;
}

function quotaLines(plan: LicensePlan): string[] {
  const q = plan.quotas;
  return [
    q.articles === "unlimited" ? "写文章够用" : `文章 ${q.articles} 篇`,
    q.infographics === "custom" ? "配图另定" : `配图 ${q.infographics} 张`,
    q.mentions === "custom" ? "查排名另定" : `查排名 ${q.mentions} 次`,
    q.videoSeconds === 0
      ? "不含出片"
      : q.videoSeconds === "custom"
        ? "出片另定"
        : `视频 ${q.videoSeconds} 秒`,
  ];
}

function denomLabel(yuan: number): string {
  if (yuan >= 10000 && yuan % 1000 === 0) {
    const wan = yuan / 10000;
    return `${wan}万`;
  }
  return yuan.toLocaleString("zh-CN");
}

function orderStatusLabel(status: BillingOrder["status"]): string {
  if (status === "paid") return "已到账";
  if (status === "pending") return "待支付";
  if (status === "cancelled") return "已取消";
  return "未完成";
}

export function PlanPanel() {
  const [billing, setBilling] = useState<WorkspacePlanView | null>(null);
  const [orders, setOrders] = useState<BillingOrder[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interval, setIntervalKind] = useState<"monthly" | "yearly">("monthly");
  const [pickedWallet, setPickedWallet] = useState("wallet-1000");
  const walletPack =
    WALLET_PACKS.find((pack) => pack.id === pickedWallet) ??
    WALLET_PACKS.find((pack) => pack.id === "wallet-1000") ??
    WALLET_PACKS[0];
  const walletCredit = walletCreditYuan(walletPack);
  const walletYields = walletPackYields(walletPack);
  const pickedPackIndex = Math.max(
    0,
    WALLET_PACKS.findIndex((pack) => pack.id === walletPack.id),
  );
  const pickedRow = Math.floor(pickedPackIndex / 10);
  const rate = billing
    ? usageRatesForPaid(billing.paidRechargeYuan ?? 0)
    : USAGE_RATES;

  async function loadShop() {
    const me = await fetch("/api/billing/me?full=1", { cache: "no-store" }).then(
      (r) => r.json(),
    );
    if (me.billing) setBilling(me.billing as WorkspacePlanView);
    setIsAdmin(Boolean(me.isAdmin));
    if (Array.isArray(me.orders)) setOrders(me.orders as BillingOrder[]);
  }

  function syncPaidQuietly() {
    void fetch("/api/billing/checkout?sync=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((shop: { billing?: WorkspacePlanView; orders?: BillingOrder[] }) => {
        if (shop.billing) setBilling(shop.billing);
        if (Array.isArray(shop.orders)) setOrders(shop.orders);
      })
      .catch(() => {});
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadShop();
        if (!cancelled) syncPaidQuietly();
      } catch {
        if (!cancelled) setError("方案没读出来");
      }
    })();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void loadShop().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <div className="plan-page">
      <header>
        <h1>费用</h1>
        <p className="text-sm text-[var(--muted)]">
          看余量。不够就升级方案，或充余额。付完立刻能用。
        </p>
      </header>

      {error ? (
        <div className="card px-4 py-3 text-sm text-[var(--danger)]">{error}</div>
      ) : null}

      {!billing ? (
        <p className="text-sm text-[var(--muted)]">加载中…</p>
      ) : (
        <>
          <section className="card plan-hero">
            <div>
              <p className="plan-hero__kicker">{periodLabel(billing.periodStart)} · 本月</p>
              <h2>{billing.planName}</h2>
              <p>{billing.forWho}</p>
              {billing.note ? (
                <p className="text-xs text-[var(--muted)]">备注 {billing.note}</p>
              ) : null}
              <p className="plan-hero__wallet">
                余额 {formatFen(billing.walletFen)}
                <span>
                  配图 {formatFen(rate.images.fen)}/张 · 视频{" "}
                  {formatFen(rate.videoSeconds.fen)}/秒 · 查排名{" "}
                  {formatFen(rate.mentions.fen)}/次。套餐额度没用完时不扣余额。
                </span>
              </p>
            </div>
            <div className="plan-hero__links">
              <Link href="/plan/usage" className="btn btn-ghost">
                消耗记录
              </Link>
              <Link href="/api-hub" className="btn btn-ghost">
                模型 API
              </Link>
              {isAdmin ? (
                <Link href="/admin" className="btn btn-ghost">
                  后台
                </Link>
              ) : null}
            </div>
          </section>

          <ul className="plan-meters">
            {billing.quotas.map((quota) => {
              const pct =
                quota.cap === "unlimited" || quota.cap === 0
                  ? quota.used > 0
                    ? 100
                    : 0
                  : Math.min(100, Math.round((quota.used / quota.cap) * 100));
              const empty = quota.remaining !== "unlimited" && quota.remaining <= 0;
              return (
                <li key={quota.kind} className="card plan-meter">
                  <div className="plan-meter__head">
                    <strong>{quota.label}</strong>
                    <span>
                      {empty
                        ? "用完了"
                        : quota.remaining === "unlimited"
                          ? `已用 ${quota.used} ${quota.unit}，不限`
                          : `还可出 ${quota.remaining} ${quota.unit}`}
                    </span>
                  </div>
                  <div className="plan-meter__bar" aria-hidden>
                    <i style={{ width: `${empty ? 100 : pct}%` }} />
                  </div>
                  {quota.extra > 0 ? (
                    <p className="plan-meter__extra">
                      含加量 {quota.extra} {quota.unit}
                    </p>
                  ) : null}
                  {quota.walletUnits > 0 ? (
                    <p className="plan-meter__extra">
                      余额大约还能出 {quota.walletUnits} {quota.unit}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium">升级</h2>
                <p className="text-sm text-[var(--muted)]">年付按 10 个月计。</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`btn text-sm ${interval === "monthly" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setIntervalKind("monthly")}
                >
                  月付
                </button>
                <button
                  type="button"
                  className={`btn text-sm ${interval === "yearly" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setIntervalKind("yearly")}
                >
                  年付
                </button>
              </div>
            </div>
            <ul className="plan-shop">
              {LICENSE_PLANS.filter((plan) => plan.id !== "trial").map((plan) => {
                const current = billing.planId === plan.id;
                const price =
                  interval === "yearly" ? plan.yearlyYuan : plan.monthlyYuan;
                const privatePlan = plan.id === "private";
                const label = privatePlan
                  ? "咨询企业"
                  : current
                    ? "当前方案"
                    : interval === "yearly"
                      ? `开通${plan.name} · 年付`
                      : `开通${plan.name}`;
                return (
                  <li key={plan.id} className="card plan-shop-card">
                    <div className="plan-shop-card__top">
                      <h3>{plan.name}</h3>
                      {plan.featured ? <span>常用</span> : null}
                    </div>
                    <p className="text-sm text-[var(--muted)]">{plan.forWho}</p>
                    <p className="plan-shop-card__price">
                      {privatePlan
                        ? `从 ${formatYuan(plan.fromYuan ?? 0)} / 月`
                        : `${formatYuan(price ?? 0)}${interval === "yearly" ? " / 年" : " / 月"}`}
                    </p>
                    <ul>
                      {quotaLines(plan).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    {current || privatePlan ? (
                      <button type="button" className="btn btn-primary" disabled>
                        {label}
                      </button>
                    ) : (
                      <Link
                        href={`/plan/pay?kind=plan&planId=${encodeURIComponent(plan.id)}&interval=${interval}`}
                        className="btn btn-primary"
                      >
                        {label}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section id="recharge" className="scroll-mt-24 space-y-3">
            <div>
              <h2 className="text-lg font-medium">充值</h2>
              <p className="text-sm text-[var(--muted)]">
                选一档充进余额。套餐用完，配图、视频、查排名按次扣，可混着用。充得越多，到账越多。
              </p>
            </div>
            <div className="card plan-recharge">
                  <div
                    className="plan-denoms"
                    role="radiogroup"
                    aria-label="充值金额"
                  >
                    {[0, 1, 2].map((row) => (
                      <Fragment key={row}>
                        {WALLET_PACKS.slice(row * 10, row * 10 + 10).map((pack) => {
                          const on = pack.id === walletPack.id;
                          return (
                            <button
                              key={pack.id}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              className={`plan-denom${on ? " is-on" : ""}`}
                              onClick={() => setPickedWallet(pack.id)}
                            >
                              <strong>{denomLabel(pack.payYuan)}</strong>
                              {pack.bonusPct > 0 ? (
                                <span>送{pack.bonusPct}%</span>
                              ) : (
                                <span>原价</span>
                              )}
                            </button>
                          );
                        })}
                        {pickedRow === row ? (
                          <div className="plan-recharge__embed">
                            <div className="plan-recharge__bill">
                              <p className="plan-recharge__pay">
                                付 {formatYuan(walletPack.payYuan)}
                                <span>到账 {formatYuan(walletCredit)}</span>
                              </p>
                              <p className="plan-recharge__bonus">
                                {walletPack.bonusPct > 0
                                  ? `多到 ${formatYuan(walletCredit - walletPack.payYuan)} · 送${walletPack.bonusPct}%`
                                  : "这一档没有折扣"}
                              </p>
                              <ul className="plan-recharge__yield">
                                <li>
                                  配图约 {walletYields.images.toLocaleString("zh-CN")} 张
                                </li>
                                <li>
                                  视频约 {walletYields.videoSeconds.toLocaleString("zh-CN")} 秒
                                </li>
                                <li>
                                  查排名约 {walletYields.mentions.toLocaleString("zh-CN")} 次
                                </li>
                              </ul>
                              <p className="plan-recharge__note">
                                单价：配图 {formatFen(rate.images.fen)}/张 · 视频{" "}
                                {formatFen(rate.videoSeconds.fen)}/秒 · 查排名{" "}
                                {formatFen(rate.mentions.fen)}/次。三种可以混着花。
                              </p>
                            </div>
                            <Link
                              href={`/plan/pay?kind=wallet&packId=${encodeURIComponent(walletPack.id)}`}
                              className="plan-recharge__cta"
                            >
                              <strong>去支付</strong>
                              <span>{formatYuan(walletPack.payYuan)}</span>
                            </Link>
                          </div>
                        ) : null}
                      </Fragment>
                    ))}
                  </div>
                </div>
          </section>

          {orders.length > 0 ? (
            <section className="card space-y-2 p-5">
              <h2 className="text-lg font-medium">开通记录</h2>
              <ul className="plan-orders">
                {orders.map((order) => (
                  <li key={order.id}>
                    <span>{order.label}</span>
                    <span>
                      {formatYuan(order.amountYuan)} · {orderStatusLabel(order.status)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
