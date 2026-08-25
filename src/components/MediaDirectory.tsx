"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PlatformIcon } from "@/components/PlatformIcon";
import {
  MEDIA_NAV_CATEGORIES,
  isMediaNavCategoryId,
  type MediaNavCategoryId,
  type MediaNavEntry,
} from "@/lib/media-directory";

function SiteMark({ entry }: { entry: MediaNavEntry }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        className="media-dir__mark"
        style={{ background: entry.color }}
        aria-hidden
      >
        {entry.mark}
      </span>
    );
  }
  return (
    <span className="media-dir__favicon" aria-hidden>
      {/* biome-ignore lint/performance/noImgElement: third-party favicons */}
      <img
        src={entry.favicon}
        alt=""
        width={28}
        height={28}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

function EntryCard({ entry }: { entry: MediaNavEntry }) {
  return (
    <a
      href={entry.href}
      target="_blank"
      rel="noreferrer"
      className="media-dir__item"
      title={`打开 ${entry.name}`}
    >
      {entry.platformId ? (
        <PlatformIcon platform={entry.platformId} size={28} />
      ) : (
        <SiteMark entry={entry} />
      )}
      <span className="media-dir__copy">
        <span className="media-dir__name">{entry.name}</span>
        <span className="media-dir__note">{entry.note}</span>
      </span>
      {entry.platformId ? (
        <span className="media-dir__badge">可分发</span>
      ) : (
        <span className="media-dir__go">打开</span>
      )}
    </a>
  );
}

export function MediaDirectory({ embedded = false }: { embedded?: boolean }) {
  const [active, setActive] = useState<MediaNavCategoryId | "all">("all");

  useEffect(() => {
    const apply = () => {
      const id = window.location.hash.replace(/^#/, "");
      setActive(isMediaNavCategoryId(id) ? id : "all");
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  function select(next: MediaNavCategoryId | "all") {
    setActive(next);
    const hash = next === "all" ? "" : `#${next}`;
    window.history.replaceState(null, "", `${window.location.pathname}${hash}`);
  }

  const sections = useMemo(() => {
    if (active === "all") return MEDIA_NAV_CATEGORIES;
    return MEDIA_NAV_CATEGORIES.filter((c) => c.id === active);
  }, [active]);

  const total = MEDIA_NAV_CATEGORIES.reduce(
    (n, c) => n + c.entries.length,
    0,
  );

  return (
    <div className="media-dir">
      {embedded ? null : (
      <header className="media-dir__head">
        <div>
          <h1>媒体</h1>
          <p>
            打开官网看阅读环境。标了「可分发」的也能走自有号。花钱代发去
            <Link href="/paid">付费</Link>
            。
          </p>
        </div>
        <p className="media-dir__count">{total} 个站点</p>
      </header>
      )}

      <nav className="media-dir__chips" aria-label="媒体分类">
        <button
          type="button"
          className={
            active === "all"
              ? "media-dir__chip media-dir__chip--on"
              : "media-dir__chip"
          }
          onClick={() => select("all")}
        >
          全部
        </button>
        {MEDIA_NAV_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={
              active === cat.id
                ? "media-dir__chip media-dir__chip--on"
                : "media-dir__chip"
            }
            onClick={() => select(cat.id)}
          >
            {cat.label}
            <span>{cat.entries.length}</span>
          </button>
        ))}
      </nav>

      {sections.map((cat) => (
        <section
          key={cat.id}
          id={cat.id}
          className="media-dir__section"
          aria-labelledby={`media-${cat.id}`}
        >
          <div className="media-dir__section-head">
            <h2 id={`media-${cat.id}`}>{cat.label}</h2>
            <p>{cat.hint}</p>
          </div>
          <div className="media-dir__grid">
            {cat.entries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
