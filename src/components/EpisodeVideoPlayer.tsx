"use client";

type Props = {
  src: string;
  title?: string;
  regenerating?: boolean;
  compact?: boolean;
};

export function EpisodeVideoPlayer({
  src,
  title,
  regenerating,
  compact,
}: Props) {
  return (
    <figure className={compact ? "max-w-56" : "mx-auto max-w-sm"}>
      <div className="relative overflow-hidden rounded-lg bg-black ring-1 ring-[var(--line)]">
        <video
          key={src}
          src={src}
          controls
          playsInline
          preload="metadata"
          className="aspect-9/16 w-full bg-black object-contain"
        />
        {regenerating && (
          <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/55 px-2 py-1.5 text-center text-xs text-white">
            播的是上一版，新的正在出
          </div>
        )}
      </div>
      {title ? (
        <figcaption className="mt-1.5 text-center text-xs text-[var(--muted)]">
          {title}
        </figcaption>
      ) : null}
    </figure>
  );
}
