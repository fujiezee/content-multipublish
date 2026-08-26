"use client";

import { useCallback, useEffect, useState } from "react";

type Kind = "article" | "podcast" | "script";

type RuleChip = {
  id: string;
  rule: string;
  enabled: boolean;
};

type LogItem = {
  id: string;
  message: string;
  changed: boolean;
};

type Props = {
  kind: Kind;
  text: string;
  reviewModel?: string;
  disabled?: boolean;
  confirmLabel?: string;
  confirming?: boolean;
  onText: (text: string) => void | Promise<void>;
  onConfirm?: () => void | Promise<void>;
};

async function loadRules(): Promise<RuleChip[]> {
  const res = await fetch("/api/ai/human-talk/memory", { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as {
    rules?: RuleChip[];
  };
  return Array.isArray(data.rules) ? data.rules : [];
}

export function HumanTalkRevise({
  kind,
  text,
  reviewModel,
  disabled,
  confirmLabel,
  confirming,
  onText,
  onConfirm,
}: Props) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<RuleChip[]>([]);
  const [log, setLog] = useState<LogItem[]>([]);

  const refreshRules = useCallback(async () => {
    try {
      setRules(await loadRules());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refreshRules();
  }, [refreshRules]);

  async function revise() {
    const note = message.replace(/\s+/g, " ").trim();
    if (!note || busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/human-talk/revise", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          text,
          message: note,
          reviewModel,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        text?: string;
        changed?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "改稿失败");
      const next = String(data.text || "").trim();
      if (next && next !== text) await onText(next);
      setLog((rows) =>
        [
          {
            id: `${Date.now()}`,
            message: note,
            changed: Boolean(data.changed),
          },
          ...rows,
        ].slice(0, 6),
      );
      setMessage("");
      await refreshRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "改稿失败");
    } finally {
      setBusy(false);
    }
  }

  async function toggleRule(rule: RuleChip) {
    try {
      const res = await fetch("/api/ai/human-talk/memory", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: rule.id, enabled: !rule.enabled }),
      });
      if (!res.ok) return;
      await refreshRules();
    } catch {
      // ignore
    }
  }

  const enabledRules = rules.filter((row) => row.enabled);
  const locked = Boolean(disabled || busy || confirming);

  return (
    <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--bg-soft,transparent)] p-3">
      <div>
        <p className="text-sm font-medium">对话改稿</p>
        <p className="text-xs text-[var(--muted)]">
          哪句假、接不上，直接说。改到你点头再往下落。
        </p>
      </div>
      {enabledRules.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {enabledRules.map((row) => (
            <button
              key={row.id}
              type="button"
              className="rounded-full border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--muted)]"
              title="关掉这条口味"
              disabled={locked}
              onClick={() => void toggleRule(row)}
            >
              {row.rule} ×
            </button>
          ))}
        </div>
      ) : null}
      {log.length > 0 ? (
        <ul className="space-y-1 text-xs text-[var(--muted)]">
          {log.map((item) => (
            <li key={item.id}>
              「{item.message}」{item.changed ? " · 已改" : " · 没改动"}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <input
          className="field min-w-[12rem] flex-1"
          value={message}
          disabled={locked}
          placeholder="比如：问完不要先别答"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void revise();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-ghost"
          disabled={locked || !message.trim() || !text.trim()}
          onClick={() => void revise()}
        >
          {busy ? "在改…" : "改这一稿"}
        </button>
        {onConfirm ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={Boolean(disabled || busy || confirming) || !text.trim()}
            onClick={() => void onConfirm()}
          >
            {confirming ? "落成中…" : confirmLabel || "确认落成"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-[var(--danger)]">{error}</p>
      ) : null}
    </div>
  );
}
