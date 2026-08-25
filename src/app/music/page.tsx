import { Suspense } from "react";
import { MusicDirectory } from "@/components/MusicDirectory";

export default function MusicPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--muted)]">加载中…</p>}>
      <MusicDirectory />
    </Suspense>
  );
}
