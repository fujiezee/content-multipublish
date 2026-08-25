"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MUSIC_STYLE_GROUPS,
  MUSIC_STYLES,
  composeMusicStylePrompt,
  musicStyleSummary,
  type MusicStyleGroupId,
} from "@/lib/ai/music-styles";

type Props = {
  tagIds: string[];
  extra: string;
  vocal?: "m" | "f";
  disabled?: boolean;
  onChange: (next: { tagIds: string[]; extra: string; prompt: string }) => void;
};

function groupMax(id: MusicStyleGroupId) {
  return MUSIC_STYLE_GROUPS.find((row) => row.id === id)?.max || 1;
}

export function MusicStylePicker({
  tagIds,
  extra,
  vocal,
  disabled,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState(extra);
  const [popBox, setPopBox] = useState({ top: 0, left: 0, width: 320 });
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const summary = musicStyleSummary(tagIds, extra);
  const label = summary === "选曲风" ? "华语流行" : summary;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? MUSIC_STYLES.filter((item) =>
          `${item.label} ${item.prompt}`.toLowerCase().includes(q),
        )
      : MUSIC_STYLES;
    return MUSIC_STYLE_GROUPS.map((group) => ({
      group,
      items: matched.filter((item) => item.group === group.id),
    })).filter((row) => row.items.length > 0);
  }, [query]);

  useEffect(() => {
    setNote(extra);
  }, [extra]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, window.innerWidth - 16);
      const left = Math.min(
        Math.max(8, rect.left),
        window.innerWidth - width - 8,
      );
      const maxHeight = Math.min(420, window.innerHeight - 24);
      const below = rect.bottom + 6;
      const top =
        below + maxHeight > window.innerHeight - 8
          ? Math.max(8, rect.top - maxHeight - 6)
          : below;
      setPopBox({ top, left, width });
    };
    place();
    const focus = window.setTimeout(() => searchRef.current?.focus(), 0);
    function onDoc(event: MouseEvent) {
      const node = event.target as Node;
      if (rootRef.current?.contains(node) || popRef.current?.contains(node)) {
        return;
      }
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.clearTimeout(focus);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  function emit(nextTags: string[], nextExtra: string) {
    onChange({
      tagIds: nextTags,
      extra: nextExtra,
      prompt: composeMusicStylePrompt(nextTags, nextExtra, vocal),
    });
  }

  function toggle(id: string, group: MusicStyleGroupId) {
    const max = groupMax(group);
    const inGroup = MUSIC_STYLES.filter((row) => row.group === group).map(
      (row) => row.id,
    );
    const next = tagIds.includes(id)
      ? tagIds.filter((row) => row !== id)
      : [
          ...tagIds.filter((row) => !inGroup.includes(row)),
          ...(max === 1
            ? [id]
            : [...tagIds.filter((row) => inGroup.includes(row)), id].slice(
                -max,
              )),
        ];
    emit(next, note.trim());
  }

  return (
    <div ref={rootRef} className="search-select lyric-style">
      <button
        type="button"
        className="search-select__btn field"
        disabled={disabled}
        title={label}
        onClick={() => setOpen((cur) => !cur)}
      >
        <span className="search-select__value">{label}</span>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popRef}
              className="search-select__pop lyric-style__pop"
              role="listbox"
              aria-label="曲风"
              style={{
                top: popBox.top,
                left: popBox.left,
                width: popBox.width,
              }}
            >
              <input
                ref={searchRef}
                className="search-select__search"
                value={query}
                placeholder="搜曲风、情绪、节奏"
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="lyric-style__list">
                {filtered.map((row) => (
                  <section key={row.group.id}>
                    <p className="search-select__group">
                      {row.group.label}
                      <span> {row.group.hint}</span>
                    </p>
                    <div className="lyric-style__chips">
                      {row.items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`script-toolbar__chip${
                            tagIds.includes(item.id) ? " is-on" : ""
                          }`}
                          title={item.prompt}
                          onClick={() => toggle(item.id, item.group)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
                {filtered.length === 0 ? (
                  <p className="search-select__empty">没有匹配的曲风</p>
                ) : null}
              </div>
              <input
                className="search-select__search lyric-style__extra"
                value={note}
                placeholder="补充，如琵琶前奏"
                onChange={(event) => setNote(event.target.value)}
                onBlur={() => emit(tagIds, note.trim())}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    emit(tagIds, note.trim());
                    setOpen(false);
                  }
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
