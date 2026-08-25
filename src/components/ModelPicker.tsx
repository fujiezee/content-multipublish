"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AI_MODEL_BADGES,
  type AiModelBadge,
} from "@/lib/ai/model-catalog/types";

export type ModelPickerItem = {
  id: string;
  label: string;
  hint?: string;
  cost?: string;
  ready?: boolean;
  badges?: AiModelBadge[];
};

type Props = {
  value: string;
  items: ModelPickerItem[];
  disabled?: boolean;
  title?: string;
  className?: string;
  buttonClassName?: string;
  placeholder?: string;
  onChange: (next: string) => void;
};

function badgeLabel(id: AiModelBadge): string {
  return AI_MODEL_BADGES.find((b) => b.id === id)?.label || id;
}

function badgeRank(badges: AiModelBadge[] | undefined): number {
  if (!badges?.length) return 99;
  if (badges.includes("recommended")) return 0;
  if (badges.includes("hot")) return 1;
  if (badges.includes("new")) return 2;
  return 3;
}

function ModelBadges({ badges }: { badges?: AiModelBadge[] }) {
  if (!badges?.length) return null;
  return (
    <span className="model-picker__tags">
      {badges.map((b) => (
        <em key={b} className={`model-picker__tag model-picker__tag--${b}`}>
          {badgeLabel(b)}
        </em>
      ))}
    </span>
  );
}

function ModelChoice({
  item,
  active,
  onPick,
}: {
  item: ModelPickerItem;
  active: boolean;
  onPick: (id: string) => void;
}) {
  const label =
    item.ready === false ? `${item.label}（未配）` : item.label;
  return (
    <button
      type="button"
      className={`model-picker-choice${active ? " is-active" : ""}`}
      disabled={item.ready === false}
      onClick={() => onPick(item.id)}
    >
      <span className="model-picker-choice__top">
        <span className="model-picker-choice__label">{label}</span>
        <ModelBadges badges={item.badges} />
      </span>
      {item.hint || item.cost ? (
        <span className="model-picker-choice__meta">
          {item.hint ? (
            <span className="model-picker-choice__hint">{item.hint}</span>
          ) : (
            <span />
          )}
          {item.cost ? (
            <span className="model-picker-choice__cost">{item.cost}</span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

export function ModelPicker({
  value,
  items,
  disabled,
  title,
  className,
  buttonClassName,
  placeholder = "选择模型",
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const current = items.find((item) => item.id === value);

  const featured = useMemo(() => {
    return items
      .filter((item) => (item.badges?.length || 0) > 0)
      .sort((a, b) => {
        const rank = badgeRank(a.badges) - badgeRank(b.badges);
        if (rank !== 0) return rank;
        return a.label.localeCompare(b.label, "zh");
      });
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      `${item.label} ${item.hint || ""} ${item.cost || ""} ${item.id}`
        .toLowerCase()
        .includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focus = window.setTimeout(() => searchRef.current?.focus(), 0);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(focus);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(id: string) {
    onChange(id);
    setOpen(false);
  }

  const searching = Boolean(query.trim());
  const layer =
    open && typeof document !== "undefined"
      ? createPortal(
          <div className="model-picker-layer" role="presentation">
            <button
              type="button"
              className="model-picker-layer__back"
              aria-label="关闭"
              onClick={() => setOpen(false)}
            />
            <div
              className="model-picker-layer__card"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <div className="model-picker-layer__head">
                <div>
                  <p className="model-picker-layer__eyebrow">模型</p>
                  <h2 id={titleId}>{title || "选择模型"}</h2>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setOpen(false)}
                >
                  关闭
                </button>
              </div>
              <div className="model-picker-layer__toolbar">
                <input
                  ref={searchRef}
                  className="field model-picker-layer__search"
                  value={query}
                  placeholder="搜索名称、说明…"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="model-picker-layer__body">
                {!searching && featured.length > 0 ? (
                  <section className="model-picker-layer__section">
                    <h3>推荐 · 最热 · 最新</h3>
                    <ul className="model-picker-layer__grid">
                      {featured.map((item) => (
                        <li key={`feat-${item.id}`}>
                          <ModelChoice
                            item={item}
                            active={item.id === value}
                            onPick={pick}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                <section className="model-picker-layer__section">
                  <h3>
                    {searching
                      ? `搜索结果（${filtered.length}）`
                      : `全部（${filtered.length}）`}
                  </h3>
                  {filtered.length === 0 ? (
                    <p className="model-picker-layer__empty">没有匹配的模型</p>
                  ) : (
                    <ul className="model-picker-layer__grid">
                      {filtered.map((item) => (
                        <li key={item.id}>
                          <ModelChoice
                            item={item}
                            active={item.id === value}
                            onPick={pick}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={className}>
      <button
        type="button"
        className={buttonClassName || "field model-picker__btn"}
        disabled={disabled}
        title={current?.hint || title || placeholder}
        onClick={() => setOpen(true)}
      >
        <span className="model-picker__value">
          {current
            ? current.ready === false
              ? `${current.label}（未配）`
              : current.label
            : placeholder}
        </span>
        <ModelBadges badges={current?.badges} />
      </button>
      {layer}
    </div>
  );
}
