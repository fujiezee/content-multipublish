import { Suspense } from "react";
import { PodcastDirectory } from "@/components/PodcastDirectory";

export default function PodcastsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--muted)]">加载中…</p>}>
      <PodcastDirectory />
    </Suspense>
  );
}
