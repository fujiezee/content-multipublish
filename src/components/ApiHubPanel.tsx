"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { AiModelView, AiModality } from "@/lib/ai/model-catalog/types";
import {
  API_PRICE_TIERS,
  API_PUBLIC_BASE,
  type ApiPriceTier,
} from "@/lib/billing/markup";
import { formatFenExact, formatYuan } from "@/lib/billing/plans";
import { modelHasBillablePrice } from "@/lib/ai/model-catalog/pricing";

type PricingMeta = {
  paidRechargeYuan: number;
  tierId: string;
  tierName: string;
  markup: number;
  markupLabel: string;
};

type TokenRow = {
  id: string;
  label: string;
  token: string;
  tokenPreview: string;
  createdAt: string;
  lastUsedAt: string | null;
};

const MODALITY_TABS: { id: AiModality | "all"; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "text", label: "文本" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "audio", label: "语音" },
  { id: "music", label: "音乐" },
];

function billUnitLabel(unit: string | undefined): string {
  if (unit === "1m_tokens") return "百万 token";
  if (unit === "image") return "张";
  if (unit === "video_sec") return "秒";
  if (unit === "request") return "次";
  return unit || "—";
}

function formatOfficial(model: AiModelView): string {
  const p = model.pricing;
  if (!p) return "—";
  if (p.billUnit === "1m_tokens") {
    const inn =
      p.official.inputFen != null ? formatFenExact(p.official.inputFen) : null;
    const out =
      p.official.outputFen != null ? formatFenExact(p.official.outputFen) : null;
    if (inn && out) return `入 ${inn} / 出 ${out}`;
    return inn || out || "—";
  }
  return p.official.fen != null ? formatFenExact(p.official.fen) : "—";
}

function formatSell(model: AiModelView): string {
  const p = model.pricing;
  if (!p) return "—";
  if (p.billUnit === "1m_tokens") {
    const inn = p.sell.inputFen != null ? formatFenExact(p.sell.inputFen) : null;
    const out = p.sell.outputFen != null ? formatFenExact(p.sell.outputFen) : null;
    if (inn && out) return `入 ${inn} / 出 ${out}`;
    return inn || out || "—";
  }
  return p.sell.fen != null ? formatFenExact(p.sell.fen) : "—";
}

function isApiToken(token: string) {
  return token.startsWith("dwapi_");
}

function maskToken(token: string): string {
  const raw = String(token || "");
  if (raw.length <= 12) return "••••••••";
  return `${raw.slice(0, 10)}${"•".repeat(Math.min(18, raw.length - 10))}`;
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg
      className="api-hub__icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {open ? (
        <>
          <path d="M3.5 12s3.2-6 8.5-6 8.5 6 8.5 6-3.2 6-8.5 6-8.5-6-8.5-6z" />
          <circle cx="12" cy="12" r="2.3" />
        </>
      ) : (
        <path d="M4 5.5 19.5 19M9.4 9.2A3.2 3.2 0 0 0 12 15.2M7 8.2C5 9.5 3.7 11.3 3.5 12c0 0 3.2 6 8.5 6 1.5 0 2.9-.4 4.1-1.1M16.7 14.6C18.4 13.4 19.7 12 20.5 12c0 0-3.2-6-8.5-6-.8 0-1.6.1-2.3.3" />
      )}
    </svg>
  );
}

function SecretTokenField({
  token,
  emphasize,
  trailing,
}: {
  token: string;
  emphasize?: boolean;
  trailing?: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={`api-hub__secret${emphasize ? " is-new" : ""}`}>
      <code className="api-hub__secret-value" title={visible ? token : undefined}>
        {visible ? token : maskToken(token)}
      </code>
      <div className="api-hub__secret-actions">
        <button
          type="button"
          className="btn btn-ghost api-hub__secret-btn"
          aria-label={visible ? "隐藏密钥" : "显示密钥"}
          title={visible ? "隐藏" : "显示"}
          onClick={() => setVisible((v) => !v)}
        >
          <EyeIcon open={visible} />
        </button>
        <button
          type="button"
          className="btn btn-ghost api-hub__secret-btn"
          onClick={() => void copy()}
        >
          {copied ? "已复制" : "复制"}
        </button>
        {trailing}
      </div>
    </div>
  );
}

export function ApiHubPanel() {
  const [models, setModels] = useState<AiModelView[]>([]);
  const [pricing, setPricing] = useState<PricingMeta | null>(null);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [tab, setTab] = useState<AiModality | "all">("all");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastToken, setLastToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh(silent = false) {
    setError(null);
    if (!silent) setLoading(true);
    try {
      const [modelsRes, tokRes] = await Promise.all([
        fetch("/api/models", { cache: "no-store" }),
        fetch("/api/auth/extension-token", { cache: "no-store" }),
      ]);
      const modelsData = (await modelsRes.json()) as {
        models?: AiModelView[];
        pricing?: PricingMeta;
        error?: string;
      };
      if (!modelsRes.ok) throw new Error(modelsData.error || "加载模型失败");
      const rows = Array.isArray(modelsData.models) ? modelsData.models : [];
      // API 页只展示已启用且通道可用的模型
      setModels(rows.filter((m) => m.enabled && m.ready && modelHasBillablePrice(m)));
      if (modelsData.pricing) setPricing(modelsData.pricing);

      const tokData = (await tokRes.json()) as { tokens?: TokenRow[] };
      const all = Array.isArray(tokData.tokens) ? tokData.tokens : [];
      setTokens(all.filter((t) => isApiToken(t.token)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    const list = tab === "all" ? models : models.filter((m) => m.modality === tab);
    return [...list].sort((a, b) => {
      if (a.modality !== b.modality) return a.modality.localeCompare(b.modality);
      return a.sortOrder - b.sortOrder || a.label.localeCompare(b.label);
    });
  }, [models, tab]);

  const currentTier: ApiPriceTier =
    API_PRICE_TIERS.find((t) => t.id === pricing?.tierId) || API_PRICE_TIERS[0];

  async function createKey() {
    setBusy(true);
    setMessage(null);
    setLastToken(null);
    try {
      const res = await fetch("/api/auth/extension-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "api", label: "API 调用" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      setLastToken(data.token?.token || null);
      setMessage("已生成 API 密钥，可点击眼睛查看并复制");
      await refresh(true);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(id: string) {
    if (!confirm("作废这把 API 密钥？")) return;
    setBusy(true);
    try {
      await fetch("/api/auth/extension-token", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await refresh(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="api-hub space-y-6">
      <header className="api-hub__hero">
        <p className="api-hub__kicker">模型 API</p>
        <h1>模型计价与调用</h1>
        <p>
          OpenAI 兼容基址{" "}
          <code className="api-hub__code">{API_PUBLIC_BASE}/v1</code>
        </p>
        <p className="api-hub__docs-entry">
          <Link href="/api-hub/docs" className="btn btn-primary">
            调用文档
          </Link>
          <span className="text-sm text-[var(--muted)]">
            curl / Python / Node，通用 OpenAI SDK
          </span>
        </p>
        {pricing ? (
          <p className="api-hub__status">
            累计充值 {formatYuan(pricing.paidRechargeYuan)} · 当前{" "}
            <strong>{pricing.markupLabel}</strong>
            {" · "}
            <Link href="/plan#recharge" className="underline">
              去充值
            </Link>
          </p>
        ) : null}
      </header>

      {error ? (
        <div className="card px-4 py-3 text-sm text-[var(--danger)]">{error}</div>
      ) : null}
      {message ? (
        <div className="card px-4 py-3 text-sm text-[var(--ok)]">{message}</div>
      ) : null}

      <section className="api-hub__tiers">
        <h2>计费套餐</h2>
        <p className="text-sm text-[var(--muted)]">
          按工作区累计充值金额自动升档，全站模型统一加价系数。
        </p>
        <ul className="api-hub__tier-grid">
          {API_PRICE_TIERS.map((tier) => {
            const on = tier.id === currentTier.id;
            return (
              <li
                key={tier.id}
                className={`card api-hub__tier${on ? " is-on" : ""}`}
              >
                <div className="api-hub__tier-top">
                  <h3>{tier.name}</h3>
                  {on ? <span>当前</span> : null}
                </div>
                <p className="api-hub__tier-mul">官网价 ×{tier.markup}</p>
                <p className="text-sm text-[var(--muted)]">{tier.hint}</p>
                {tier.minPaidYuan > 0 ? (
                  <p className="api-hub__tier-need">
                    门槛 {formatYuan(tier.minPaidYuan)}
                  </p>
                ) : (
                  <p className="api-hub__tier-need">无门槛</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card api-hub__keys">
        <div className="api-hub__keys-head">
          <div>
            <h2>API 密钥</h2>
            <p className="text-sm text-[var(--muted)]">
              Authorization: Bearer dwapi_…
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void createKey()}
          >
            {busy ? "生成中…" : "生成密钥"}
          </button>
        </div>
        {lastToken ? <SecretTokenField token={lastToken} emphasize /> : null}
        {tokens.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">还没有 API 密钥。</p>
        ) : (
          <ul className="api-hub__token-list">
            {tokens.map((t) => (
              <li key={t.id}>
                <div className="api-hub__token-main">
                  <strong>{t.label}</strong>
                  <SecretTokenField
                    token={t.token}
                    trailing={
                      <button
                        type="button"
                        className="btn btn-ghost api-hub__secret-btn"
                        disabled={busy}
                        onClick={() => void revokeKey(t.id)}
                      >
                        作废
                      </button>
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card api-hub__catalog">
        <div className="api-hub__catalog-head">
          <h2>模型目录</h2>
          <nav className="api-hub__tabs" aria-label="模态">
            {MODALITY_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tab === item.id ? "btn btn-primary" : "btn btn-ghost"}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="api-hub__table-wrap">
          <table className="api-hub__table">
            <thead>
              <tr>
                <th>模型</th>
                <th>模态</th>
                <th>计量</th>
                <th>官方价</th>
                <th>你的售价</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? [0, 1, 2, 3, 4, 5].map((i) => (
                    <tr key={`skel-${i}`} className="catalog-skel-row">
                      <td colSpan={5}>
                        <span className="catalog-skel-bar" />
                      </td>
                    </tr>
                  ))
                : filtered.map((model) => (
                <tr key={model.id}>
                  <td>
                    <strong>{model.label}</strong>
                    <em>{model.slug}</em>
                  </td>
                  <td>{model.modality}</td>
                  <td>{billUnitLabel(model.pricing?.billUnit)}</td>
                  <td>{formatOfficial(model)}</td>
                  <td>{formatSell(model)}</td>
                </tr>
              ))}
              {!loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="api-hub__empty">
                    暂无已启用模型。管理员可在后台启用并配置密钥。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
