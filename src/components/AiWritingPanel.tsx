"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  CopywritingKind,
  CopywritingStyle,
  CorpusCategory,
  CorpusItem,
  PlatformFamily,
} from "@/lib/types";
import {
  COPYWRITING_KINDS,
  COPYWRITING_STYLES,
  CORPUS_CATEGORIES,
  PLATFORM_FAMILIES,
  defaultFamilyForKind,
  isPlatformFamily,
} from "@/lib/types";
import { stripBodyLabel } from "@/lib/ai/strip-body-label";

type PreviewState = {
  title: string;
  summary: string;
  bodyHtml: string;
  bodyMarkdown: string;
  thinking?: string;
  usedCorpus: { id: string; title: string }[];
};

export function AiWritingPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const thinkingRef = useRef<HTMLPreElement>(null);
  const contentRef = useRef<HTMLPreElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [corpus, setCorpus] = useState<CorpusItem[]>([]);
  const [kind, setKind] = useState<CopywritingKind>("brand_intro");
  const [style, setStyle] = useState<CopywritingStyle>("default");
  const [family, setFamily] = useState<PlatformFamily>("tech");
  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState("专业、真诚、有温度");
  const [categories, setCategories] = useState<CorpusCategory[]>([
    "brand",
    "story",
    "product",
  ]);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [streamModel, setStreamModel] = useState<string | null>(null);
  const [thinkingText, setThinkingText] = useState("");
  const [contentText, setContentText] = useState("");
  const [showThinking, setShowThinking] = useState(true);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [geoKeywordId, setGeoKeywordId] = useState<string | null>(null);

  const loadCorpus = useCallback(async () => {
    const res = await fetch("/api/corpus");
    const data = await res.json();
    setCorpus(data.items ?? []);
  }, []);

  useEffect(() => {
    void loadCorpus();
  }, [loadCorpus]);

  useEffect(() => {
    const briefParam = searchParams.get("brief");
    const title = searchParams.get("title");
    const kindParam = searchParams.get("kind");
    const familyParam = searchParams.get("family");
    const keywordId = searchParams.get("geoKeywordId");
    setGeoKeywordId(keywordId?.trim() || null);
    if (briefParam) setBrief(briefParam);
    else if (title) {
      setBrief(`请以标题「${title}」为主题写一篇长文，自然覆盖相关长尾搜索意图。`);
    }
    let nextKind: CopywritingKind | null = null;
    if (
      kindParam === "article" ||
      kindParam === "brand_intro" ||
      kindParam === "product" ||
      kindParam === "social" ||
      kindParam === "slogan"
    ) {
      nextKind = kindParam;
      setKind(kindParam);
    }
    if (isPlatformFamily(familyParam)) {
      setFamily(familyParam);
    } else if (nextKind) {
      setFamily(defaultFamilyForKind(nextKind));
    }
  }, [searchParams]);

  useEffect(() => {
    if (thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [thinkingText]);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [contentText]);

  function toggleCategory(id: CorpusCategory) {
    setCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  function stopGenerate() {
    abortRef.current?.abort();
    abortRef.current = null;
    setGenerating(false);
    setMessage("已停止生成");
  }

  async function generate(saveAsArticle: boolean) {
    if (!brief.trim()) {
      setMessage("请先描述你想写什么");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setGenerating(true);
    setMessage(null);
    setPreview(null);
    setThinkingText("");
    setContentText("");
    setStreamModel(null);
    setShowThinking(true);

    try {
      const res = await fetch("/api/ai/copywriting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          style,
          family,
          brief,
          tone: style === "default" ? tone : tone.trim() || undefined,
          categories,
          stream: true,
          saveAsArticle,
          geoKeywordId: geoKeywordId || undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(data.error || `生成失败（${res.status}）`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setMessage("流式响应不可用");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: {
            type: string;
            delta?: string;
            model?: string;
            usedCorpus?: { id: string; title: string }[];
            result?: PreviewState & { bodyMarkdown: string };
            article?: { id: string };
            message?: string;
          };
          try {
            event = JSON.parse(line) as typeof event;
          } catch {
            continue;
          }

          if (event.type === "meta") {
            if (event.model) setStreamModel(event.model);
            continue;
          }
          if (event.type === "thinking" && event.delta) {
            setThinkingText((prev) => prev + event.delta);
            continue;
          }
          if (event.type === "content" && event.delta) {
            setContentText((prev) => prev + event.delta);
            continue;
          }
          if (event.type === "error") {
            setMessage(event.message || "生成失败");
            return;
          }
          if (event.type === "done" && event.result) {
            if (saveAsArticle && event.article?.id) {
              router.push(`/articles/${event.article.id}`);
              return;
            }
            setPreview({
              title: event.result.title,
              summary: event.result.summary,
              bodyHtml: event.result.bodyHtml,
              bodyMarkdown: event.result.bodyMarkdown,
              thinking: event.result.thinking,
              usedCorpus: event.result.usedCorpus ?? [],
            });
            setMessage("生成完成，可保存为文章继续编辑发布");
            return;
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setMessage("已停止生成");
        return;
      }
      setMessage(err instanceof Error ? err.message : "生成失败");
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }

  async function savePreviewAsArticle() {
    if (!preview) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: preview.title,
          body: preview.bodyHtml,
          summary: preview.summary,
          family,
          geoKeywordId: geoKeywordId || undefined,
          geoBrief: brief,
        }),
      });
      const data = await res.json();
      if (data.article?.id) {
        router.push(`/articles/${data.article.id}`);
      }
    } finally {
      setGenerating(false);
    }
  }

  const isStreaming = generating && (thinkingText || contentText);
  const showResult = preview || isStreaming;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">AI 写文案</h1>
          <p className="mt-1 text-[var(--muted)]">
            基于语料库与 DeepSeek，流式生成品牌文案
          </p>
        </div>
        <Link href="/corpus" className="btn btn-ghost text-sm">
          管理语料库 →
        </Link>
      </div>

      {geoKeywordId && (
        <div className="card border-[var(--accent)]/25 bg-[var(--accent-soft)]/40 px-4 py-3 text-sm">
          正在为 GEO 长尾词写文，保存后将自动关联到挖词列表（可多次写文、多篇关联）。
          <Link href="/keywords" className="ml-2 underline text-[var(--accent)]">
            返回挖词
          </Link>
        </div>
      )}

      {corpus.length === 0 && (
        <div className="card border-[var(--warn)]/30 bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] px-4 py-3 text-sm">
          语料库还是空的。建议先去
          <Link href="/corpus" className="mx-1 underline text-[var(--accent)]">
            添加语料
          </Link>
          ，AI 才能写出贴合你品牌/故事的文案。
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="card space-y-4 p-5">
          <h2 className="text-lg font-medium">写作需求</h2>
          <div className="flex flex-wrap gap-2">
            {COPYWRITING_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                title={k.hint}
                className={`btn text-sm ${kind === k.id ? "btn-primary" : "btn-ghost"}`}
                onClick={() => {
                  setKind(k.id);
                  setFamily(defaultFamilyForKind(k.id));
                }}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div>
            <div className="mb-2 text-sm text-[var(--muted)]">目标平台族</div>
            <div className="flex flex-wrap gap-2">
              {PLATFORM_FAMILIES.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  title={f.hint}
                  className={`btn text-sm ${family === f.id ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setFamily(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm text-[var(--muted)]">写作风格</div>
            <div className="flex flex-wrap gap-2">
              {COPYWRITING_STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.hint}
                  className={`btn text-sm ${style === s.id ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => {
                    setStyle(s.id);
                    if (s.id === "default") {
                      setTone((prev) => prev.trim() || "专业、真诚、有温度");
                    } else if (tone === "专业、真诚、有温度") {
                      setTone("");
                    }
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            className="field min-h-[140px] w-full resize-y"
            placeholder="描述你想写什么，例如：为点物 GEO 写一段 200 字品牌介绍，强调多平台分发与本地可控…"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
          <input
            className="field w-full"
            placeholder={
              style === "default"
                ? "语气补充（可选）"
                : "额外语气补充（可选，会叠在所选风格上）"
            }
            value={tone}
            onChange={(e) => setTone(e.target.value)}
          />
          <div>
            <div className="mb-2 text-sm text-[var(--muted)]">引用语料类型</div>
            <div className="flex flex-wrap gap-2">
              {CORPUS_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`btn text-sm ${categories.includes(c.id) ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => toggleCategory(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={generating}
              onClick={() => void generate(false)}
            >
              {generating ? "生成中…" : "生成预览"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={generating}
              onClick={() => void generate(true)}
            >
              生成并保存为文章
            </button>
            {generating && (
              <button type="button" className="btn btn-ghost" onClick={stopGenerate}>
                停止
              </button>
            )}
          </div>
          {message && (
            <p className="text-sm text-[var(--accent)]">{message}</p>
          )}
        </div>

        <div className="card min-h-[420px] p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-medium">生成结果</h2>
            {streamModel && (
              <span className="text-xs text-[var(--muted)]">{streamModel}</span>
            )}
          </div>

          {!showResult ? (
            <p className="mt-8 text-center text-sm text-[var(--muted)]">
              填写需求后点击「生成预览」
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {(thinkingText || preview?.thinking) && (
                <div className="ai-thinking-panel">
                  <button
                    type="button"
                    className="ai-thinking-toggle"
                    onClick={() => setShowThinking((v) => !v)}
                  >
                    <span>Thinking</span>
                    <span className="text-[var(--muted)]">
                      {showThinking ? "收起" : "展开"}
                      {generating && !contentText ? " · 思考中…" : ""}
                    </span>
                  </button>
                  {showThinking && (
                    <pre ref={thinkingRef} className="ai-thinking-body">
                      {thinkingText || preview?.thinking || ""}
                    </pre>
                  )}
                </div>
              )}

              {generating && !thinkingText && !contentText && (
                <p className="text-sm text-[var(--muted)] animate-pulse">
                  正在连接 DeepSeek…
                </p>
              )}

              {preview ? (
                <>
                  <div>
                    <div className="text-xl font-semibold">{preview.title}</div>
                    {preview.summary && (
                      <p className="mt-2 text-sm text-[var(--muted)]">
                        {preview.summary}
                      </p>
                    )}
                  </div>
                  {preview.usedCorpus.length > 0 && (
                    <p className="text-xs text-[var(--muted)]">
                      引用语料：
                      {preview.usedCorpus.map((c) => c.title).join("、")}
                    </p>
                  )}
                  <div
                    className="prose-yuque max-h-[360px] overflow-y-auto rounded-xl border border-[var(--line)] bg-white/40 p-4 text-sm leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: preview.bodyHtml }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={generating}
                    onClick={() => void savePreviewAsArticle()}
                  >
                    保存为文章并编辑
                  </button>
                </>
              ) : (
                contentText && (
                  <pre ref={contentRef} className="ai-stream-body">
                    {stripBodyLabel(contentText)}
                  </pre>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
