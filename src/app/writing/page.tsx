import { Suspense } from "react";
import { AiWritingPanel } from "@/components/AiWritingPanel";

export default function WritingPage() {
  return (
    <Suspense
      fallback={<div className="py-12 text-center text-[var(--muted)]">加载中…</div>}
    >
      <AiWritingPanel />
    </Suspense>
  );
}
