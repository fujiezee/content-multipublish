import type { Metadata } from "next";
import { Suspense } from "react";
import { PlanPayClient } from "@/components/PlanPayClient";

export const metadata: Metadata = {
  title: "支付",
};

export default function PlanPayPage() {
  return (
    <Suspense
      fallback={
        <div className="plan-page">
          <p className="text-sm text-[var(--muted)]">正在准备支付…</p>
        </div>
      }
    >
      <PlanPayClient />
    </Suspense>
  );
}
