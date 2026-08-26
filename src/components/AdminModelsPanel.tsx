"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AiModelBadge,
  AiModelUse,
  AiModelView,
  AiModality,
  AiProviderChannel,
} from "@/lib/ai/model-catalog/types";
import { resolveModelOfficialPricing, tierSellPreview } from "@/lib/ai/model-catalog/pricing";

type Meta = {
  modalities: { id: AiModality; label: string }[];
  uses: { id: AiModelUse; label: string; modality: AiModality }[];
  providers: { id: AiProviderChannel; label: string }[];
  badges?: { id: AiModelBadge; label: string; hint: string }[];
};

const emptyForm = {
  slug: "",
  label: "",
  hint: "",
  modality: "text" as AiModality,
  uses: [] as AiModelUse[],
  provider: "deepseek" as AiProviderChannel,
  providerModel: "",
  costHint: "",
  fallbackSlug: "",
  sortOrder: 0,
  enabled: true,
  badges: [] as AiModelBadge[],
};

function modalityLabel(meta: Meta | null, id: AiModality) {
  return meta?.modalities.find((m) => m.id === id)?.label || id;
}

function providerLabel(meta: Meta | null, id: AiProviderChannel) {
  return meta?.providers.find((p) => p.id === id)?.label || id;
}

function useLabels(meta: Meta | null, uses: AiModelUse[]) {
  if (!uses.length) return "—";
  return uses
    .map((id) => meta?.uses.find((u) => u.id === id)?.label || id)
    .join(" · ");
}

function StatusBadge({ model }: { model: AiModelView }) {
  if (!model.enabled) {
    return <span className="admin-status admin-status--off">停用</span>;
  }
  if (model.ready) {
    return <span className="admin-status admin-status--ok">可用</span>;
  }
  return <span className="admin-status admin-status--warn">缺 Key</span>;
}

export function AdminModelsPanel() {
  const [models, setModels] = useState<AiModelView[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [tab, setTab] = useState<AiModality | "all">("all");
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const refresh = useCallback(async (silent = false) => {
    setLoadError(null);
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/admin/models", { cache: "no-store" });
      if (res.status === 403) {
        setLoadError("没有管理权限");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLoadError((data.error as string) || `加载失败（${res.status}）`);
        return;
      }
      const data = await res.json();
      setModels((data.models as AiModelView[]) ?? []);
      setMeta((data.meta as Meta) ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    if (tab === "all") return models;
    return models.filter((m) => m.modality === tab);
  }, [models, tab]);

  const current = models.find((m) => m.id === editingId) ?? null;

  const useOptions = useMemo(() => {
    return meta?.uses.filter((u) => u.modality === form.modality) ?? [];
  }, [meta, form.modality]);

  const counts = useMemo(() => {
    const all = models.length;
    const ready = models.filter((m) => m.enabled && m.ready).length;
    return { all, ready };
  }, [models]);

  function startCreate() {
    setEditingId(null);
    setCreating(true);
    setMessage(null);
    setForm({
      ...emptyForm,
      modality: tab === "all" ? "text" : tab,
    });
  }

  function startEdit(model: AiModelView) {
    setCreating(false);
    setEditingId(model.id);
    setMessage(null);
    setForm({
      slug: model.slug,
      label: model.label,
      hint: model.hint,
      modality: model.modality,
      uses: model.uses,
      provider: model.provider,
      providerModel: model.providerModel,
      costHint: model.costHint,
      fallbackSlug: model.fallbackSlug,
      sortOrder: model.sortOrder,
      enabled: model.enabled,
      badges: model.badges || [],
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setCreating(false);
    setForm(emptyForm);
    setMessage(null);
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(
        editingId ? `/api/admin/models/${editingId}` : "/api/admin/models",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      const saved = data.model as AiModelView | undefined;
      if (saved?.id) {
        setCreating(false);
        setEditingId(saved.id);
      }
      setMessage("已保存");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
      return;
    } finally {
      setBusy(false);
    }
    void refresh(true);
  }

  async function remove(id: string, label: string) {
    if (!confirm(`删除模型「${label}」？`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/models/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");
      setMessage("已删除");
      if (editingId === id) cancelEdit();
      await refresh(true);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function syncProxy() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/models/sync-proxy", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "同步失败");
      setMessage(data.message || "已同步");
      await refresh(true);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "同步失败");
    } finally {
      setBusy(false);
    }
  }

  async function syncQwen() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/models/sync-qwen", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "同步失败");
      setMessage(data.message || "已同步");
      await refresh(true);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "同步失败");
    } finally {
      setBusy(false);
    }
  }

  async function syncCursor() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/models/sync-cursor", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "同步失败");
      setMessage(data.message || "已同步");
      await refresh(true);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "同步失败");
    } finally {
      setBusy(false);
    }
  }

  async function syncPrices() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/models/sync-prices", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "同步失败");
      setMessage(data.message || "已同步价格");
      await refresh(true);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "同步失败");
    } finally {
      setBusy(false);
    }
  }

  async function syncArk() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/models/sync-ark", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "同步失败");
      setMessage(data.message || "已同步");
      await refresh(true);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "同步失败");
    } finally {
      setBusy(false);
    }
  }

  async function syncCloudflare() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/models/sync-cloudflare", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "同步失败");
      setMessage(data.message || "已同步");
      await refresh(true);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "同步失败");
    } finally {
      setBusy(false);
    }
  }

  function toggleUse(use: AiModelUse) {
    setForm((prev) => ({
      ...prev,
      uses: prev.uses.includes(use)
        ? prev.uses.filter((u) => u !== use)
        : [...prev.uses, use],
    }));
  }

  function toggleBadge(badge: AiModelBadge) {
    setForm((prev) => ({
      ...prev,
      badges: prev.badges.includes(badge)
        ? prev.badges.filter((b) => b !== badge)
        : [...prev.badges, badge],
    }));
  }

  const showEditor = creating || editingId !== null;

  if (loadError) {
    return <p className="text-sm text-[var(--danger)]">{loadError}</p>;
  }

  return (
    <>
      <div className="admin-models__toolbar">
        <nav className="admin-models__filters" aria-label="模态筛选">
          {(["all", "text", "image", "video", "audio", "music"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={tab === key ? "btn btn-primary" : "btn btn-ghost"}
              onClick={() => setTab(key)}
            >
              {key === "all"
                ? `全部 (${counts.all})`
                : modalityLabel(meta, key)}
            </button>
          ))}
        </nav>
        <div className="admin-models__toolbar-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void syncProxy()}
            title="从 OPENAI_BASE_URL/models 拉取，补全代理站支持的模型"
          >
            {busy ? "同步中…" : "同步代理"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void syncQwen()}
            title="从百炼 MaaS compatible-mode/v1/models 拉取千问等模型"
          >
            同步千问
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void syncCursor()}
            title="从 Cursor API /v1/models 拉取 Composer / Grok 等"
          >
            同步 Cursor
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void syncPrices()}
            title="按内置官方价目表回填全部模型价格"
          >
            同步价格
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void syncArk()}
            title="从火山方舟 /models 拉取，并写入官方刊例价"
          >
            同步方舟
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void syncCloudflare()}
            title="从 Cloudflare 统一目录 + Workers AI 拉取全部模型（文/图/视频/音乐）"
          >
            同步 Cloudflare
          </button>
          <button type="button" className="btn btn-primary" onClick={startCreate}>
            + 新增模型
          </button>
        </div>
      </div>

      <p className="admin-models__hint">
        {loading
          ? "正在加载模型目录…"
          : `共 ${counts.all} 条，${counts.ready} 条可用。slug 即前台下拉 value；上游 model id 发给通道 API。`}
      </p>

      <div className="admin-billing__layout admin-models__layout">
        <div className="card admin-table-wrap">
          <table className="admin-table admin-models-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>模态</th>
                <th>通道</th>
                <th>用途</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? [0, 1, 2, 3, 4, 5, 6].map((i) => (
                    <tr key={`skel-${i}`} className="catalog-skel-row">
                      <td colSpan={5}>
                        <span className="catalog-skel-bar" />
                      </td>
                    </tr>
                  ))
                : filtered.map((model) => (
                <tr
                  key={model.id}
                  className={editingId === model.id ? "is-on" : undefined}
                  onClick={() => startEdit(model)}
                >
                  <td className="admin-models-table__name">
                    <strong>{model.label}</strong>
                    <em>{model.slug}</em>
                    {model.badges?.length ? (
                      <span className="admin-models-table__badges">
                        {model.badges.map((b) => (
                          <i key={b}>
                            {meta?.badges?.find((row) => row.id === b)?.label || b}
                          </i>
                        ))}
                      </span>
                    ) : null}
                    {model.hint ? (
                      <span className="admin-models-table__hint">{model.hint}</span>
                    ) : null}
                  </td>
                  <td>{modalityLabel(meta, model.modality)}</td>
                  <td>{providerLabel(meta, model.provider)}</td>
                  <td className="admin-models-table__uses">
                    {useLabels(meta, model.uses)}
                  </td>
                  <td>
                    <StatusBadge model={model} />
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="admin-table__empty">
                    还没有模型。点「新增模型」添加。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <section className="card admin-edit admin-models-edit">
          {!showEditor ? (
            <p className="text-sm text-[var(--muted)]">
              {loading ? "正在加载…" : "点左边一行编辑，或点「新增模型」。"}
            </p>
          ) : (
            <>
              <h2>{editingId ? "编辑模型" : "新增模型"}</h2>
              {current ? (
                <p className="text-sm text-[var(--muted)]">
                  {current.providerModel || current.slug}
                  {current.costHint ? ` · ${current.costHint}` : ""}
                </p>
              ) : null}
              {current ? (
                <p className="text-sm text-[var(--muted)]">
                  三档售价：
                  {tierSellPreview(
                    resolveModelOfficialPricing(current) || current.config?.pricing,
                  )}
                </p>
              ) : null}

              <label className="admin-field">
                <span>显示名</span>
                <input
                  className="field"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
              </label>

              <label className="admin-field">
                <span>slug（前台 value）</span>
                <input
                  className="field font-mono"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                />
              </label>

              <div className="admin-adds">
                <label className="admin-field">
                  <span>模态</span>
                  <select
                    className="field"
                    value={form.modality}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        modality: e.target.value as AiModality,
                        uses: [],
                      })
                    }
                  >
                    {(meta?.modalities ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-field">
                  <span>通道</span>
                  <select
                    className="field"
                    value={form.provider}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        provider: e.target.value as AiProviderChannel,
                      })
                    }
                  >
                    {(meta?.providers ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="admin-field">
                <span>上游 model id</span>
                <input
                  className="field font-mono"
                  value={form.providerModel}
                  onChange={(e) =>
                    setForm({ ...form, providerModel: e.target.value })
                  }
                  placeholder="如 deepseek-reasoner、anthropic/claude-sonnet-4"
                />
              </label>

              <label className="admin-field">
                <span>说明</span>
                <input
                  className="field"
                  value={form.hint}
                  onChange={(e) => setForm({ ...form, hint: e.target.value })}
                  placeholder="写优势，例如对白稳、改得快。不要写通道"
                />
              </label>

              <div>
                <p className="admin-models-edit__label">前台场景</p>
                <div className="admin-models-edit__uses">
                  {useOptions.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className={
                        form.uses.includes(u.id) ? "btn btn-primary" : "btn btn-ghost"
                      }
                      onClick={() => toggleUse(u.id)}
                    >
                      {u.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="admin-adds">
                <label className="admin-field">
                  <span>排序</span>
                  <input
                    className="field"
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        sortOrder: Number(e.target.value) || 0,
                      })
                    }
                  />
                </label>
                <label className="admin-field">
                  <span>费用提示</span>
                  <input
                    className="field"
                    value={form.costHint}
                    onChange={(e) =>
                      setForm({ ...form, costHint: e.target.value })
                    }
                    placeholder="如 约 ¥0.02/集"
                  />
                </label>
              </div>

              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) =>
                    setForm({ ...form, enabled: e.target.checked })
                  }
                />
                启用
              </label>

              {(meta?.badges?.length || 0) > 0 ? (
                <div className="admin-models-edit__uses">
                  <p className="admin-models-edit__label">前台推荐标记</p>
                  <p className="text-xs text-[var(--muted)]">
                    勾上后会出现在写稿 / 写剧本弹层的「推荐」区。
                  </p>
                  <div className="admin-models-edit__use-list">
                    {meta!.badges!.map((b) => (
                      <label key={b.id} className="admin-check">
                        <input
                          type="checkbox"
                          checked={form.badges.includes(b.id)}
                          onChange={() => toggleBadge(b.id)}
                        />
                        {b.label}
                        <span className="text-xs text-[var(--muted)]">
                          {b.hint}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {message ? <p className="text-sm">{message}</p> : null}

              <div className="admin-models-edit__actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  {busy ? "保存中…" : "保存"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={cancelEdit}
                >
                  取消
                </button>
                {editingId ? (
                  <button
                    type="button"
                    className="btn btn-ghost admin-models-edit__delete"
                    disabled={busy}
                    onClick={() =>
                      void remove(editingId, form.label || form.slug)
                    }
                  >
                    删除
                  </button>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
