"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SearchSelectItem = {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  items: SearchSelectItem[];
  groups?: string[];
  disabled?: boolean;
  title?: string;
  className?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  onChange: (next: string) => void;
};

export function SearchSelect({
  value,
  items,
  groups,
  disabled,
  title,
  className,
  placeholder = "请选择",
  searchPlaceholder = "搜索",
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [popBox, setPopBox] = useState({ top: 0, left: 0, width: 248 });
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const current = items.find((item) => item.id === value);
  const groupOrder = groups?.length
    ? groups
    : [...new Set(items.map((item) => item.group).filter(Boolean))] as string[];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? items.filter((item) =>
          `${item.label} ${item.hint || ""} ${item.group || ""}`
            .toLowerCase()
            .includes(q),
        )
      : items;
    const grouped = groupOrder
      .map((group) => ({
        group,
        items: matched.filter((item) => item.group === group),
      }))
      .filter((row) => row.items.length > 0);
    const loose = matched.filter((item) => !item.group);
    return { grouped, loose };
  }, [items, query, groupOrder]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 248), window.innerWidth - 16);
      const left = Math.min(
        Math.max(8, rect.left),
        window.innerWidth - width - 8,
      );
      const below = rect.bottom + 6;
      const maxHeight = 320;
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
      className={`search-select ${className || ""}`}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="search-select__btn field"
        disabled={disabled}
        title={title || current?.hint || current?.label || placeholder}
        onClick={() => setOpen((next) => !next)}
      >
        <span className="search-select__value">
          {current?.label || placeholder}
        </span>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popRef}
              className="search-select__pop"
              role="listbox"
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
                placeholder={searchPlaceholder}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="search-select__list">
                {filtered.grouped.map((row) => (
                  <div key={row.group}>
                    <div className="search-select__group">{row.group}</div>
                    {row.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={item.disabled}
                        className={`search-select__item${
                          item.id === value ? " is-active" : ""
                        }`}
                        onClick={() => {
                          if (item.disabled) return;
                          onChange(item.id);
                          setOpen(false);
                        }}
                      >
                        <span>{item.label}</span>
                        {item.hint ? <small>{item.hint}</small> : null}
                      </button>
                    ))}
                  </div>
                ))}
                {filtered.loose.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={item.disabled}
                    className={`search-select__item${
                      item.id === value ? " is-active" : ""
                    }`}
                    onClick={() => {
                      if (item.disabled) return;
                      onChange(item.id);
                      setOpen(false);
                    }}
                  >
                    <span>{item.label}</span>
                    {item.hint ? <small>{item.hint}</small> : null}
                  </button>
                ))}
                {filtered.grouped.length === 0 && filtered.loose.length === 0 ? (
                  <p className="search-select__empty">没有匹配的选项</p>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
