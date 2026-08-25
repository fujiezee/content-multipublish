"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  formatYuan,
  getLicensePlan,
  getWalletPack,
  isLicensePlanId,
  planPriceYuan,
  walletCreditYuan,
} from "@/lib/billing/plans";

type StripeEmbeddedCheckout = {
  mount: (target: string | HTMLElement) => void;
  destroy: () => void;
};

declare global {
  interface Window {
    Stripe?: (pk: string) => {
      initEmbeddedCheckout: (opts: {
        clientSecret: string;
        appearance?: {
          theme?: string;
          variables?: Record<string, string>;
        };
      }) => Promise<StripeEmbeddedCheckout>;
    };
  }
}

function checkoutBodyFromSearch(
  search: URLSearchParams,
): Record<string, string> | null {
  const kind = search.get("kind") || "";
  if (kind === "wallet" || kind === "pack") {
    const packId = search.get("packId") || "";
    if (!packId) return null;
    return { kind, packId };
  }
  if (kind === "plan") {
    const planId = search.get("planId") || "";
    if (!isLicensePlanId(planId) || planId === "trial" || planId === "private") {
      return null;
    }
    return {
      kind: "plan",
      planId,
      interval: search.get("interval") === "yearly" ? "yearly" : "monthly",
    };
  }
  return null;
}

function paySummary(search: URLSearchParams): { title: string; detail: string } | null {
  const kind = search.get("kind") || "";
  if (kind === "wallet" || kind === "pack") {
    const pack = getWalletPack(search.get("packId") || "");
    if (!pack) return null;
    return {
      title: `充 ${formatYuan(pack.payYuan)}`,
      detail: `到账 ${formatYuan(walletCreditYuan(pack))}。付完立刻能用。`,
    };
  }
  if (kind === "plan") {
    const planId = search.get("planId") || "";
    if (!isLicensePlanId(planId)) return null;
    const plan = getLicensePlan(planId);
    const interval = search.get("interval") === "yearly" ? "yearly" : "monthly";
    const price = planPriceYuan(plan, interval);
    return {
      title: `开通${plan.name} · ${interval === "yearly" ? "年付" : "月付"}`,
      detail: price != null ? `${formatYuan(price)}。付完立刻能用。` : plan.forWho,
    };
  }
  return null;
}

function loadStripeJs(): Promise<NonNullable<Window["Stripe"]>> {
  if (typeof window.Stripe === "function") return Promise.resolve(window.Stripe);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://js.stripe.com/v3/"]',
    );
    const onReady = () => {
      if (typeof window.Stripe === "function") resolve(window.Stripe);
      else reject(new Error("支付组件加载失败"));
    };
    if (existing) {
      existing.addEventListener("load", onReady);
      existing.addEventListener("error", () => reject(new Error("支付组件加载失败")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.async = true;
    script.onload = onReady;
    script.onerror = () => reject(new Error("支付组件加载失败"));
    document.head.appendChild(script);
  });
}

export function PlanPayClient() {
  const search = useSearchParams();
  const mountRef = useRef<HTMLDivElement>(null);
  const checkoutRef = useRef<StripeEmbeddedCheckout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("正在准备支付…");
  const summary = paySummary(search);

  useEffect(() => {
    const body = checkoutBodyFromSearch(search);
    if (!body) {
      setError("缺少支付参数");
      setStatus("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/billing/checkout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, embedded: true }),
        });
        const data = (await res.json()) as {
          clientSecret?: string;
          publishableKey?: string;
          error?: string;
        };
        if (!res.ok || !data.clientSecret) {
          throw new Error(data.error || "无法创建支付");
        }
        if (!data.publishableKey) {
          throw new Error("支付组件未配置");
        }
        if (cancelled) return;
        setStatus("正在打开支付…");
        const Stripe = await loadStripeJs();
        if (cancelled) return;
        const stripe = Stripe(data.publishableKey);
        const mountOpts = { clientSecret: data.clientSecret };
        const appearance = {
          theme: "stripe",
          variables: {
            colorPrimary: "#0f5c4c",
            colorBackground: "#faf7f0",
            colorText: "#1c1915",
            colorDanger: "#9f1239",
            borderRadius: "10px",
            fontFamily:
              "Iowan Old Style, Palatino Linotype, Songti SC, Noto Serif SC, serif",
          },
        };
        let checkout: StripeEmbeddedCheckout;
        try {
          checkout = await stripe.initEmbeddedCheckout({
            ...mountOpts,
            appearance,
          });
        } catch {
          checkout = await stripe.initEmbeddedCheckout(mountOpts);
        }
        if (cancelled) {
          checkout.destroy();
          return;
        }
        checkoutRef.current = checkout;
        if (!mountRef.current) {
          checkout.destroy();
          return;
        }
        checkout.mount(mountRef.current);
        setStatus("");
      } catch (err) {
        if (!cancelled) {
          setStatus("");
          setError(err instanceof Error ? err.message : "开通失败");
        }
      }
    })();
    return () => {
      cancelled = true;
      checkoutRef.current?.destroy();
      checkoutRef.current = null;
    };
  }, [search]);

  return (
    <div className="plan-page">
      <header>
        <h1>支付</h1>
        <p className="text-sm text-[var(--muted)]">
          {summary?.title || "在本页完成支付，不用跳到别的站点。"}
        </p>
        <p>
          <Link href="/plan#recharge" className="text-sm text-[var(--muted)]">
            返回费用
          </Link>
        </p>
      </header>
      {summary ? (
        <p className="text-sm text-[var(--muted)]">{summary.detail}</p>
      ) : null}
      {status ? (
        <p className="text-sm text-[var(--muted)]">{status}</p>
      ) : null}
      {error ? (
        <section className="card space-y-3 p-5">
          <p className="text-[var(--danger)]">{error}</p>
          <Link href="/plan#recharge" className="btn btn-ghost">
            回到费用
          </Link>
        </section>
      ) : null}
      <div ref={mountRef} className="plan-pay-mount" />
    </div>
  );
}
