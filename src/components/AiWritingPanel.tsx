"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  CopywritingKind,
  CopywritingStyle,
  CorpusCategory,
  CorpusItem,
  MarketingAngle,
  PlatformFamily,
  PodcastMode,
  WriterAgent,
} from "@/lib/types";
import {
  COPYWRITING_KINDS,
  COPYWRITING_STYLES,
  CORPUS_CATEGORIES,
  MARKETING_ANGLES,
  ORAL_MODES,
  PLATFORM_FAMILIES,
  WRITING_ONLY_FAMILIES,
  defaultFamilyForKind,
  defaultStyleForKind,
  isPlatformFamily,
} from "@/lib/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { QuotaHint, QuotaMessage } from "@/components/QuotaHint";
import { parseQuotaError, useQuota } from "@/components/useQuota";
import { quotaRechargeText } from "@/lib/billing/copy";
import { stripBodyLabel } from "@/lib/ai/strip-body-label";
import { parseCopyResponse, serializeCopyDraft } from "@/lib/ai/copy-parse";
import { markdownToHtml } from "@/lib/content/markdown";
import { HumanTalkRevise } from "@/components/HumanTalkRevise";
import { ModelPicker } from "@/components/ModelPicker";
import type { AiModelBadge } from "@/lib/ai/model-catalog/types";
import {
  composeGeoArticleBrief,
  composeMarketingMaterialBrief,
  isDerivedMarketingMaterial,
  isGeoLongformBrief,
  shouldRewriteMarketingBrief,
  stripForcedMarketingLock,
} from "@/lib/ai/marketing-copy-brief";

type CopywritingModelOption = {
  id: string;
  label: string;
  hint?: string;
  cost?: string;
  ready?: boolean;
  badges?: AiModelBadge[];
};

type PreviewState = {
  title: string;
  summary: string;
  scriptTitle?: string;
  bodyHtml: string;
  bodyMarkdown: string;
  thinking?: string;
  usedCorpus: { id: string; title: string }[];
};

type DistillPreview = {
  seed: string;
  name: string;
  hint: string;
  instruction: string;
};

export function AiWritingPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const thinkingRef = useRef<HTMLPreElement>(null);
  const contentRef = useRef<HTMLPreElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const appliedQueryRef = useRef<string | null>(null);
  const originalGeoBriefRef = useRef("");
  const thinkingPinnedRef = useRef(false);
  const writingStartedRef = useRef(false);

  const [corpus, setCorpus] = useState<CorpusItem[]>([]);
  const [kind, setKind] = useState<CopywritingKind>("brand_intro");
  const [marketingAngle, setMarketingAngle] = useState<MarketingAngle>("anxiety");
  const [oralMode, setOralMode] = useState<PodcastMode>("solo");
  const [geoPain, setGeoPain] = useState("");
  const [geoTitleHint, setGeoTitleHint] = useState("");
  const [geoScene, setGeoScene] = useState("");
  const [style, setStyle] = useState<CopywritingStyle>("default");
  const [agents, setAgents] = useState<WriterAgent[]>([]);
  const [writerAgentId, setWriterAgentId] = useState<string | null>(null);
  const [addingWriter, setAddingWriter] = useState(false);
  const [customSeed, setCustomSeed] = useState("");
  const [distilling, setDistilling] = useState(false);
  const [family, setFamily] = useState<PlatformFamily>("tech");
  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState("专业、真诚、有温度");
  const [categories, setCategories] = useState<CorpusCategory[]>([
    "brand",
    "story",
    "product",
  ]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [streamModel, setStreamModel] = useState<string | null>(null);
  const [copywritingModels, setCopywritingModels] = useState<
    CopywritingModelOption[]
  >([]);
  const [modelSlug, setModelSlug] = useState("");
  const [reviewModels, setReviewModels] = useState<CopywritingModelOption[]>(
    [],
  );
  const [reviewModel, setReviewModel] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const [contentText, setContentText] = useState("");
  const [showThinking, setShowThinking] = useState(true);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [streamPhaseKind, setStreamPhaseKind] = useState<"write" | "review" | null>(
    null,
  );
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [distillPreview, setDistillPreview] = useState<DistillPreview | null>(
    null,
  );
  const [geoKeywordId, setGeoKeywordId] = useState<string | null>(null);
  const [editingPreview, setEditingPreview] = useState(false);
  const { snap, refresh, can } = useQuota();
  const articleQuota = snap("articles");
  const noArticleQuota = !can("articles");
  const confirm = useConfirm();

  const loadCorpus = useCallback(async () => {
    const res = await fetch("/api/corpus?limit=50&offset=0");
    const data = await res.json();
    setCorpus(data.items ?? []);
  }, []);

  const loadAgents = useCallback(async () => {
    const res = await fetch("/api/writer-agents");
    const data = await res.json().catch(() => ({}));
    const items = (data.items as WriterAgent[] | undefined) ?? [];
    setAgents(items);
    return items;
  }, []);

  useEffect(() => {
    void loadCorpus();
  }, [loadCorpus]);

  useEffect(() => {
    void (async () => {
      const items = await loadAgents();
      try {
        const saved = localStorage.getItem("dwgeo-writer-agent-id");
        if (saved && items.some((row) => row.id === saved)) {
          setWriterAgentId(saved);
        }
      } catch {
        // ignore
      }
    })();
  }, [loadAgents]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/ai/copywriting");
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const models = (data.models as CopywritingModelOption[] | undefined) ?? [];
      const reviews =
        (data.reviewModels as CopywritingModelOption[] | undefined) ?? models;
      setCopywritingModels(models);
      setReviewModels(reviews);
      try {
        const saved = localStorage.getItem("dwgeo-copywriting-model");
        if (saved && models.some((m) => m.id === saved && m.ready !== false)) {
          setModelSlug(saved);
        } else {
          const ready = models.find((m) => m.ready !== false);
          if (ready) setModelSlug(ready.id);
        }
        const savedReview = localStorage.getItem("dwgeo-review-model");
        if (
          savedReview &&
          reviews.some((m) => m.id === savedReview && m.ready !== false)
        ) {
          setReviewModel(savedReview);
        } else {
          const readyReview =
            reviews.find((m) => m.id === "deepseek-chat" && m.ready !== false) ||
            reviews.find((m) => m.ready !== false);
          if (readyReview) setReviewModel(readyReview.id);
        }
      } catch {
        const ready = models.find((m) => m.ready !== false);
        if (ready) setModelSlug(ready.id);
        const readyReview =
          reviews.find((m) => m.id === "deepseek-chat" && m.ready !== false) ||
          reviews.find((m) => m.ready !== false);
        if (readyReview) setReviewModel(readyReview.id);
      }
    })();
  }, []);

  function pickWriter(id: string | null) {
    setWriterAgentId(id);
    try {
      if (id) localStorage.setItem("dwgeo-writer-agent-id", id);
      else localStorage.removeItem("dwgeo-writer-agent-id");
    } catch {
      // ignore
    }
  }

  function writeWritingQuery(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    params.delete("angle");
    const qs = params.toString();
    appliedQueryRef.current = qs;
    router.replace(qs ? `/writing?${qs}` : "/writing", { scroll: false });
  }

  function marketingMaterialFor(currentBrief: string) {
    if (!shouldRewriteMarketingBrief(currentBrief)) {
      return stripForcedMarketingLock(currentBrief);
    }
    return composeMarketingMaterialBrief({
      pain: geoPain,
      title: geoTitleHint,
      scene: geoScene,
      fallbackBrief: currentBrief,
    });
  }

  useEffect(() => {
    const queryKey = searchParams.toString();
    if (appliedQueryRef.current === queryKey) return;
    appliedQueryRef.current = queryKey;

    const briefParam = searchParams.get("brief");
    const title = searchParams.get("title");
    const kindParam = searchParams.get("kind");
    const familyParam = searchParams.get("family");
    const keywordId = searchParams.get("geoKeywordId");
    const painParam = searchParams.get("pain")?.trim() || "";
    const sceneParam = searchParams.get("scene")?.trim() || "";
    const angleParam = searchParams.get("marketingAngle");
    const oralParam = searchParams.get("oralMode");
    setGeoKeywordId(keywordId?.trim() || null);
    setGeoPain(painParam);
    setGeoScene(sceneParam);
    setGeoTitleHint(title?.trim() || "");
    let nextKind: CopywritingKind | null = null;
    if (
      kindParam === "article" ||
      kindParam === "brand_intro" ||
      kindParam === "product" ||
      kindParam === "marketing" ||
      kindParam === "oral" ||
      kindParam === "social" ||
      kindParam === "slogan" ||
      kindParam === "script_outline"
    ) {
      nextKind = kindParam;
      setKind(kindParam);
      setStyle(defaultStyleForKind(kindParam));
    }
    if (briefParam) {
      if (!originalGeoBriefRef.current && isGeoLongformBrief(briefParam)) {
        originalGeoBriefRef.current = briefParam;
      }
      const visible =
        nextKind === "marketing" || nextKind === "oral"
          ? composeMarketingMaterialBrief({
              pain: painParam,
              title: title?.trim() || "",
              scene: sceneParam,
              fallbackBrief: briefParam,
            })
          : stripForcedMarketingLock(briefParam);
      setBrief(visible);
      if (
        !originalGeoBriefRef.current &&
        isGeoLongformBrief(visible)
      ) {
        originalGeoBriefRef.current = visible;
      }
    } else if (title) {
      const next = `请以标题「${title}」为主题写一篇长文，对准目标用户的这个痛点来写。`;
      if (!originalGeoBriefRef.current) originalGeoBriefRef.current = next;
      setBrief(
        nextKind === "marketing" || nextKind === "oral"
          ? composeMarketingMaterialBrief({
              pain: painParam,
              title: title.trim(),
              scene: sceneParam,
              fallbackBrief: next,
            })
          : next,
      );
    }
    if (nextKind === "marketing") {
      setMarketingAngle(angleParam === "hope" ? "hope" : "anxiety");
      setCategories(["product", "story", "brand"]);
      setTone("");
    }
    if (nextKind === "oral") {
      setOralMode(oralParam === "dialogue" ? "dialogue" : "solo");
      setCategories(["product", "story", "brand"]);
      setTone("");
    }
    if (nextKind === "script_outline") {
      setFamily("short_video");
    } else if (isPlatformFamily(familyParam)) {
      setFamily(familyParam);
    } else if (nextKind) {
      setFamily(defaultFamilyForKind(nextKind));
    }
  }, [searchParams]);

  function resetStreamView() {
    thinkingPinnedRef.current = false;
    writingStartedRef.current = false;
    setThinkingText("");
    setContentText("");
    setStreamModel(null);
    setStreamStatus(null);
    setStreamPhaseKind(null);
    setShowThinking(true);
    setEditingPreview(false);
  }

  function markWritingStarted() {
    if (writingStartedRef.current) return;
    writingStartedRef.current = true;
    if (!thinkingPinnedRef.current) setShowThinking(false);
  }

  useEffect(() => {
    if (!showThinking) return;
    if (writingStartedRef.current && !thinkingPinnedRef.current) return;
    if (thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [thinkingText, showThinking]);

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
    setDistilling(false);
    setMessage("已停止生成");
  }

  async function readNdjson(
    res: Response,
    applyEvent: (line: string) => boolean,
  ) {
    const reader = res.body?.getReader();
    if (!reader) {
      setMessage("流式响应不可用");
      return;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;
    const controller = abortRef.current;

    while (!finished) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        finished = applyEvent(buffer);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (applyEvent(line)) {
          finished = true;
          break;
        }
      }
    }

    if (!finished && !controller?.signal.aborted) {
      setMessage((prev) => prev ?? "生成中断，没有收到完整结果");
    }
  }

  async function distillWriter() {
    if (distilling || generating) return;
    const seed = customSeed.trim();
    if (seed.length < 2) {
      setMessage("写个名字，比如司马生");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setDistilling(true);
    setMessage(null);
    setPreview(null);
    setDistillPreview(null);
    resetStreamView();

    try {
      const res = await fetch("/api/writer-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage((data.error as string) || `蒸馏失败（${res.status}）`);
        return;
      }

      await readNdjson(res, (line) => {
        if (!line.trim()) return false;
        let event: {
          type: string;
          delta?: string;
          model?: string;
          message?: string;
          result?: { name?: string; hint?: string; instruction?: string };
        };
        try {
          event = JSON.parse(line) as typeof event;
        } catch {
          return false;
        }
        if (event.type === "meta" && event.model) {
          setStreamModel(event.model);
          return false;
        }
        if (event.type === "thinking" && event.delta) {
          setThinkingText((prev) => prev + event.delta);
          return false;
        }
        if (event.type === "status" && event.message) {
          setStreamStatus(event.message);
          return false;
        }
        if (event.type === "content" && event.delta) {
          markWritingStarted();
          setContentText((prev) => prev + event.delta);
          return false;
        }
        if (event.type === "error") {
          setMessage(event.message || "蒸馏失败");
          return true;
        }
        if (event.type === "done" && event.result) {
          setDistillPreview({
            seed,
            name: event.result.name?.trim() || seed.slice(0, 16),
            hint: event.result.hint?.trim() || "自定义写手",
            instruction: event.result.instruction?.trim() || "",
          });
          setMessage("蒸馏完成，检查提示词后保存写手");
          return true;
        }
        return false;
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setMessage("已停止生成");
        return;
      }
      setMessage(err instanceof Error ? err.message : "蒸馏失败");
    } finally {
      setDistilling(false);
      abortRef.current = null;
    }
  }

  async function saveWriter() {
    if (!distillPreview) {
      setMessage("请先蒸馏再保存");
      return;
    }
    if (!distillPreview.instruction.trim()) {
      setMessage("提示词是空的");
      return;
    }
    setDistilling(true);
    setMessage(null);
    try {
      const res = await fetch("/api/writer-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          save: true,
          seed: distillPreview.seed,
          name: distillPreview.name,
          hint: distillPreview.hint,
          instruction: distillPreview.instruction,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.item) {
        setMessage((data.error as string) || "保存失败");
        return;
      }
      const item = data.item as WriterAgent;
      await loadAgents();
      pickWriter(item.id);
      setCustomSeed("");
      setAddingWriter(false);
      setMessage(
        data.updated
          ? `已更新「${item.name}」。再点「+ 新写手」可以继续加。`
          : `已保存「${item.name}」。写文选它，或再点「+ 新写手」加下一个。`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setDistilling(false);
    }
  }

  async function removeWriter(id: string) {
    const writer = agents.find((row) => row.id === id);
    const ok = await confirm({
      title: "删掉这个写手？",
      detail: writer?.name
        ? `「${writer.name}」会从写手列表里去掉，已写好的文章还在。`
        : "这个写手会从列表里去掉，已写好的文章还在。",
      confirmLabel: "删掉写手",
      cancelLabel: "先留着",
    });
    if (!ok) return;
    await fetch(`/api/writer-agents/${id}`, { method: "DELETE" });
    const next = agents.filter((row) => row.id !== id);
    setAgents(next);
    if (writerAgentId === id) {
      pickWriter(next[0]?.id ?? null);
    }
  }

  async function generate() {
    if (generating || distilling) return;
    if (noArticleQuota) {
      setMessage(quotaRechargeText("articles"));
      return;
    }
    if (!brief.trim() && kind !== "marketing" && kind !== "oral") {
      setMessage("请先描述你想写什么");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setGenerating(true);
    setMessage(null);
    setPreview(null);
    setDistillPreview(null);
    resetStreamView();

    try {
      const res = await fetch("/api/ai/copywriting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          style,
          writerAgentId: writerAgentId || undefined,
          family,
          brief:
            brief.trim() ||
            (kind === "marketing" || kind === "oral"
              ? composeMarketingMaterialBrief({
                  pain: geoPain,
                  title: geoTitleHint,
                  scene: geoScene,
                })
              : ""),
          tone:
            writerAgentId || style !== "default"
              ? tone.trim() || undefined
              : tone,
          categories,
          stream: true,
          saveAsArticle: false,
          geoKeywordId: geoKeywordId || undefined,
          modelSlug: modelSlug || undefined,
          reviewModel: reviewModel || undefined,
          marketingAngle: kind === "marketing" ? marketingAngle : undefined,
          oralMode: kind === "oral" ? oralMode : undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const quota = parseQuotaError(res, data);
        if (quota) {
          setMessage(quota);
          void refresh();
          return;
        }
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
      let finished = false;
      let reviewing = false;

      const applyEvent = (line: string): boolean => {
        if (!line.trim()) return false;
        let event: {
          type: string;
          delta?: string;
          replace?: boolean;
          model?: string;
          phase?: "write" | "review";
          usedCorpus?: { id: string; title: string }[];
          result?: PreviewState & { bodyMarkdown: string };
          article?: { id: string };
          message?: string;
        };
        try {
          event = JSON.parse(line) as typeof event;
        } catch {
          return false;
        }

        if (event.type === "meta") {
          if (event.model) setStreamModel(event.model);
          if (event.phase === "review") {
            reviewing = true;
            setStreamPhaseKind("review");
            setShowThinking(true);
            setStreamStatus("正在过人话审核…");
          } else if (event.phase === "write") {
            reviewing = false;
            setStreamPhaseKind("write");
          }
          return false;
        }
        if (event.type === "thinking" && event.delta) {
          setThinkingText((prev) => prev + event.delta);
          if (reviewing || event.delta.includes("人话审核")) {
            setShowThinking(true);
          }
          return false;
        }
        if (event.type === "status" && event.message) {
          setStreamStatus(event.message);
          return false;
        }
        if (event.type === "content") {
          if (event.replace) {
            markWritingStarted();
            setContentText(event.delta || "");
            return false;
          }
          if (event.delta) {
            markWritingStarted();
            setContentText((prev) => prev + event.delta);
          }
          return false;
        }
        if (event.type === "error") {
          setMessage(event.message || "生成失败");
          return true;
        }
        if (event.type === "done" && event.result) {
          const body = (event.result.bodyMarkdown || "").trim();
          if (!body) {
            setMessage(
              "正文是空的。蒸馏写手的提示词会把思考额度占满。请再点一次生成，或把写稿模型换成「DeepSeek 对话」。",
            );
            return true;
          }
          setPreview({
            title: event.result.title,
            summary: event.result.summary,
            scriptTitle: event.result.scriptTitle,
            bodyHtml: event.result.bodyHtml,
            bodyMarkdown: event.result.bodyMarkdown,
            thinking: event.result.thinking,
            usedCorpus: event.result.usedCorpus ?? [],
          });
          setStreamStatus(null);
          setMessage("生成完成，可以保存为文章");
          return true;
        }
        return false;
      };

      while (!finished) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          finished = applyEvent(buffer);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (applyEvent(line)) {
            finished = true;
            break;
          }
        }
      }

      if (!finished && !controller.signal.aborted) {
        setMessage((prev) => prev ?? "生成中断，没有收到完整结果");
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

  const canSave = Boolean(preview);
  const busy = generating || distilling || saving;
  const pickedModelLabel =
    copywritingModels.find((m) => m.id === modelSlug)?.label ||
    modelSlug ||
    "当前模型";
  const reviewing = streamPhaseKind === "review";
  const shownModelLabel = reviewing
    ? reviewModels.find((m) => m.id === (streamModel || reviewModel))?.label ||
      streamModel ||
      reviewModel ||
      "人话审核"
    : (streamModel &&
        (copywritingModels.find((m) => m.id === streamModel)?.label ||
          streamModel)) ||
      (generating ? pickedModelLabel : "");
  const streamPhase =
    saving || preview || distillPreview
      ? null
      : streamStatus
        ? streamStatus
        : busy
          ? contentText
            ? "写正文中"
            : thinkingText
              ? "思考中"
              : distilling
                ? "蒸馏中"
                : "连接中"
          : null;
  const showResult =
    busy ||
    Boolean(preview || distillPreview || thinkingText || contentText);

  function patchPreview(patch: Partial<PreviewState>) {
    setPreview((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      if (patch.bodyMarkdown != null && patch.bodyHtml == null) {
        next.bodyHtml = markdownToHtml(patch.bodyMarkdown);
      }
      return next;
    });
  }

  async function savePreviewAsArticle() {
    if (!preview || !canSave) {
      setMessage("请先生成文案再保存");
      return;
    }
    if (noArticleQuota) {
      setMessage(quotaRechargeText("articles"));
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: preview.title,
          body: preview.bodyHtml || markdownToHtml(preview.bodyMarkdown),
          summary: preview.summary,
          script_title: preview.scriptTitle || "",
          family,
          geoKeywordId: geoKeywordId || undefined,
          geoBrief: brief,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const quota = parseQuotaError(res, data);
      if (quota) {
        setMessage(quota);
        void refresh();
        setSaving(false);
        return;
      }
      if (!res.ok) {
        setMessage(data.error || "保存失败");
        setSaving(false);
        return;
      }
      if (data.article?.id) {
        void refresh();
        router.push(`/articles/${data.article.id}`);
        return;
      }
      setMessage("保存成功但未返回文章 ID");
      setSaving(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">AI写手</h1>
          <p className="mt-1 text-[var(--muted)]">
            基于语料库，AI写手自动生成品牌文案。
          </p>
        </div>
        <Link href="/corpus" className="btn btn-ghost text-sm">
          管理语料库 →
        </Link>
      </div>

      {geoKeywordId && (
        <div className="card border-[var(--accent)]/25 bg-[var(--accent-soft)]/40 px-4 py-3 text-sm">
          {kind === "marketing"
            ? `挖词痛点已带入。路子由上面的「贩卖焦虑 / 贩卖期待」决定，会注入写手，不必写进需求框。`
            : kind === "oral"
              ? `挖词痛点已带入。口播形式由上面的「单人口播 / 双人对谈」决定，会注入口播手，不必写进需求框。`
              : "正在针对这条用户痛点写文，保存后将自动关联到挖词列表（可多次写文、多篇关联）。"}
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
          ，也可以上传带说明的截图，AI 才能写出贴合你品牌/故事的文案。
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
                  const nextFamily = defaultFamilyForKind(k.id);
                  setKind(k.id);
                  setFamily(nextFamily);
                  setStyle(defaultStyleForKind(k.id));
                  let nextBrief = brief;
                  if (k.id === "script_outline") {
                    setTone("");
                    setCategories(["story", "brand", "product"]);
                  } else if (k.id === "marketing") {
                    setTone("");
                    setCategories(["product", "story", "brand"]);
                    nextBrief = marketingMaterialFor(brief);
                    setBrief(nextBrief);
                  } else if (k.id === "oral") {
                    setTone("");
                    setCategories(["product", "story", "brand"]);
                    nextBrief = marketingMaterialFor(brief);
                    setBrief(nextBrief);
                  } else {
                    if (tone === "") setTone("专业、真诚、有温度");
                    if (
                      originalGeoBriefRef.current &&
                      isDerivedMarketingMaterial(brief)
                    ) {
                      nextBrief = originalGeoBriefRef.current;
                      setBrief(nextBrief);
                    } else if (isDerivedMarketingMaterial(brief)) {
                      nextBrief =
                        composeGeoArticleBrief(geoPain, geoScene) ||
                        stripForcedMarketingLock(brief);
                      setBrief(nextBrief);
                    }
                  }
                  writeWritingQuery({
                    kind: k.id,
                    family: nextFamily,
                    brief: nextBrief,
                    marketingAngle: k.id === "marketing" ? marketingAngle : null,
                    oralMode: k.id === "oral" ? oralMode : null,
                  });
                }}
              >
                {k.label}
              </button>
            ))}
          </div>
          {kind === "marketing" ? (
            <div>
              <div className="mb-2 text-sm text-[var(--muted)]">营销路子</div>
              <p className="mb-2 text-xs text-[var(--muted)]">
                选了就按对应 Agent 写：焦虑从正在发生的糟场面起手，期待从做成之后的「那天」起手。需求框只放素材；框里的字删掉也不会丢掉路子。
              </p>
              <div className="flex flex-wrap gap-2">
                {MARKETING_ANGLES.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    title={a.hint}
                    className={`btn text-sm ${
                      marketingAngle === a.id ? "btn-primary" : "btn-ghost"
                    }`}
                    onClick={() => {
                      setMarketingAngle(a.id);
                      writeWritingQuery({
                        kind: "marketing",
                        marketingAngle: a.id,
                      });
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {kind === "oral" ? (
            <div>
              <div className="mb-2 text-sm text-[var(--muted)]">口播形式</div>
              <p className="mb-2 text-xs text-[var(--muted)]">
                选了就按口播手写：要有活人感，像当面说。单人是连环钩，对谈是一问一钩。需求框只放素材。
              </p>
              <div className="flex flex-wrap gap-2">
                {ORAL_MODES.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    title={a.hint}
                    className={`btn text-sm ${
                      oralMode === a.id ? "btn-primary" : "btn-ghost"
                    }`}
                    onClick={() => {
                      setOralMode(a.id);
                      writeWritingQuery({
                        kind: "oral",
                        oralMode: a.id,
                      });
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div>
            <div className="mb-2 text-sm text-[var(--muted)]">目标平台族</div>
            {kind === "script_outline" ? (
              <p className="mb-2 text-xs text-[var(--muted)]">
                大纲默认短视频连载。古装 / 职场这些皮，到拆剧本时再选。
              </p>
            ) : kind === "oral" ? (
              <p className="mb-2 text-xs text-[var(--muted)]">
                口播篇幅固定约 650–900 字，平台只改口气，不改长短，也不会写成小红书短帖或公众号课。
              </p>
            ) : kind === "article" ? (
              <p className="mb-2 text-xs text-[var(--muted)]">
                长文固定 3000–5000 字，平台只改口气和标题习惯，不会压成短帖。
              </p>
            ) : kind === "social" || kind === "slogan" ? (
              <p className="mb-2 text-xs text-[var(--muted)]">
                短帖/标语按文案类型写，平台只改口气，不会写成专栏长文。
              </p>
            ) : kind === "brand_intro" || kind === "product" ? (
              <p className="mb-2 text-xs text-[var(--muted)]">
                介绍/产品按一段或一篇推广写，平台只改口气，不会写成技术长文或短剧总谱。
              </p>
            ) : kind === "marketing" ? (
              <p className="mb-2 text-xs text-[var(--muted)]">
                营销文案篇幅跟平台走：社媒就短，公众号/专栏就写透。不会写成 GEO 课或短剧总谱。
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {(kind === "script_outline"
                ? WRITING_ONLY_FAMILIES
                : PLATFORM_FAMILIES
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  title={f.hint}
                  className={`btn text-sm ${family === f.id ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => {
                    if (kind === "script_outline") {
                      setFamily("short_video");
                      return;
                    }
                    setFamily(f.id);
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm text-[var(--muted)]">写作风格</div>
            <div className="flex flex-wrap gap-2">
              {COPYWRITING_STYLES.filter((s) =>
                kind === "script_outline" ? true : s.id !== "conflict_beat",
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.hint}
                  className={`btn text-sm ${
                    !writerAgentId && style === s.id ? "btn-primary" : "btn-ghost"
                  }`}
                  onClick={() => {
                    pickWriter(null);
                    if (!distilling) {
                      setAddingWriter(false);
                      setDistillPreview(null);
                    }
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
            <div className="mt-3 space-y-2">
              <div className="text-sm text-[var(--muted)]">
                我的写手
                {agents.length > 0 ? `（${agents.length}）` : ""}
              </div>
              <div className="flex flex-wrap gap-2">
                {agents.map((agent) => (
                  <span key={agent.id} className="writer-chip">
                    <button
                      type="button"
                      title={agent.hint || agent.seed}
                      className={`btn text-sm ${
                        writerAgentId === agent.id ? "btn-primary" : "btn-ghost"
                      }`}
                      onClick={() => {
                        pickWriter(agent.id);
                        if (tone === "专业、真诚、有温度") setTone("");
                        if (!distilling) {
                          setAddingWriter(false);
                          setDistillPreview(null);
                        }
                      }}
                    >
                      {agent.name}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost px-2 text-sm text-[var(--danger)]"
                      title={`删掉「${agent.name}」`}
                      onClick={() => void removeWriter(agent.id)}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className={`btn text-sm ${addingWriter ? "btn-primary" : "btn-ghost"}`}
                  disabled={busy && !addingWriter}
                  onClick={() => {
                    setAddingWriter(true);
                    setCustomSeed("");
                  }}
                >
                  + 新写手
                </button>
              </div>
              {addingWriter && (
                <div className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="flex flex-wrap gap-2">
                    <input
                      className="field min-w-[12rem] flex-1"
                      placeholder={
                        agents.length
                          ? "再加一个，比如司马生"
                          : "写个名字，比如司马生"
                      }
                      value={customSeed}
                      onChange={(e) => setCustomSeed(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void distillWriter();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void distillWriter()}
                    >
                      {distilling ? "蒸馏中…" : "蒸馏"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={distilling}
                      onClick={() => {
                        setAddingWriter(false);
                        setCustomSeed("");
                        if (!distilling) setDistillPreview(null);
                      }}
                    >
                      取消
                    </button>
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    右边看蒸馏过程。保存后会出现在上面，想加几个加几个。
                  </p>
                </div>
              )}
            </div>
          </div>
          <textarea
            className="field min-h-[140px] w-full resize-y"
            placeholder={
              kind === "script_outline"
                ? "例如：职场里被当众甩锅，想写成能连载的短剧。只写谁压谁、压的是什么，不要指定古装还是现代。"
                : kind === "marketing"
                  ? marketingAngle === "anxiety"
                    ? "例如：老板每周发内容没人问，想把「发了等于白干」挖透，再落到语料里的产品。"
                    : "例如：已经试过 SEO 的人，想让他看见「别人问起时答案里有你」之后，语料里的产品怎么走到那天。"
                  : kind === "oral"
                    ? oralMode === "dialogue"
                      ? "例如：老板不信 GEO，主持替他抬杠，嘉宾用语料里的判断一次只揭一层。"
                      : "例如：发了内容没人问，一个人钩着往下讲，每段留缺口，判断来自语料。"
                    : "描述你想写什么，例如：为点物 GEO 写一段 200 字品牌介绍，强调多平台分发与本地可控…"
            }
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
          <input
            className="field w-full"
            placeholder={
              writerAgentId
                ? "额外语气补充（可选，会叠在这个写手上）"
                : style === "default"
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
          {copywritingModels.length > 0 && (
            <label className="block">
              <div className="mb-2 text-sm text-[var(--muted)]">写稿模型</div>
              <ModelPicker
                className="w-full max-w-md"
                buttonClassName="field model-picker__btn w-full max-w-md"
                title="选择写稿模型"
                value={modelSlug}
                items={copywritingModels}
                disabled={busy}
                onChange={(next) => {
                  setModelSlug(next);
                  try {
                    localStorage.setItem("dwgeo-copywriting-model", next);
                  } catch {
                    // ignore
                  }
                }}
              />
            </label>
          )}
          {reviewModels.length > 0 && (
            <label className="block">
              <div className="mb-2 text-sm text-[var(--muted)]">人话审核</div>
              <ModelPicker
                className="w-full max-w-md"
                buttonClassName="field model-picker__btn w-full max-w-md"
                title="选择人话审核模型"
                value={reviewModel}
                items={reviewModels}
                disabled={busy}
                onChange={(next) => {
                  setReviewModel(next);
                  try {
                    localStorage.setItem("dwgeo-review-model", next);
                  } catch {
                    // ignore
                  }
                }}
              />
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || noArticleQuota}
              onClick={() => void generate()}
            >
              {generating ? "生成中…" : "生成预览"}
            </button>
            {(generating || distilling) && (
              <button type="button" className="btn btn-ghost" onClick={stopGenerate}>
                停止
              </button>
            )}
            <QuotaHint snap={articleQuota} need={1} />
          </div>
          {message && (
            <QuotaMessage
              text={message}
              className="text-sm text-[var(--accent)]"
            />
          )}
        </div>

        <div
          className={`card min-h-[420px] p-5${saving ? " is-saving" : ""}`}
          aria-busy={saving}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-medium">
              {distilling || distillPreview ? "蒸馏写手" : "生成结果"}
            </h2>
            {(streamPhase || shownModelLabel) && (
              <span className="text-xs text-[var(--muted)]">
                {[streamPhase, shownModelLabel].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>

          {!showResult ? (
            <p className="mt-8 text-center text-sm text-[var(--muted)]">
              填写需求后点「生成预览」。要自己的写手，左边点「+ 新写手」
            </p>
          ) : (
            <div className="ai-result-stream mt-4 space-y-4">
              {generating && streamStatus ? (
                <p className="text-sm text-[var(--muted)]">{streamStatus}</p>
              ) : null}
              {(thinkingText || preview?.thinking) && (
                <div
                  className={`ai-thinking-panel${
                    showThinking &&
                    busy &&
                    !distillPreview &&
                    (!contentText || streamPhaseKind === "review")
                      ? " is-live"
                      : ""
                  }`}
                >
                  <button
                    type="button"
                    className="ai-thinking-toggle"
                    onClick={() => {
                      thinkingPinnedRef.current = true;
                      setShowThinking((v) => !v);
                    }}
                  >
                    <span>
                      {streamPhaseKind === "review" ? "人话审核" : "Thinking"}
                    </span>
                    <span className="text-[var(--muted)]">
                      {showThinking ? "收起" : "展开"}
                    </span>
                  </button>
                  {showThinking && (
                    <pre ref={thinkingRef} className="ai-thinking-body">
                      {thinkingText || preview?.thinking || ""}
                    </pre>
                  )}
                </div>
              )}

              {busy && !saving && !thinkingText && !contentText && !distillPreview && (
                <p className="text-sm text-[var(--muted)]">
                  {distilling
                    ? "正在蒸馏写手，会先思考再写出完整提示词…"
                    : `正在连接 ${pickedModelLabel}，请稍候…`}
                </p>
              )}

              {distillPreview ? (
                <>
                  <div className="space-y-3">
                    <input
                      className="field w-full text-xl font-semibold"
                      value={distillPreview.name}
                      onChange={(e) =>
                        setDistillPreview((prev) =>
                          prev ? { ...prev, name: e.target.value } : prev,
                        )
                      }
                    />
                    <input
                      className="field w-full text-sm"
                      placeholder="气质标签"
                      value={distillPreview.hint}
                      onChange={(e) =>
                        setDistillPreview((prev) =>
                          prev ? { ...prev, hint: e.target.value } : prev,
                        )
                      }
                    />
                    <textarea
                      className="field min-h-[280px] w-full resize-y font-mono text-sm leading-relaxed"
                      value={distillPreview.instruction}
                      onChange={(e) =>
                        setDistillPreview((prev) =>
                          prev
                            ? { ...prev, instruction: e.target.value }
                            : prev,
                        )
                      }
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void saveWriter()}
                    >
                      保存写手
                    </button>
                  </div>
                </>
              ) : preview ? (
                <>
                  {editingPreview ? (
                    <div className="space-y-3">
                      <input
                        className="field w-full text-xl font-semibold"
                        value={preview.title}
                        onChange={(e) => patchPreview({ title: e.target.value })}
                      />
                      <input
                        className="field w-full text-sm"
                        value={preview.scriptTitle || ""}
                        placeholder="剧本名（抖音合集名）"
                        onChange={(e) =>
                          patchPreview({
                            scriptTitle: e.target.value.slice(0, 16),
                          })
                        }
                      />
                      <textarea
                        className="field min-h-[64px] w-full resize-y text-sm"
                        placeholder="摘要"
                        value={preview.summary}
                        onChange={(e) =>
                          patchPreview({ summary: e.target.value })
                        }
                      />
                      <textarea
                        className="field min-h-[280px] w-full resize-y font-mono text-sm leading-relaxed"
                        value={preview.bodyMarkdown}
                        onChange={(e) =>
                          patchPreview({ bodyMarkdown: e.target.value })
                        }
                      />
                    </div>
                  ) : (
                    <div>
                      <div className="text-xl font-semibold">{preview.title}</div>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        剧本名：{preview.scriptTitle || "（生成时会起一个合集名）"}
                      </p>
                      {preview.summary && (
                        <p className="mt-2 text-sm text-[var(--muted)]">
                          {preview.summary}
                        </p>
                      )}
                    </div>
                  )}
                  {preview.usedCorpus.length > 0 && (
                    <p className="text-xs text-[var(--muted)]">
                      引用语料：
                      {preview.usedCorpus.map((c) => c.title).join("、")}
                    </p>
                  )}
                  {!editingPreview && (
                    <div
                      className="prose-yuque max-h-[360px] overflow-y-auto rounded-xl border border-[var(--line)] bg-white/40 p-4 text-sm leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: preview.bodyHtml }}
                    />
                  )}
                  <HumanTalkRevise
                    kind={kind === "oral" ? "podcast" : "article"}
                    text={serializeCopyDraft({
                      title: preview.title,
                      summary: preview.summary,
                      scriptTitle: preview.scriptTitle,
                      bodyMarkdown: preview.bodyMarkdown,
                    })}
                    reviewModel={reviewModel}
                    disabled={busy}
                    confirming={saving}
                    confirmLabel="保存为文章并编辑"
                    onText={(next) => {
                      const parsed = parseCopyResponse(next);
                      patchPreview({
                        title: parsed.title,
                        summary: parsed.summary,
                        scriptTitle: parsed.scriptTitle || preview.scriptTitle,
                        bodyMarkdown: parsed.bodyMarkdown,
                      });
                    }}
                    onConfirm={() => savePreviewAsArticle()}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !canSave || noArticleQuota}
                      onClick={() => void savePreviewAsArticle()}
                    >
                      {saving ? "保存中…" : "保存为文章并编辑"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost text-sm"
                      disabled={busy}
                      onClick={() => setEditingPreview((v) => !v)}
                    >
                      {editingPreview ? "预览文案" : "修改文案"}
                    </button>
                    {saving ? (
                      <span className="text-sm text-[var(--muted)]">
                        已保存，正在打开编辑页…
                      </span>
                    ) : null}
                  </div>
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
