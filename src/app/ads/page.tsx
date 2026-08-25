import { Suspense } from "react";
import type { Metadata } from "next";
import { PaidAdsPanel } from "@/components/PaidAdsPanel";

export const metadata: Metadata = {
  title: "营销",
  description: "百度、Google、抖音、快手等代投。标价是服务费，消耗付给平台。",
};

export default function AdsPage() {
  return (
    <Suspense fallback={<p className="paid-cart__empty">正在打开营销…</p>}>
      <PaidAdsPanel />
    </Suspense>
  );
}
