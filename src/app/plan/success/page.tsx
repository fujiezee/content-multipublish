import type { Metadata } from "next";
import { Suspense } from "react";
import { PlanPaySuccess } from "@/components/PlanPaySuccess";

export const metadata: Metadata = {
  title: "支付结果",
};

export default function PlanSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="plan-page">
          <p className="text-sm text-[var(--muted)]">正在确认支付…</p>
        </div>
      }
    >
      <PlanPaySuccess />
    </Suspense>
  );
}
