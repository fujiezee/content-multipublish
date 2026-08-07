"use client";

import { useState } from "react";
import type { PlatformId } from "@/lib/types";
import { PLATFORM_ICONS, platformFaviconUrl } from "@/lib/platform-icons";

type Props = {
  platform: PlatformId;
  size?: number;
  className?: string;
};

export function PlatformIcon({ platform, size = 28, className = "" }: Props) {
  const meta = PLATFORM_ICONS[platform];
  const [failed, setFailed] = useState(false);
  const px = `${size}px`;

  if (failed) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold text-white ${className}`}
        style={{
          width: px,
          height: px,
          background: meta.color,
          fontSize: size <= 24 ? "9px" : "11px",
        }}
        aria-hidden
      >
        {meta.mark}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-[var(--line)] ${className}`}
      style={{ width: px, height: px }}
      aria-hidden
    >
      {/* biome-ignore lint/performance/noImgElement: platform CDN icons */}
      <img
        src={platformFaviconUrl(platform)}
        alt=""
        width={size}
        height={size}
        className="h-full w-full object-contain p-0.5"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
