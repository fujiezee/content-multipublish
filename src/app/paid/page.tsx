import { Suspense } from "react";
import type { Metadata } from "next";
import { PaidMediaPanel } from "@/components/PaidMediaPanel";

export const metadata: Metadata = {
  title: "付费",
  description: "选稿、选媒体、下单代发。价格公开，出稿回填链接。",
};

export default function PaidPublishPage() {
  return (
    <Suspense fallback={<p className="paid-cart__empty">正在打开付费…</p>}>
      <PaidMediaPanel />
    </Suspense>
  );
}
