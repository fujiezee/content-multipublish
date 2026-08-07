"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CorpusCategory, CorpusItem } from "@/lib/types";
import { CORPUS_CATEGORIES } from "@/lib/types";

function normalizeCategory(value: string): CorpusCategory {
  return CORPUS_CATEGORIES.some((c) => c.id === value)
    ? (value as CorpusCategory)
    : "other";
}

async function readApiJson(res: Response) {
  const text = await res.text();
  if (!text.trim()) {
    return {
      ok: res.ok,
      data: null as Record<string, unknown> | null,
      empty: true,
    };
  }
  try {
    return {
      ok: res.ok,
      data: JSON.parse(text) as Record<string, unknown>,
      empty: false,
    };
  } catch {
    throw new Error(`服务器返回异常（HTTP ${res.status}）`);
  }
}

export function CorpusPanel() {
  const formRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<CorpusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<CorpusCategory>("brand");
  const [tags, setTags] = useState("");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/corpus", { cache: "no-store" });
      const { ok, data, empty } = await readApiJson(res);
      if (!ok || !data) {
        setMessage(empty ? "加载语料失败：服务无响应，请稍后重试" : "加载语料失败");
        setItems([]);
        return;
      }
      setItems((data.items as CorpusItem[] | undefined) ?? []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "加载语料失败");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setCategory("brand");
    setTags("");
    setContent("");
  }

  function startEdit(item: CorpusItem) {
    setEditingId(item.id);
    setTitle(item.title);
    setCategory(normalizeCategory(item.category));
    setTags(item.tags);
    setContent(item.content);
    setMessage(`正在编辑：${item.title}`);
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function save() {
    if (!title.trim() || !content.trim()) {
      setMessage("请填写标题和内容");
      return;
    }
    const wasEditing = Boolean(editingId);
    setSaving(true);
    setMessage(null);
    try {
      const payload = { title, category, tags, content };
      const res = await fetch(
        editingId ? `/api/corpus/${editingId}` : "/api/corpus",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const { ok, data, empty } = await readApiJson(res);
      if (!ok || !data) {
        setMessage(
          (data?.error as string | undefined) ||
            (empty ? "保存失败：服务无响应，请确认开发服务已启动后重试" : "保存失败"),
        );
        return;
      }
      resetForm();
      await load();
      setMessage(wasEditing ? "已更新" : "已添加");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("确定删除这条语料？")) return;
    await fetch(`/api/corpus/${id}`, { method: "DELETE" });
    if (editingId === id) resetForm();
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">语料库</h1>
        <p className="mt-1 text-[var(--muted)]">
          沉淀品牌、故事、产品素材，供 AI 写文案时引用
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div
          ref={formRef}
          id="corpus-editor"
          className={`card space-y-4 p-5 scroll-mt-24 transition-shadow ${
            editingId
              ? "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]"
              : ""
          }`}
        >
          <h2 className="text-lg font-medium">
            {editingId ? "编辑语料" : "新建语料"}
          </h2>
          <input
            className="field w-full"
            placeholder="标题，如：品牌起源、核心产品卖点"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {CORPUS_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`btn text-sm ${category === c.id ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setCategory(c.id)}
                title={c.hint}
              >
                {c.label}
              </button>
            ))}
          </div>
          <input
            className="field w-full"
            placeholder="标签（可选，逗号分隔）"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <textarea
            className="field min-h-[220px] w-full resize-y font-mono text-sm leading-relaxed"
            placeholder="粘贴品牌介绍、个人故事、产品说明、范文等…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? "保存中…" : editingId ? "保存修改" : "添加到语料库"}
            </button>
            {editingId && (
              <button type="button" className="btn btn-ghost" onClick={resetForm}>
                取消编辑
              </button>
            )}
          </div>
          {message && (
            <p className="text-sm text-[var(--accent)]">{message}</p>
          )}
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-medium">
            已有语料 {items.length > 0 ? `（${items.length}）` : ""}
          </h2>
          {loading ? (
            <div className="card p-8 text-[var(--muted)]">加载中…</div>
          ) : items.length === 0 ? (
            <div className="card p-8 text-center text-[var(--muted)]">
              还没有语料。先添加品牌故事或产品说明，AI 才能写出像你的文案。
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className={`card p-4 transition-shadow ${
                  editingId === item.id
                    ? "ring-2 ring-[var(--accent)]/60"
                    : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => startEdit(item)}
                  >
                    <div className="font-medium">{item.title}</div>
                    <div className="mt-1 text-xs text-[var(--muted)]">
                      {CORPUS_CATEGORIES.find((c) => c.id === item.category)?.label}
                      {item.tags ? ` · ${item.tags}` : ""}
                    </div>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="btn btn-ghost text-sm"
                      onClick={() => startEdit(item)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost text-sm text-[var(--danger)]"
                      onClick={() => void remove(item.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
                <p className="mt-2 line-clamp-3 text-sm text-[var(--muted)] whitespace-pre-wrap">
                  {item.content}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
