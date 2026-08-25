"use client";

import { useEffect, useRef, useState } from "react";
import {
  guessImportedEpisodeCount,
  readScriptFile,
} from "@/lib/ai/script-import";

type Props = {
  open: boolean;
  mode: "create" | "import";
  busy?: boolean;
  defaultTitle?: string;
  onClose: () => void;
  onSubmit: (input: {
    title: string;
    body: string;
    rewrite: boolean;
    episodeCount: number;
    hasSequel: boolean;
  }) => void | Promise<void>;
};

export function ScriptSourceDialog({
  open,
  mode,
  busy,
  defaultTitle = "",
  onClose,
  onSubmit,
}: Props) {
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState("");
  const [rewrite, setRewrite] = useState(mode === "import");
  const [episodeCount, setEpisodeCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setError(null);
    setRewrite(mode === "import");
  }, [open, defaultTitle, mode]);

  if (!open) return null;

  const create = mode === "create";
  const guessed = guessImportedEpisodeCount(body);
  const chars = body.trim().length;

  function applyBody(next: string) {
    setBody(next);
    const count = guessImportedEpisodeCount(next);
    setEpisodeCount(count);
    if (create && next.trim()) setRewrite(true);
  }

  async function pickFile(file?: File | null) {
    if (!file) return;
    setError(null);
    try {
      const text = await readScriptFile(file);
      applyBody(text);
      if (!title.trim() && file.name) {
        setTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 16));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "读文件失败");
    }
  }

  async function submit(empty: boolean) {
    setError(null);
    const name = title.trim() || defaultTitle.trim();
    if (create && !name && !body.trim()) {
      setError("先起个剧本名，或贴一段本");
      return;
    }
    if (!empty && !body.trim()) {
      setError("先贴剧本，或选一个文本文件");
      return;
    }
    const count = Math.min(80, Math.max(1, Math.round(episodeCount) || 1));
    await onSubmit({
      title: name || "未命名剧本",
      body: empty ? "" : body.trim(),
      rewrite: empty ? false : rewrite,
      episodeCount: empty ? 1 : count,
      hasSequel: !empty && guessed > count,
    });
  }

  return (
    <div className="script-source">
      <button
        type="button"
        className="script-source__back"
        aria-label="关闭"
        onClick={onClose}
      />
      <div
        className="card script-source__card"
        role="dialog"
        aria-labelledby="script-source-title"
      >
        <header className="script-source__head">
          <div>
            <p className="script-source__eyebrow">
              {create ? "内容工厂 · 新本" : "内容工厂 · 原作"}
            </p>
            <h2 id="script-source-title">
              {create ? "添加剧本" : "导入剧本改写"}
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={onClose}
          >
            关闭
          </button>
        </header>
        <div className="script-source__grid">
          <aside className="script-source__side">
            <label>
              <span>剧本名</span>
              <input
                className="field"
                value={title}
                maxLength={16}
                placeholder="抖音合集名，短一点"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              <span>这次先写几集</span>
              <input
                className="field"
                type="number"
                min={1}
                max={80}
                value={episodeCount}
                disabled={!body.trim() || busy}
                onChange={(event) =>
                  setEpisodeCount(
                    Math.min(80, Math.max(1, Number(event.target.value) || 1)),
                  )
                }
              />
            </label>
            <p className="script-source__hint">
              {chars
                ? `原作 ${chars} 字，看起来大约 ${guessed} 集。先写 ${episodeCount} 集，剩下的点「写下一集」接着用。`
                : "贴对白、分集，或选 txt / md。人、冲突、情节跟着原作走。"}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.fountain,.json,text/plain"
              hidden
              onChange={(event) => {
                void pickFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn btn-ghost script-source__file"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              选文件导入
            </button>
            <label className="script-source__check">
              <input
                type="checkbox"
                checked={rewrite}
                disabled={busy}
                onChange={(event) => setRewrite(event.target.checked)}
              />
              <span>导入后立刻改写</span>
            </label>
          </aside>
          <label className="script-source__manuscript">
            <span>原剧本</span>
            <textarea
              className="field script-source__body"
              value={body}
              placeholder="整本贴进来。有「第 2 集」会按集数认；没有就按篇幅估。"
              onChange={(event) => applyBody(event.target.value)}
            />
          </label>
        </div>
        {error ? <p className="script-source__err">{error}</p> : null}
        <footer className="script-source__actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>
            取消
          </button>
          {create ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => void submit(true)}
            >
              先建空本
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void submit(false)}
          >
            {busy
              ? "处理中…"
              : rewrite && body.trim()
                ? `导入并改写 ${episodeCount} 集`
                : create
                  ? "保存原作"
                  : "导入"}
          </button>
        </footer>
      </div>
    </div>
  );
}
