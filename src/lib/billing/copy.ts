import type { QuotaKind } from "@/lib/billing/types";

export const PLAN_RECHARGE_HREF = "/plan#recharge";

export function quotaRechargeText(_kind?: QuotaKind): string {
  return "配额不足 · 请充值";
}
