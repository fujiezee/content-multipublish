"use client";

import { useCallback, useRef, useState } from "react";
import type { CorpusAsset, CorpusCategory, CorpusItem } from "@/lib/types";
import { CORPUS_CATEGORIES } from "@/lib/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { useInfiniteList } from "@/components/useInfiniteList";

const MAX_ASSETS = 12;

type DraftAsset = CorpusAsset & { uploading?: boolean };

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
  const confirm = useConfirm();
  const formRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<CorpusCategory>("brand");
  const [tags, setTags] = useState("");
  const [content, setContent] = useState("");
  const [assets, setAssets] = useState<DraftAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchPage = useCallback(async (offset: number, limit: number) => {
    const res = await fetch(
      `/api/corpus?limit=${limit}&offset=${offset}`,
      { cache: "no-store" },
    );
    const { ok, data, empty } = await readApiJson(res);
    if (!ok || !data) {
      throw new Error(
        empty ? "加载语料失败：服务无响应，请稍后重试" : "加载语料失败",
      );
    }
    return {
      items: (data.items as CorpusItem[] | undefined) ?? [],
      nextOffset: (data.nextOffset as number | null | undefined) ?? null,
      hasMore: Boolean(data.hasMore),
    };
  }, []);

  const {
    items,
    booting,
    error: listError,
    reload,
    sentinel,
  } = useInfiniteList<CorpusItem>(fetchPage);

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setCategory("brand");
    setTags("");
    setContent("");
    setAssets([]);
  }

  function startEdit(item: CorpusItem) {
    setEditingId(item.id);
    setTitle(item.title);
    setCategory(normalizeCategory(item.category));
    setTags(item.tags);
    setContent(item.content);
    setAssets(item.assets || []);
    setMessage(`正在编辑：${item.title}`);
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function uploadFiles(files: FileList | File[]) {
    const incoming = Array.from(files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!incoming.length) {
      setMessage("请选择图片或截图");
      return;
    }
    if (assets.length + incoming.length > MAX_ASSETS) {
      setMessage(`一条语料最多 ${MAX_ASSETS} 张图`);
      return;
    }
    setUploading(true);
    setMessage(null);
    try {
      for (const file of incoming) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as {
          url?: string;
          path?: string;
          error?: string;
        };
        if (!res.ok || !data.url) {
          setMessage(data.error || "图片上传失败");
          continue;
        }
        setAssets((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            url: data.url as string,
            path: data.path,
            caption: "",
            kind: "screenshot",
          },
        ]);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "图片上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function updateAsset(id: string, patch: Partial<DraftAsset>) {
    setAssets((prev) =>
      prev.map((asset) => (asset.id === id ? { ...asset, ...patch } : asset)),
    );
  }

  async function save() {
    const readyAssets = assets.filter((asset) => asset.url && !asset.uploading);
    if (!title.trim()) {
      setMessage("请填写标题");
      return;
    }
    if (!content.trim() && readyAssets.length === 0) {
      setMessage("请填写内容，或上传带说明的图片");
      return;
    }
    if (readyAssets.some((asset) => !asset.caption.trim())) {
      setMessage("每张图都要写说明，写清楚图里是什么");
      return;
    }
    const wasEditing = Boolean(editingId);
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        title,
        category,
        tags,
        content,
        assets: readyAssets.map(({ uploading: _uploading, ...asset }) => asset),
      };
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
      await reload();
      setMessage(wasEditing ? "已更新" : "已添加");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const item = items.find((row) => row.id === id);
    const ok = await confirm({
      title: "确定删除这条语料？",
      detail: item?.title
        ? `「${item.title}」会从语料库拿掉，写文时不再引用。`
        : "这条语料会从库里拿掉，写文时不再引用。",
      confirmLabel: "删除语料",
      cancelLabel: "先留着",
    });
    if (!ok) return;
    await fetch(`/api/corpus/${id}`, { method: "DELETE" });
    if (editingId === id) resetForm();
    await reload();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">语料库</h1>
        <p className="mt-1 text-[var(--muted)]">
          沉淀品牌、故事、产品素材和截图。截图必须写说明，写文引用时会连图带进正文。
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
            className="field min-h-[180px] w-full resize-y font-mono text-sm leading-relaxed"
            placeholder="粘贴品牌介绍、个人故事、产品说明、范文等…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-[var(--muted)]">
                配图 / 截图
                {assets.length > 0 ? `（${assets.length}）` : ""}
              </div>
              <button
                type="button"
                className="btn btn-ghost text-sm"
                disabled={uploading || assets.length >= MAX_ASSETS}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? "上传中…" : "上传图片"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void uploadFiles(e.target.files);
                }}
              />
            </div>
            <p className="text-xs text-[var(--muted)]">
              截图一定要写说明，例如「后台待发货列表，红框是超时未发的单」。引用语料时图会一起带上。
            </p>
            {assets.length > 0 && (
              <div className="space-y-3">
                {assets.map((asset) => (
                  <div
                    key={asset.id}
                    className="flex gap-3 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-2.5"
                  >
                    <img
                      src={asset.url}
                      alt={asset.caption || "语料配图"}
                      className="h-16 w-16 shrink-0 rounded-md object-cover ring-1 ring-[var(--line)]"
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className={`btn text-xs ${
                            asset.kind === "screenshot"
                              ? "btn-primary"
                              : "btn-ghost"
                          }`}
                          onClick={() =>
                            updateAsset(asset.id, { kind: "screenshot" })
                          }
                        >
                          截图
                        </button>
                        <button
                          type="button"
                          className={`btn text-xs ${
                            asset.kind === "image" ? "btn-primary" : "btn-ghost"
                          }`}
                          onClick={() =>
                            updateAsset(asset.id, { kind: "image" })
                          }
                        >
                          图片
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost ml-auto text-xs text-[var(--danger)]"
                          onClick={() =>
                            setAssets((prev) =>
                              prev.filter((row) => row.id !== asset.id),
                            )
                          }
                        >
                          去掉
                        </button>
                      </div>
                      <textarea
                        className="field min-h-[64px] w-full resize-y text-sm"
                        placeholder={
                          asset.kind === "screenshot"
                            ? "这张截图是什么：界面、框出来的地方、数字含义…"
                            : "这张图是什么：产品、场景、要让模型记住的细节…"
                        }
                        value={asset.caption}
                        onChange={(e) =>
                          updateAsset(asset.id, { caption: e.target.value })
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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

        <div className="flex min-h-0 flex-col gap-3">
          <h2 className="text-lg font-medium">
            已有语料 {items.length > 0 ? `（${items.length}）` : ""}
          </h2>
          {listError ? (
            <p className="text-sm text-[var(--danger)]">{listError}</p>
          ) : null}
          {booting ? (
            <div className="card p-8 text-[var(--muted)]">加载中…</div>
          ) : items.length === 0 ? (
            <div className="card p-8 text-center text-[var(--muted)]">
              还没有语料。先添加品牌故事或产品说明，AI 才能写出像你的文案。
            </div>
          ) : (
            <div className="corpus-list space-y-3">
              {items.map((item) => (
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
                  {item.content ||
                    (item.assets?.length
                      ? item.assets
                          .map((asset) => asset.caption)
                          .filter(Boolean)
                          .join("；")
                      : "")}
                </p>
                {item.assets && item.assets.length > 0 && (
                  <div className="mt-2 flex gap-2 overflow-x-auto">
                    {item.assets.slice(0, 6).map((asset) => (
                      <img
                        key={asset.id}
                        src={asset.url}
                        alt={asset.caption || item.title}
                        title={asset.caption}
                        className="h-12 w-12 shrink-0 rounded object-cover ring-1 ring-[var(--line)]"
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {sentinel}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
