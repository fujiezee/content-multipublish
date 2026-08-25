"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuota } from "@/components/useQuota";

type VerifyPayload = {
  paid?: boolean;
  status?: string;
  error?: string;
  order?: { label?: string };
};

export function PlanPaySuccess() {
  const search = useSearchParams();
  const sessionId = search.get("session_id") || "";
  const { refresh } = useQuota();
  const [state, setState] = useState<"pending" | "paid" | "error">("pending");
  const [message, setMessage] = useState("正在确认支付并写入额度…");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    if (!sessionId) {
      setState("error");
      setMessage("缺少支付会话");
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      attempts += 1;
      try {
        const res = await fetch(
          `/api/billing/verify?session_id=${encodeURIComponent(sessionId)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as VerifyPayload;
        if (cancelled) return;
        if (data.paid) {
          setState("paid");
          setMessage("已到账");
          setDetail(data.order?.label ? `${data.order.label} 已写入本月额度` : "");
          void refresh();
          return;
        }
        if (data.error && res.status >= 400) {
          setState("error");
          setMessage(data.error);
          return;
        }
        if (attempts >= 20) {
          setState("error");
          setMessage("支付确认还没回来，过几秒再刷新。");
          return;
        }
        window.setTimeout(() => {
          void poll();
        }, 2500);
      } catch {
        if (cancelled) return;
        setState("error");
        setMessage("确认支付失败，请稍后重试");
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [sessionId, refresh]);

  return (
    <div className="plan-page">
      <header>
        <h1>支付结果</h1>
        <p className="text-sm text-[var(--muted)]">
          {state === "pending"
            ? "支付确认通常需要几秒，请稍候"
            : state === "paid"
              ? "可以继续写文章、做图、出片"
              : "没确认上的话，回到费用页再试一次"}
        </p>
      </header>
      <section className="card space-y-3 p-5">
        <p>{message}</p>
        {detail ? <p className="text-sm text-[var(--muted)]">{detail}</p> : null}
        {state === "paid" ? (
          <div className="flex flex-wrap gap-2">
            <Link href="/plan" className="btn btn-primary">
              看余量
            </Link>
            <Link href="/articles" className="btn btn-ghost">
              去写文章
            </Link>
          </div>
        ) : null}
        {state === "error" ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              刷新状态
            </button>
            <Link href="/plan#recharge" className="btn btn-ghost">
              回到费用
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}
