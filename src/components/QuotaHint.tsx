"use client";

import Link from "next/link";
import type { QuotaSnap } from "@/lib/billing/types";
import { PLAN_RECHARGE_HREF, quotaRechargeText } from "@/lib/billing/copy";
import { isQuotaMessage } from "@/components/useQuota";

export function QuotaHint({
  snap,
  need = 1,
  remaining,
}: {
  snap?: QuotaSnap | null;
  need?: number;
  remaining?: number | "unlimited";
}) {
  if (!snap) return null;
  const left = remaining ?? snap.remaining;
  if (left === "unlimited") return null;
  const empty = left <= 0;
  const short = left > 0 && left < need;
  const warn = empty || short;
  return (
    <Link
      href={PLAN_RECHARGE_HREF}
      className={`quota-chip${warn ? " quota-chip--warn" : ""}`}
    >
      {warn
        ? quotaRechargeText(snap.kind)
        : `还剩 ${left} ${snap.unit}`}
    </Link>
  );
}

export function QuotaMessage({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  if (!isQuotaMessage(text)) {
    return <p className={className}>{text}</p>;
  }
  return (
    <p className={className} role="alert">
      <Link href={PLAN_RECHARGE_HREF} className="quota-chip quota-chip--warn">
        {quotaRechargeText()}
      </Link>
    </p>
  );
}
