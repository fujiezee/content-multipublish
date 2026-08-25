"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LOOK_STYLE_GROUPS,
  LOOK_STYLES,
  resolveLookStyle,
} from "@/lib/ai/look-styles";

type Props = {
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
};

export function LookStyleSelect({ value, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [popBox, setPopBox] = useState({ top: 0, left: 0, width: 520 });
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const current = resolveLookStyle(value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? LOOK_STYLES.filter((item) =>
          `${item.label} ${item.hint} ${item.group}`.toLowerCase().includes(q),
        )
      : LOOK_STYLES;
    return LOOK_STYLE_GROUPS.map((group) => ({
      group,
      items: matched.filter((item) => item.group === group),
    })).filter((row) => row.items.length > 0);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(560, window.innerWidth - 16);
      const left = Math.min(
        Math.max(8, rect.right - width),
        window.innerWidth - width - 8,
      );
      const maxHeight = Math.min(520, window.innerHeight - 24);
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

  return (
    <div
      ref={rootRef}
      className="look-select"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="look-select__btn field"
        disabled={disabled}
        title={`${current.label}。${current.hint}。改完要重出角色图和分镜，出片跟静帧走。`}
        onClick={() => setOpen((next) => !next)}
      >
        <img
          className="look-select__chip"
          src={current.preview}
          alt=""
          width={22}
          height={36}
        />
        <span className="look-select__value">{current.label}</span>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popRef}
              className="look-select__pop"
              role="listbox"
              aria-label="合集画风"
              style={{
                top: popBox.top,
                left: popBox.left,
                width: popBox.width,
              }}
            >
              <input
                ref={searchRef}
                className="look-select__search"
                value={query}
                placeholder="搜画风，点图就选"
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="look-select__list">
                {filtered.map((row) => (
                  <section key={row.group} className="look-select__section">
                    <h4>{row.group}</h4>
                    <div className="look-select__grid">
                      {row.items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`look-select__card${
                            item.id === current.id ? " is-active" : ""
                          }`}
                          title={item.hint}
                          onClick={() => {
                            onChange(item.id);
                            setOpen(false);
                          }}
                        >
                          <img src={item.preview} alt={item.label} />
                          <span>
                            {item.label}
                            {item.tested ? <em>过审</em> : null}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
                {filtered.length === 0 ? (
                  <p className="look-select__empty">没有匹配的画风</p>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
