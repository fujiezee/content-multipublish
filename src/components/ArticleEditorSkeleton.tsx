export function ArticleEditorSkeleton({
  title,
}: {
  title?: string;
}) {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="h-9 w-16 rounded-md bg-[var(--bg-deep)]" />
        <div className="flex items-center gap-2">
          <div className="h-9 w-16 rounded-md bg-[var(--bg-deep)]" />
          <div className="h-9 w-24 rounded-md bg-[var(--bg-deep)]" />
          <div className="h-9 w-28 rounded-md bg-[var(--accent-soft)]" />
        </div>
      </div>
      <div className="card space-y-4 p-4 md:p-5">
        <div className="text-lg font-medium">
          {title?.trim() || "打开文章…"}
        </div>
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-[var(--bg-deep)]" />
          <div className="h-3 w-11/12 rounded bg-[var(--bg-deep)]" />
          <div className="h-3 w-4/5 rounded bg-[var(--bg-deep)]" />
          <div className="h-3 w-10/12 rounded bg-[var(--bg-deep)]" />
        </div>
        <p className="text-sm text-[var(--muted)]">正文马上出来</p>
      </div>
    </div>
  );
}
