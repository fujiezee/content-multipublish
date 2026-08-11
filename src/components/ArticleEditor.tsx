"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Article,
  ArticleVariant,
  JobStatus,
  PlatformFamily,
  PlatformId,
  PlatformSession,
  PublishJob,
} from "@/lib/types";
import {
  PLATFORM_FAMILIES,
  PLATFORMS,
  familyLabel,
  platformFamily,
} from "@/lib/types";
import {
  isJobOkStatus,
  isTerminalJobStatus,
  jobStatusFromExtensionResult,
  platformPublishMode,
} from "@/lib/job-status";
import { JobBadge } from "@/components/StatusBadge";
import { PlatformIcon } from "@/components/PlatformIcon";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@/components/RichTextEditor";
import { InfographicPanel } from "@/components/InfographicPanel";
import { toEditorHtml } from "@/lib/content/adapt";
import { absolutizeHtmlMedia } from "@/lib/content/media-urls";
import {
  accountDraftUrl,
  addDianwuGeoTask,
  beginOpenDianwuGeoPanel,
  DIANWU_GEO_PRODUCT_NAME,
  formatDianwuGeoOpenMessage,
  getDianwuGeoAccounts,
  getDianwuGeoSyncHistory,
  getDianwuGeoSyncState,
  getExtensionIdFromDom,
  isAccountSuccess,
  isAccountTerminal,
  isDianwuGeoExtensionPresent,
  isExtensionPlatform,
  pingDianwuGeoExtension,
  stashArticleForDianwuGeo,
  pushDianwuGeoFamilyVariants,
  subscribeDianwuGeoSyncResults,
  subscribeDianwuGeoTaskUpdates,
  syncStateMatchesPlatforms,
  waitForDianwuGeoExtension,
  type DianwuGeoAccount,
  type DianwuGeoOpenResult,
  type DianwuGeoSyncState,
} from "@/lib/dianwu-geo";
import { isApiDraftPlatform } from "@/lib/draft-adapters/platforms";
import type { PublishEngine } from "@/lib/types";

const JOB_MAP_KEY = (articleId: string) => `dwgeo-ext-job-map:${articleId}`;

function engineLabel(engine: PublishEngine | undefined): string {
  if (engine === "extension") return "扩展";
  if (engine === "api") return "API";
  return "本机自动";
}
type SyncResultLike = {
  platform?: string;
  success?: boolean;
  error?: string;
  postUrl?: string;
  url?: string;
  draftOnly?: boolean;
  awaitingUserPublish?: boolean;
  outcome?: string;
  message?: string;
};

export function ArticleEditor({ id }: { id: string }) {
  const router = useRouter();
  const [article, setArticle] = useState<Article | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [summary, setSummary] = useState("");
  const [coverPath, setCoverPath] = useState<string | null>(null);
  const [variants, setVariants] = useState<ArticleVariant[]>([]);
  const [editingTarget, setEditingTarget] = useState<"master" | PlatformFamily>(
    "master",
  );
  const [genFamilies, setGenFamilies] = useState<PlatformFamily[]>([
    "media",
    "knowledge",
    "wechat",
  ]);
  const [showVariantPicker, setShowVariantPicker] = useState(false);
  const [generatingVariants, setGeneratingVariants] = useState(false);
  type VariantGenRow = {
    family: PlatformFamily;
    label: string;
    status: "pending" | "streaming" | "done" | "error" | "skip";
    preview: string;
    usedCorpus: { id: string; title: string }[];
    error?: string;
  };
  const [variantGenRows, setVariantGenRows] = useState<VariantGenRow[]>([]);
  const [variantGenActiveFamily, setVariantGenActiveFamily] =
    useState<PlatformFamily | null>(null);
  const variantGenAbortRef = useRef<AbortController | null>(null);
  const editorRef = useRef<RichTextEditorHandle | null>(null);
  const editingTargetRef = useRef<"master" | PlatformFamily>("master");
  useEffect(() => {
    editingTargetRef.current = editingTarget;
  }, [editingTarget]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [showPublish, setShowPublish] = useState(false);
  const [sessions, setSessions] = useState<PlatformSession[]>([]);
  const [selected, setSelected] = useState<PlatformId[]>([
    "zhihu",
    "weibo",
    "baijiahao",
    "csdn",
    "toutiao",
    "juejin",
  ]);
  const [publishing, setPublishing] = useState(false);
  const [syncingExt, setSyncingExt] = useState(false);
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [extensionReady, setExtensionReady] = useState<boolean | null>(null);
  const [clientMounted, setClientMounted] = useState(false);
  const manualSyncRunningRef = useRef(false);
  const manualSyncWaitRef = useRef<Promise<DianwuGeoOpenResult> | null>(null);
  const jobsLoadingRef = useRef(false);
  const jobsReloadQueuedRef = useRef(false);
  const jobByPlatformRef = useRef<Map<PlatformId, string>>(new Map());
  const extSyncCleanupRef = useRef<(() => void) | null>(null);
  const extSyncStartedAtRef = useRef(0);
  const patchedJobStatusRef = useRef<Map<string, JobStatus>>(new Map());

  const loadVariants = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles/${id}/variants`, {
        cache: "no-store",
      });
      const data = await res.json();
      setVariants((data.variants ?? []) as ArticleVariant[]);
    } catch {
      setVariants([]);
    }
  }, [id]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles/${id}`, { cache: "no-store" });
      if (!res.ok) {
        router.push("/");
        return;
      }
      const data = await res.json();
      const a = data.article as Article;
      const html = toEditorHtml(a.body);
      setArticle({ ...a, body: html });
      setTitle(a.title);
      setBody(html);
      setSummary(a.summary);
      setCoverPath(a.cover_path);
    } catch {
      // Transient network errors — keep current editor state.
    }
  }, [id, router]);

  const importExtensionHistory = useCallback(
    async (articleTitle?: string) => {
      try {
        if (!isDianwuGeoExtensionPresent()) {
          const ready = await waitForDianwuGeoExtension(1_500);
          if (!ready) return 0;
        }
        const history = await getDianwuGeoSyncHistory(3_000);
        if (!history.length) return 0;
        const res = await fetch(`/api/articles/${id}/jobs/extension-sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: (articleTitle || title || article?.title || "").trim(),
            entries: history,
          }),
        });
        if (!res.ok) return 0;
        const data = await res.json();
        if (Array.isArray(data.jobs)) setJobs(data.jobs);
        return Number(data.imported || 0);
      } catch {
        return 0;
      }
    },
    [id, title, article?.title],
  );

  const loadJobs = useCallback(async () => {
    if (jobsLoadingRef.current) {
      jobsReloadQueuedRef.current = true;
      return;
    }
    jobsLoadingRef.current = true;
    try {
      const res = await fetch(`/api/articles/${id}/jobs`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs ?? []);
    } catch {
      // Polling must not crash the page when the API is briefly unavailable.
    } finally {
      jobsLoadingRef.current = false;
      if (jobsReloadQueuedRef.current) {
        jobsReloadQueuedRef.current = false;
        void loadJobs();
      }
    }
  }, [id]);

  useEffect(() => {
    setArticle(null);
    setTitle("");
    setBody("");
    setSummary("");
    setCoverPath(null);
    setVariants([]);
    setEditingTarget("master");
    setJobs([]);
    manualSyncWaitRef.current = null;
    void load();
    void loadVariants();
    void loadJobs();
  }, [id, load, loadVariants, loadJobs]);

  useEffect(() => {
    if (!article) return;
    const timer = window.setTimeout(() => {
      // Fast path for content-script; variants are refreshed when opening the panel.
      stashArticleForDianwuGeo(buildManualSyncArticleBase());
    }, 200);
    return () => window.clearTimeout(timer);
  }, [article, title, body, summary, coverPath]);

  useEffect(() => {
    if (!article) return;
    const pageTitle = title.trim() || "未命名";
    const previousTitle = document.title;
    document.title = pageTitle;
    return () => {
      document.title = previousTitle;
    };
  }, [article, title]);

  useEffect(() => {
    setClientMounted(true);
  }, []);

  useEffect(() => {
    if (!clientMounted) return;
    let cancelled = false;
    const check = async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (cancelled) return;
        if (await pingDianwuGeoExtension(2000)) {
          if (!cancelled) setExtensionReady(true);
          return;
        }
        await new Promise((r) => setTimeout(r, 350));
      }
      if (!cancelled) setExtensionReady(false);
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [id, clientMounted]);

  // Pull extension popup「同步历史」into this article's job list
  useEffect(() => {
    if (!clientMounted || extensionReady !== true || !article) return;
    void importExtensionHistory(article.title || title);
  }, [
    clientMounted,
    extensionReady,
    article,
    title,
    importExtensionHistory,
  ]);

  const dirty = useMemo(() => {
    if (!article) return false;
    if (editingTarget === "master") {
      return (
        title !== article.title ||
        body !== article.body ||
        summary !== article.summary ||
        coverPath !== article.cover_path
      );
    }
    const variant = variants.find((v) => v.family === editingTarget);
    if (!variant) {
      return Boolean(title.trim() || body.trim() || summary.trim());
    }
    return (
      title !== variant.title ||
      body !== toEditorHtml(variant.body) ||
      summary !== (variant.summary || "")
    );
  }, [article, editingTarget, variants, title, body, summary, coverPath]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      if (editingTarget === "master") {
        const res = await fetch(`/api/articles/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            body,
            summary,
            cover_path: coverPath,
          }),
        });
        const data = await res.json();
        setArticle(data.article);
      } else {
        const res = await fetch(`/api/articles/${id}/variants`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            family: editingTarget,
            title,
            body,
            summary,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "保存变体失败");
        }
        await loadVariants();
      }
      setSavedAt(new Date().toLocaleTimeString("zh-CN"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function switchEditingTarget(next: "master" | PlatformFamily) {
    if (next === editingTarget) return;
    if (dirty) await save();
    if (next === "master") {
      if (article) {
        setTitle(article.title);
        setBody(toEditorHtml(article.body));
        setSummary(article.summary);
      }
      setEditingTarget("master");
      return;
    }
    const variant = variants.find((v) => v.family === next);
    if (variant) {
      setTitle(variant.title);
      setBody(toEditorHtml(variant.body));
      setSummary(variant.summary || "");
    } else {
      setTitle(article?.title || "");
      setBody("");
      setSummary("");
    }
    setEditingTarget(next);
  }

  function stopVariantGeneration() {
    variantGenAbortRef.current?.abort();
    variantGenAbortRef.current = null;
    setGeneratingVariants(false);
    setMessage("已停止变体生成");
  }

  function openVariantPicker() {
    // Prefer pre-selecting families that still lack a body.
    const missing = PLATFORM_FAMILIES.map((f) => f.id).filter(
      (f) => !variants.some((v) => v.family === f && v.body?.trim()),
    );
    setGenFamilies(missing.length ? missing : PLATFORM_FAMILIES.map((f) => f.id));
    setShowVariantPicker(true);
  }

  async function generateSelectedVariants(
    force = false,
    familiesOverride?: PlatformFamily[],
  ) {
    const families = familiesOverride?.length
      ? familiesOverride
      : genFamilies;
    if (!families.length) {
      setMessage("请先选择要生成的平台族");
      return;
    }
    setShowVariantPicker(false);
    if (dirty) await save();
    // Stay on current empty family if generating only that one; otherwise go master.
    if (
      !(
        families.length === 1 &&
        editingTarget === families[0]
      ) &&
      editingTarget !== "master"
    ) {
      await switchEditingTarget("master");
    }

    variantGenAbortRef.current?.abort();
    const controller = new AbortController();
    variantGenAbortRef.current = controller;

    setGeneratingVariants(true);
    setMessage(null);
    setVariantGenActiveFamily(null);
    setVariantGenRows(
      families.map((f) => ({
        family: f,
        label: familyLabel(f),
        status: "pending" as const,
        preview: "",
        usedCorpus: [],
      })),
    );

    const patchRow = (
      family: PlatformFamily,
      patch: Partial<VariantGenRow>,
    ) => {
      setVariantGenRows((prev) =>
        prev.map((row) =>
          row.family === family ? { ...row, ...patch } : row,
        ),
      );
    };

    try {
      const res = await fetch(`/api/articles/${id}/variants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "adapt",
          families,
          force,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `生成失败（${res.status}）`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("流式响应不可用");

      const decoder = new TextDecoder();
      let buffer = "";
      let errorCount = 0;
      let doneCount = 0;

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
            family?: PlatformFamily;
            label?: string;
            delta?: string;
            error?: string;
            usedCorpus?: { id: string; title: string }[];
            variants?: ArticleVariant[];
            variant?: ArticleVariant;
            index?: number;
            total?: number;
          };
          try {
            event = JSON.parse(line) as typeof event;
          } catch {
            continue;
          }

          if (event.type === "family_start" && event.family) {
            setVariantGenActiveFamily(event.family);
            patchRow(event.family, {
              status: "streaming",
              label: event.label || familyLabel(event.family),
              preview: "",
              error: undefined,
            });
            setMessage(
              `正在生成 ${event.label || event.family}（${event.index}/${event.total}）…`,
            );
            continue;
          }
          if (event.type === "family_skip" && event.family) {
            patchRow(event.family, {
              status: "skip",
              label: event.label || familyLabel(event.family),
            });
            doneCount += 1;
            continue;
          }
          if (event.type === "family_meta" && event.family) {
            patchRow(event.family, {
              usedCorpus: event.usedCorpus || [],
            });
            continue;
          }
          if (event.type === "family_content" && event.family && event.delta) {
            setVariantGenRows((prev) =>
              prev.map((row) =>
                row.family === event.family
                  ? {
                      ...row,
                      status: "streaming",
                      preview: (row.preview + event.delta!).slice(-2400),
                    }
                  : row,
              ),
            );
            continue;
          }
          if (event.type === "family_done" && event.family) {
            patchRow(event.family, {
              status: "done",
              usedCorpus: event.usedCorpus || [],
            });
            doneCount += 1;
            if (event.variant) {
              setVariants((prev) => {
                const others = prev.filter((v) => v.family !== event.family);
                return [...others, event.variant!];
              });
              // If user is viewing this family, load the new content in.
              if (editingTargetRef.current === event.family) {
                setTitle(event.variant.title);
                setBody(toEditorHtml(event.variant.body));
                setSummary(event.variant.summary || "");
              }
            }
            continue;
          }
          if (event.type === "family_error" && event.family) {
            errorCount += 1;
            patchRow(event.family, {
              status: "error",
              error: event.error || "生成失败",
            });
            continue;
          }
          if (event.type === "batch_done") {
            if (Array.isArray(event.variants)) {
              setVariants(event.variants);
            } else {
              await loadVariants();
            }
            setMessage(
              errorCount
                ? `变体生成结束：成功 ${doneCount}，失败 ${errorCount}`
                : `变体生成完成（${doneCount} 个平台族）`,
            );
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setMessage("已停止变体生成");
      } else {
        setMessage(err instanceof Error ? err.message : "生成变体失败");
      }
      await loadVariants();
    } finally {
      setGeneratingVariants(false);
      setVariantGenActiveFamily(null);
      variantGenAbortRef.current = null;
    }
  }

  async function openSyncModal() {
    if (dirty) await save();
    await loadVariants();
    const res = await fetch("/api/platforms");
    const data = await res.json();
    setSessions(data.sessions ?? []);
    setShowPublish(true);
  }

  function buildManualSyncArticleBase() {
    const origin = window.location.origin;
    let thumb: string | undefined;
    if (coverPath) {
      if (coverPath.startsWith("http")) {
        thumb = coverPath;
      } else {
        const name = coverPath.split("/").pop();
        thumb = name ? `${origin}/api/uploads/${name}` : undefined;
      }
    }
    return {
      title: title.trim() || "未命名",
      desc: summary.trim() || undefined,
      // Extension adapters resolve relative /api/uploads against the platform
      // origin and leave broken links — always stash absolute URLs.
      content: absolutizeHtmlMedia(body || "<p></p>", origin),
      thumb,
    };
  }

  /** Include platform-family variants so the extension popup can auto-pick copy. */
  async function buildManualSyncArticle(): Promise<{
    title: string;
    desc?: string;
    content: string;
    thumb?: string;
    familyVariants?: Record<
      string,
      {
        title: string;
        content: string;
        html: string;
        markdown: string;
        summary?: string;
      }
    >;
  }> {
    const base = buildManualSyncArticleBase();
    try {
      const res = await fetch(`/api/articles/${id}/sync-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platforms: PLATFORMS.map((p) => p.id),
          origin: window.location.origin,
        }),
      });
      const data = await res.json();
      if (!res.ok) return base;
      const familyVariants: Record<
        string,
        {
          title: string;
          content: string;
          html: string;
          markdown: string;
          summary?: string;
        }
      > = {};
      for (const group of data.groups || []) {
        if (!group?.family || !group?.content) continue;
        familyVariants[group.family] = {
          title: group.title || base.title,
          content: group.content,
          html: group.content,
          markdown: group.markdown || "",
          summary: group.summary,
        };
      }
      return { ...base, familyVariants };
    } catch {
      return base;
    }
  }

  async function patchJob(
    jobId: string,
    patch: {
      status: JobStatus;
      result_url?: string | null;
      error?: string | null;
    },
  ): Promise<boolean> {
    if (isTerminalJobStatus(patch.status)) {
      const prev = patchedJobStatusRef.current.get(jobId);
      if (prev === patch.status) return true;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (res.ok) {
          if (isTerminalJobStatus(patch.status)) {
            patchedJobStatusRef.current.set(jobId, patch.status);
          }
          return true;
        }
      } catch {
        // retry once
      }
    }
    return false;
  }

  function persistJobMap(map: Map<PlatformId, string>) {
    const raw = JSON.stringify(Object.fromEntries(map));
    try {
      localStorage.setItem(JOB_MAP_KEY(id), raw);
    } catch {
      // ignore
    }
    try {
      sessionStorage.setItem(JOB_MAP_KEY(id), raw);
    } catch {
      // ignore
    }
  }

  function restoreJobMap(): Map<PlatformId, string> {
    for (const store of [localStorage, sessionStorage]) {
      try {
        const raw = store.getItem(JOB_MAP_KEY(id));
        if (!raw) continue;
        const obj = JSON.parse(raw) as Record<string, string>;
        return new Map(
          Object.entries(obj).map(([k, v]) => [k as PlatformId, v]),
        );
      } catch {
        // try next store
      }
    }
    return new Map();
  }

  function resolveJobId(platform: string): string | undefined {
    const map = jobByPlatformRef.current;
    const direct = map.get(platform as PlatformId);
    if (direct) return direct;
    for (const [pid, jid] of map) {
      if (pid.toLowerCase() === platform.toLowerCase()) return jid;
    }
    return undefined;
  }

  async function applyResultList(results: SyncResultLike[]) {
    let wrote = false;
    for (const result of results) {
      if (!result.platform) continue;
      const jobId = resolveJobId(result.platform);
      if (!jobId) continue;
      const status = jobStatusFromExtensionResult({
        ...result,
        platform: result.platform,
      });
      const tip =
        status === "filled_awaiting_publish"
          ? result.error || "已填入，请在平台窗口确认后点发布"
          : status === "failed"
            ? result.error || "扩展同步失败"
            : null;
      wrote =
        (await patchJob(jobId, {
          status,
          result_url:
            status === "failed"
              ? null
              : result.postUrl || result.url || null,
          error: tip,
        })) || wrote;
    }
    if (wrote) await loadJobs();
    return wrote;
  }

  async function applyExtensionAccountUpdate(account: DianwuGeoAccount) {
    const platform = account.type as PlatformId;
    const jobId = resolveJobId(platform);
    if (!jobId || !isAccountTerminal(account)) return;

    if (isAccountSuccess(account)) {
      const mode = platformPublishMode(platform);
      await patchJob(jobId, {
        status:
          mode === "fill_confirm" ? "filled_awaiting_publish" : "draft_ok",
        result_url: accountDraftUrl(account),
        error:
          mode === "fill_confirm"
            ? account.msg || "已填入，请确认后点发布"
            : null,
      });
    } else {
      await patchJob(jobId, {
        status: "failed",
        error: account.error || account.msg || "扩展同步失败",
        result_url: null,
      });
    }
    void loadJobs();
  }

  async function finalizeCompletedSync(
    platforms: PlatformId[],
    state: DianwuGeoSyncState | null,
    opts?: { startedAt?: number },
  ) {
    if (
      !syncStateMatchesPlatforms(state, platforms, {
        startedAt: opts?.startedAt ?? extSyncStartedAtRef.current,
      })
    ) {
      return false;
    }
    if (state?.results?.length) {
      await applyResultList(state.results);
    }
    if (state?.status !== "completed") return false;

    let wrote = false;
    for (const pid of platforms) {
      const jobId = resolveJobId(pid);
      if (!jobId) continue;
      if (patchedJobStatusRef.current.has(jobId)) continue;
      wrote =
        (await patchJob(jobId, {
          status: "failed",
          error: "扩展未返回该平台结果",
        })) || wrote;
    }
    if (wrote) await loadJobs();
    return true;
  }

  async function applySyncStateToJobs(
    platforms: PlatformId[],
    state: DianwuGeoSyncState | null,
    opts?: { startedAt?: number },
  ) {
    if (
      !syncStateMatchesPlatforms(state, platforms, {
        startedAt: opts?.startedAt ?? extSyncStartedAtRef.current,
      })
    ) {
      return false;
    }
    if (!state?.results?.length && state?.status !== "completed") return false;
    if (state.results?.length) {
      await applyResultList(state.results);
    }
    return state.status === "completed";
  }

  function stopExtensionSyncWatchers() {
    extSyncCleanupRef.current?.();
    extSyncCleanupRef.current = null;
  }

  function startExtensionSyncWatchers(
    platforms: PlatformId[],
    opts?: { startedAt?: number },
  ) {
    stopExtensionSyncWatchers();
    const startedAt = opts?.startedAt ?? Date.now();
    extSyncStartedAtRef.current = startedAt;

    const unsubTask = subscribeDianwuGeoTaskUpdates(async (update) => {
      for (const acc of update.accounts || []) {
        await applyExtensionAccountUpdate(acc);
      }
    });

    const unsubResult = subscribeDianwuGeoSyncResults(async (result) => {
      await applyResultList([result]);
    });

    const timeoutId = window.setTimeout(async () => {
      const map = jobByPlatformRef.current;
      const state = await getDianwuGeoSyncState(3_000);
      if (state?.status === "completed") {
        await finalizeCompletedSync(platforms, state, { startedAt });
      } else {
        await applySyncStateToJobs(platforms, state, { startedAt });
        const latest = await fetch(`/api/articles/${id}/jobs`, {
          cache: "no-store",
        })
          .then((r) => r.json())
          .catch(() => ({ jobs: [] }));
        for (const j of (latest.jobs ?? []) as PublishJob[]) {
          if (map.get(j.platform) === j.id && j.status === "running") {
            await patchJob(j.id, {
              status: "failed",
              error: "扩展同步超时，请在 Chrome 确认平台已登录后重试",
            });
          }
        }
        void loadJobs();
      }
      stopExtensionSyncWatchers();
    }, 3 * 60_000);

    // Primary recovery: poll activeSyncState (popup "同步完成" reads this)
    const pollId = window.setInterval(() => {
      void (async () => {
        const state = await getDianwuGeoSyncState(2_500);
        if (
          state?.status === "completed" &&
          syncStateMatchesPlatforms(state, platforms, { startedAt })
        ) {
          await finalizeCompletedSync(platforms, state, { startedAt });
        } else if (state?.status !== "completed") {
          await applySyncStateToJobs(platforms, state, { startedAt });
        }

        const map = jobByPlatformRef.current;
        const listRes = await fetch(`/api/articles/${id}/jobs`, {
          cache: "no-store",
        })
          .then((r) => r.json())
          .catch(() => ({ jobs: [] }));
        const list = (listRes.jobs ?? []) as PublishJob[];
        setJobs(list);
        const allDone = platforms.every((pid) => {
          const jobId = map.get(pid);
          const job = list.find((j) => j.id === jobId);
          return !!job && isTerminalJobStatus(job.status);
        });
        if (allDone) stopExtensionSyncWatchers();
      })();
    }, 1500);

    extSyncCleanupRef.current = () => {
      unsubTask();
      unsubResult();
      window.clearTimeout(timeoutId);
      window.clearInterval(pollId);
    };
  }

  /**
   * Kick off extension sync and return immediately — do not block the UI.
   * Final results are applied when addTask resolves + background watchers.
   */
  async function runExtensionSync(platforms: PlatformId[]) {
    const articlePayload = await buildManualSyncArticle();
    stashArticleForDianwuGeo(articlePayload);
    void pushDianwuGeoFamilyVariants(articlePayload.familyVariants);

    const res = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        articleId: id,
        platforms,
        engine: "extension",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "创建扩展同步任务失败");
    }

    const created = (data.jobs ?? []) as PublishJob[];
    const map = restoreJobMap();
    for (const j of created) {
      map.set(j.platform, j.id);
      patchedJobStatusRef.current.delete(j.id);
    }
    jobByPlatformRef.current = map;
    persistJobMap(map);

    const contentRes = await fetch(`/api/articles/${id}/sync-content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platforms }),
    });
    const contentData = await contentRes.json();
    if (!contentRes.ok) {
      throw new Error(contentData.error || "解析平台正文失败");
    }

    type SyncGroup = {
      family: PlatformFamily;
      platforms: PlatformId[];
      title: string;
      content: string;
      markdown?: string;
      summary?: string;
    };
    const groups = (contentData.groups ?? []) as SyncGroup[];
    const missing = (contentData.missingFamilies ?? []) as PlatformFamily[];
    if (missing.length) {
      setMessage(
        `部分平台尚无专属变体（${missing.map(familyLabel).join("、")}），将暂用主稿；可先生成变体再同步`,
      );
    }

    const extAccounts = await getDianwuGeoAccounts(2_500);
    const thumb = articlePayload.thumb;

    const syncStartedAt = Date.now();
    startExtensionSyncWatchers(platforms, { startedAt: syncStartedAt });

    void (async () => {
      try {
        for (const group of groups) {
          const accounts: DianwuGeoAccount[] = group.platforms.map((pid) => {
            const fromExt = extAccounts.find((a) => a.type === pid);
            if (fromExt)
              return { ...fromExt, status: "uploading", msg: "准备同步..." };
            const meta = PLATFORMS.find((p) => p.id === pid);
            return {
              type: pid,
              title: meta?.name || pid,
              displayName: meta?.name || pid,
              supportTypes: ["html"],
              status: "uploading",
              msg: "准备同步...",
            };
          });

          const out = await addDianwuGeoTask(
            {
              post: {
                title: group.title,
                content: group.content,
                markdown: group.markdown || "",
                thumb,
                desc: group.summary,
              },
              accounts,
            },
            async (update) => {
              for (const acc of update.accounts || []) {
                await applyExtensionAccountUpdate(acc);
              }
            },
          );
          if (out.results?.length) {
            await applyResultList(out.results);
          }
        }

        const state = await getDianwuGeoSyncState(3_000);
        if (state?.status === "completed") {
          await finalizeCompletedSync(platforms, state, {
            startedAt: syncStartedAt,
          });
        } else if (
          state?.results?.length &&
          syncStateMatchesPlatforms(state, platforms, {
            startedAt: syncStartedAt,
          })
        ) {
          await applyResultList(state.results);
        }
        await importExtensionHistory(title.trim() || article?.title);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "扩展同步任务提交失败";
        for (const pid of platforms) {
          const jobId = resolveJobId(pid);
          if (!jobId || patchedJobStatusRef.current.has(jobId)) continue;
          await patchJob(jobId, { status: "failed", error: msg });
        }
        void loadJobs();
      }
    })();

    await loadJobs();
  }

  async function runPlaywrightSync(platforms: PlatformId[]) {
    const res = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        articleId: id,
        platforms,
        engine: "playwright",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "加入本机自动队列失败");
    }
  }

  async function runApiSync(platforms: PlatformId[]) {
    const res = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        articleId: id,
        platforms,
        engine: "api",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "加入 API 草稿队列失败");
    }
  }

  function sessionConnected(platform: PlatformId): boolean {
    return sessions.some(
      (s) => s.platform === platform && s.status === "connected",
    );
  }

  function canUseApiDraft(platform: PlatformId): boolean {
    return isApiDraftPlatform(platform) && sessionConnected(platform);
  }

  async function startSync() {
    setPublishing(true);
    setMessage(null);
    try {
      if (dirty) await save();

      const apiPlatforms = selected.filter((p) => canUseApiDraft(p));
      const remainder = selected.filter((p) => !canUseApiDraft(p));
      const extPlatforms = remainder.filter((p) => isExtensionPlatform(p));
      const pwPlatforms = remainder.filter((p) => !isExtensionPlatform(p));

      const extOk =
        extensionReady === true ||
        isDianwuGeoExtensionPresent() ||
        (await waitForDianwuGeoExtension(2_000));

      const parts: string[] = [];

      if (apiPlatforms.length) {
        await runApiSync(apiPlatforms);
        parts.push(
          `已加入 API 草稿队列 ${apiPlatforms.length} 个平台（无需开窗）`,
        );
      }

      if (extPlatforms.length && extOk) {
        setExtensionReady(true);
        await runExtensionSync(extPlatforms);
        parts.push(
          `已启动扩展同步 ${extPlatforms.length} 个平台（草稿优先，进度见下方记录）`,
        );
      } else if (extPlatforms.length && !extOk) {
        setExtensionReady(false);
        await runPlaywrightSync(extPlatforms);
        parts.push(
          `未检测到扩展，已将 ${extPlatforms.length} 个平台改走本机自动`,
        );
      }

      if (pwPlatforms.length) {
        await runPlaywrightSync(pwPlatforms);
        parts.push(
          `本机自动队列 ${pwPlatforms.length} 个平台（一次一窗，关窗后继续）`,
        );
      }

      setShowPublish(false);
      setMessage(parts.join("；") || "已提交同步");
      await loadJobs();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  }

  useEffect(() => {
    return () => stopExtensionSyncWatchers();
  }, []);

  // Resume / recover: poll extension activeSyncState while jobs stay "running"
  useEffect(() => {
    if (!clientMounted) return;
    const runningExt = jobs.filter(
      (j) => j.engine === "extension" && j.status === "running",
    );
    if (!runningExt.length) return;

    const map = restoreJobMap();
    for (const j of runningExt) {
      map.set(j.platform, j.id);
    }
    jobByPlatformRef.current = map;
    persistJobMap(map);

    const platforms = runningExt.map((j) => j.platform);
    if (!extSyncCleanupRef.current) {
      // Page reload mid-sync: do not use Date.now() as startedAt (would reject
      // a legitimately completed state whose startTime is in the past).
      startExtensionSyncWatchers(platforms, { startedAt: 0 });
    }
    void getDianwuGeoSyncState(3_000).then(async (state) => {
      if (state?.status === "completed") {
        await finalizeCompletedSync(platforms, state, { startedAt: 0 });
      } else {
        await applySyncStateToJobs(platforms, state, { startedAt: 0 });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recover whenever running ext jobs appear
  }, [clientMounted, jobs]);

  async function onCover(file: File | null) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await res.json();
    if (data.path) setCoverPath(data.path);
  }

  useEffect(() => {
    if (!jobs.some((j) => j.status === "pending" || j.status === "running"))
      return;
    const t = setInterval(() => void loadJobs(), 2000);
    return () => clearInterval(t);
  }, [jobs, loadJobs]);

  async function runOpenExtensionPanel() {
    if (manualSyncRunningRef.current || syncingExt) return;
    manualSyncRunningRef.current = true;
    setSyncingExt(true);
    setMessage(null);

    if (!isDianwuGeoExtensionPresent()) {
      const ready = await waitForDianwuGeoExtension(3_000);
      if (!ready) {
        const domMarker = getExtensionIdFromDom();
        const origin =
          typeof window !== "undefined" ? window.location.origin : "";
        setExtensionReady(false);
        setMessage(
          domMarker
            ? `${DIANWU_GEO_PRODUCT_NAME}已连接但页面桥接未就绪，请硬刷新（Cmd+Shift+R）后重试。`
            : `未检测到${DIANWU_GEO_PRODUCT_NAME}。请在 chrome://extensions 加载 tools/dianwu-geo，并用 ${origin.includes("localhost") || origin.includes("127.0.0.1") ? origin : "http://localhost:3000"} 打开本页后硬刷新。`,
        );
        manualSyncRunningRef.current = false;
        setSyncingExt(false);
        return;
      }
    }

    const wait =
      manualSyncWaitRef.current ??
      beginOpenDianwuGeoPanel(buildManualSyncArticleBase()).wait;
    manualSyncWaitRef.current = null;
    stashArticleForDianwuGeo(buildManualSyncArticleBase());
    const saveTask = dirty ? save() : Promise.resolve();
    const variantsTask = buildManualSyncArticle().then((full) => {
      stashArticleForDianwuGeo(full);
      return pushDianwuGeoFamilyVariants(full.familyVariants);
    });

    try {
      const [result] = await Promise.all([wait, saveTask, variantsTask]);
      setExtensionReady(true);
      setMessage(formatDianwuGeoOpenMessage(result));
      // Popup sync writes chrome.storage.syncHistory — poll a bit then show below
      for (let i = 0; i < 8; i += 1) {
        await new Promise((r) => setTimeout(r, 1500));
        const imported = await importExtensionHistory(
          title.trim() || article?.title,
        );
        if (imported > 0) {
          setMessage(
            (prev) =>
              `${prev ? `${prev} · ` : ""}已从扩展同步历史写入 ${imported} 条记录`,
          );
          break;
        }
      }
      await loadJobs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage(msg);
    } finally {
      manualSyncRunningRef.current = false;
      setSyncingExt(false);
    }
  }

  function handleOpenPanelPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 || manualSyncRunningRef.current || !title.trim()) return;
    // Keep user-gesture path sync; family variants are pushed right after.
    const base = buildManualSyncArticleBase();
    const { wait } = beginOpenDianwuGeoPanel(base);
    manualSyncWaitRef.current = wait;
    void buildManualSyncArticle().then((full) => {
      stashArticleForDianwuGeo(full);
      void pushDianwuGeoFamilyVariants(full.familyVariants);
    });
    void runOpenExtensionPanel();
  }

  if (!article) {
    return <div className="card p-8 text-[var(--muted)]">加载中…</div>;
  }

  const extSelected = selected.filter((p) => isExtensionPlatform(p)).length;
  const pwSelected = selected.length - extSelected;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => router.push("/")}
        >
          ← 返回
        </button>
        <div className="flex items-center gap-2">
          {savedAt && (
            <span className="text-sm text-[var(--muted)]">已保存 {savedAt}</span>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={save}
            disabled={saving || !dirty}
          >
            {saving ? "保存中…" : dirty ? "保存" : "已保存"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onPointerDown={handleOpenPanelPointerDown}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void runOpenExtensionPanel();
              }
            }}
            disabled={syncingExt || !title.trim()}
            title={`仅打开扩展面板，在面板内手勾平台（${DIANWU_GEO_PRODUCT_NAME}）`}
          >
            {syncingExt ? "拉起中…" : "打开扩展面板"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void openSyncModal()}
            disabled={!title.trim()}
          >
            多平台同步
          </button>
        </div>
      </div>

      {clientMounted && extensionReady === false && (
        <div className="card border-amber-300/60 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
          未检测到{DIANWU_GEO_PRODUCT_NAME}。请在{" "}
          <code className="rounded bg-white/80 px-1">chrome://extensions</code>{" "}
          开发者模式加载仓库内{" "}
          <code className="rounded bg-white/80 px-1">tools/dianwu-geo</code>
          ，用 localhost 打开本页并硬刷新。仍可点「多平台同步」走本机自动（实验）。
        </div>
      )}

      {message && (
        <div className="card border-[var(--accent)]/30 bg-[var(--accent-soft)]/50 px-4 py-3 text-sm">
          {message}
        </div>
      )}

      <div className="card space-y-3 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium">正文版本</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              主稿用于编辑；同步时按平台族自动选用变体（缺省回退主稿）
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {generatingVariants && (
              <button
                type="button"
                className="btn btn-ghost text-xs"
                onClick={stopVariantGeneration}
              >
                停止
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost text-xs"
              disabled={generatingVariants}
              onClick={openVariantPicker}
            >
              {generatingVariants ? "生成中…" : "生成/刷新变体"}
            </button>
          </div>
        </div>
        {variantGenRows.length > 0 && (
          <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_6%,transparent)] p-3">
            <div className="text-xs font-medium text-[var(--muted)]">
              生成进度（语料按主稿主题筛选，再按平台族偏好加权）
            </div>
            <ul className="space-y-2">
              {variantGenRows.map((row) => {
                const statusText =
                  row.status === "pending"
                    ? "等待中"
                    : row.status === "streaming"
                      ? "生成中"
                      : row.status === "done"
                        ? "已完成"
                        : row.status === "skip"
                          ? "已跳过（已有）"
                          : "失败";
                return (
                  <li
                    key={row.family}
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      variantGenActiveFamily === row.family
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]/40"
                        : "border-[var(--line)] bg-[#fffdf9]"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{row.label}</span>
                      <span
                        className={`text-xs ${
                          row.status === "error"
                            ? "text-[var(--danger)]"
                            : row.status === "done" || row.status === "skip"
                              ? "text-[var(--ok)]"
                              : "text-[var(--muted)]"
                        }`}
                      >
                        {statusText}
                      </span>
                    </div>
                    {row.usedCorpus.length > 0 && (
                      <p className="mt-1 text-[11px] text-[var(--muted)]">
                        语料：
                        {row.usedCorpus.map((c) => c.title).join("、")}
                      </p>
                    )}
                    {row.error && (
                      <p className="mt-1 text-xs text-[var(--danger)]">
                        {row.error}
                      </p>
                    )}
                    {row.preview && row.status === "streaming" && (
                      <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--muted)]">
                        {row.preview}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`btn text-sm ${editingTarget === "master" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => void switchEditingTarget("master")}
          >
            主稿
          </button>
          {PLATFORM_FAMILIES.map((f) => {
            const variant = variants.find((v) => v.family === f.id);
            const chars = variant
              ? toEditorHtml(variant.body).replace(/<[^>]+>/g, "").length
              : 0;
            return (
              <button
                key={f.id}
                type="button"
                title={f.hint}
                className={`btn text-sm ${editingTarget === f.id ? "btn-primary" : "btn-ghost"}`}
                onClick={() => void switchEditingTarget(f.id)}
              >
                {f.label}
                {variant ? (
                  <span className="ml-1 text-[10px] opacity-70">
                    {chars || "有"}
                  </span>
                ) : (
                  <span className="ml-1 text-[10px] opacity-50">缺</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card space-y-4 p-5 md:p-7">
        {editingTarget !== "master" && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[var(--muted)]">
              正在编辑「{familyLabel(editingTarget)}」变体；保存只写入该版本，不影响主稿。
            </p>
            {(!body.trim() ||
              !variants.some(
                (v) => v.family === editingTarget && v.body?.trim(),
              )) && (
              <button
                type="button"
                className="btn btn-primary text-xs"
                disabled={generatingVariants}
                onClick={() =>
                  void generateSelectedVariants(true, [editingTarget])
                }
              >
                {generatingVariants &&
                variantGenActiveFamily === editingTarget
                  ? "生成中…"
                  : "生成此版本"}
              </button>
            )}
          </div>
        )}
        {editingTarget !== "master" &&
          !body.trim() &&
          !generatingVariants && (
            <div className="rounded-xl border border-dashed border-[var(--line)] bg-[color-mix(in_srgb,var(--muted)_6%,transparent)] px-4 py-8 text-center">
              <p className="text-sm text-[var(--muted)]">
                「{familyLabel(editingTarget)}」尚未生成，可基于主稿一键生成。
              </p>
              <button
                type="button"
                className="btn btn-primary mt-3"
                onClick={() =>
                  void generateSelectedVariants(true, [editingTarget])
                }
              >
                生成「{familyLabel(editingTarget)}」
              </button>
            </div>
          )}
        <input
          className="field text-2xl font-semibold"
          placeholder="文章标题"
          value={title}
          data-dwgeo-article-title
          data-value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="field"
          placeholder="摘要（可选，用于部分平台简介）"
          value={summary}
          data-dwgeo-article-summary
          onChange={(e) => setSummary(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          {coverPath && (
            <span
              className="hidden"
              aria-hidden
              data-dwgeo-article-cover={
                coverPath.startsWith("http")
                  ? coverPath
                  : `/api/uploads/${coverPath.split("/").pop()}`
              }
            />
          )}
          <label className="btn btn-ghost cursor-pointer">
            上传封面
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void onCover(e.target.files?.[0] ?? null)}
            />
          </label>
          {coverPath && (
            <span className="text-sm text-[var(--muted)]">
              封面已选 ·{" "}
              <button
                className="underline"
                onClick={() => setCoverPath(null)}
                type="button"
              >
                清除
              </button>
            </span>
          )}
        </div>
        <InfographicPanel
          articleId={id}
          title={title}
          bodyHtml={body}
          editingTarget={editingTarget}
          onApplyBody={(html) => {
            setBody(html);
            if (editingTarget === "master" && article) {
              setArticle({ ...article, body: html });
            }
            editorRef.current?.focus();
          }}
          onVariantsSynced={(next) => setVariants(next)}
        />
        <div data-dwgeo-article-body>
          <RichTextEditor
            ref={editorRef}
            value={body}
            onChange={setBody}
            placeholder="在这里写正文，支持标题、加粗、列表、链接、图片…"
          />
        </div>
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-medium">本文同步记录</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              含编辑器任务与扩展历史。小红书等为「待你发布」；知乎等为「已进草稿」
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => {
              void (async () => {
                await importExtensionHistory(title.trim() || article.title);
                await loadJobs();
              })();
            }}
          >
            同步扩展历史
          </button>
        </div>
        {jobs.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            暂无记录。在扩展里同步完成后点「同步扩展历史」，或使用上方「多平台同步」。
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {jobs.slice(0, 20).map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[#fffdf9] px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <JobBadge status={job.status} />
                  <span>
                    {PLATFORMS.find((p) => p.id === job.platform)?.name}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {engineLabel(job.engine)}
                  </span>
                </div>
                <div className="max-w-md text-right text-sm text-[var(--muted)]">
                  {job.result_url ? (
                    <a
                      href={job.result_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {job.status === "filled_awaiting_publish"
                        ? "打开创作页"
                        : job.status === "published"
                          ? "查看文章"
                          : "打开草稿"}
                    </a>
                  ) : null}
                  {job.error ? (
                    <p
                      className={
                        isJobOkStatus(job.status)
                          ? "mt-0.5 text-xs text-[var(--muted)]"
                          : "mt-0.5 text-xs text-[var(--danger)]"
                      }
                    >
                      {job.error}
                    </p>
                  ) : !job.result_url ? (
                    new Date(job.updated_at).toLocaleString("zh-CN")
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showPublish && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/35 p-4 sm:p-6">
          <div className="card flex max-h-[min(92vh,900px)] w-full max-w-4xl flex-col p-0 shadow-2xl">
            <div className="shrink-0 border-b border-[var(--line)] px-6 py-5 sm:px-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">多平台同步</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    点击平台卡片选择账号。同步时按平台族自动选用对应正文变体。
                    {extensionReady === false
                      ? " · 当前未检测到扩展，扩展平台将回落本机自动"
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
                  <span>
                    已选 {selected.length} · 扩展 {extSelected} · 本机 {pwSelected}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost px-2.5 py-1 text-xs"
                    onClick={() => setSelected(PLATFORMS.map((p) => p.id))}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost px-2.5 py-1 text-xs"
                    onClick={() => setSelected([])}
                  >
                    清空
                  </button>
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-8">
              {selected.length > 0 && (
                <p className="mb-3 text-xs text-[var(--muted)]">
                  将按账号自动选用文案：
                  {[
                    ...new Set(selected.map((p) => platformFamily(p))),
                  ]
                    .map((f) => {
                      const has = variants.some(
                        (v) => v.family === f && v.body?.trim(),
                      );
                      return `${familyLabel(f)}${has ? "" : "（缺→主稿）"}`;
                    })
                    .join(" · ")}
                </p>
              )}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                {PLATFORMS.map((p) => {
                  const session = sessions.find((s) => s.platform === p.id);
                  const connected = session?.status === "connected";
                  const viaApi = isApiDraftPlatform(p.id) && connected;
                  const viaExt = !viaApi && isExtensionPlatform(p.id);
                  const checked = selected.includes(p.id);
                  const family = platformFamily(p.id);
                  const hasVariant = variants.some(
                    (v) => v.family === family && v.body?.trim(),
                  );
                  const publishMode = platformPublishMode(p.id);
                  const routeLabel = viaApi
                    ? "API·草稿"
                    : viaExt
                      ? publishMode === "fill_confirm"
                        ? "扩展·待你发布"
                        : p.id === "zhihu"
                          ? "扩展·发布"
                          : "扩展·草稿"
                      : publishMode === "fill_confirm"
                        ? "本机·待你发布"
                        : "本机自动";
                  const statusLabel = viaExt
                    ? routeLabel
                    : connected
                      ? `${routeLabel} · 已连接`
                      : viaApi
                        ? `${routeLabel} · 未连接`
                        : `${routeLabel} · 将弹窗登录`;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      title={`${p.name} · ${familyLabel(family)} · ${p.limits}${hasVariant ? "" : " · 将用主稿"}`}
                      onClick={() => {
                        setSelected((prev) =>
                          prev.includes(p.id)
                            ? prev.filter((x) => x !== p.id)
                            : [...prev, p.id],
                        );
                      }}
                      className={`relative flex flex-col items-center rounded-lg border-2 p-3 transition-all hover:shadow-sm ${
                        checked
                          ? "border-[var(--accent)] bg-[var(--accent-soft)]/50"
                          : "border-transparent bg-[color-mix(in_srgb,var(--muted)_8%,transparent)]"
                      } ${!viaExt && !connected ? "opacity-70 hover:opacity-90" : ""}`}
                    >
                      {checked && (
                        <span
                          className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-white"
                          aria-hidden
                        >
                          ✓
                        </span>
                      )}
                      <PlatformIcon platform={p.id} size={32} className="mb-1.5" />
                      <span className="w-full truncate text-center text-xs font-medium">
                        {p.name}
                      </span>
                      <span className="mt-0.5 w-full truncate text-center text-[10px] text-[var(--muted)]">
                        {familyLabel(family)}
                        {hasVariant ? "" : "·主稿"}
                      </span>
                      <span
                        className={`mt-0.5 w-full truncate text-center text-[10px] ${
                          viaApi || viaExt
                            ? "text-[var(--ok)]"
                            : "text-[var(--muted)]"
                        }`}
                      >
                        {statusLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[var(--line)] px-6 py-4 sm:px-8">
              <button
                className="btn btn-ghost mr-auto"
                type="button"
                onPointerDown={handleOpenPanelPointerDown}
                disabled={syncingExt || !title.trim()}
              >
                仅打开扩展面板
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={generatingVariants || selected.length === 0}
                onClick={() => {
                  const missing = [
                    ...new Set(selected.map((p) => platformFamily(p))),
                  ].filter(
                    (f) => !variants.some((v) => v.family === f && v.body?.trim()),
                  );
                  if (!missing.length) {
                    setMessage("所选平台对应的平台族变体都已存在");
                    return;
                  }
                  setGenFamilies(missing);
                  void generateSelectedVariants(false, missing);
                }}
              >
                {generatingVariants ? "补生成中…" : "补生成缺变体"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowPublish(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={publishing || selected.length === 0}
                onClick={() => void startSync()}
              >
                {publishing ? "同步中…" : `开始同步（${selected.length}）`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showVariantPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/35 p-4 sm:p-6">
          <div className="card w-full max-w-lg p-0 shadow-2xl">
            <div className="border-b border-[var(--line)] px-6 py-5">
              <h2 className="text-xl font-semibold">选择要生成的平台族</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                将按主稿改写为所选调性；已有内容会被覆盖刷新。
              </p>
            </div>
            <div className="space-y-2 px-6 py-5">
              <div className="mb-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-ghost px-2.5 py-1 text-xs"
                  onClick={() =>
                    setGenFamilies(PLATFORM_FAMILIES.map((f) => f.id))
                  }
                >
                  全选
                </button>
                <button
                  type="button"
                  className="btn btn-ghost px-2.5 py-1 text-xs"
                  onClick={() => setGenFamilies([])}
                >
                  清空
                </button>
                <button
                  type="button"
                  className="btn btn-ghost px-2.5 py-1 text-xs"
                  onClick={() =>
                    setGenFamilies(
                      PLATFORM_FAMILIES.map((f) => f.id).filter(
                        (f) =>
                          !variants.some(
                            (v) => v.family === f && v.body?.trim(),
                          ),
                      ),
                    )
                  }
                >
                  仅缺变体
                </button>
              </div>
              {PLATFORM_FAMILIES.map((f) => {
                const checked = genFamilies.includes(f.id);
                const has = variants.some(
                  (v) => v.family === f.id && v.body?.trim(),
                );
                return (
                  <button
                    key={f.id}
                    type="button"
                    title={f.hint}
                    onClick={() =>
                      setGenFamilies((prev) =>
                        prev.includes(f.id)
                          ? prev.filter((x) => x !== f.id)
                          : [...prev, f.id],
                      )
                    }
                    className={`flex w-full items-start gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all ${
                      checked
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]/50"
                        : "border-[var(--line)] bg-[#fffdf9]"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs ${
                        checked
                          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                          : "border-[var(--line)]"
                      }`}
                    >
                      {checked ? "✓" : ""}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{f.label}</span>
                        <span className="text-[11px] text-[var(--muted)]">
                          {has ? "已有 · 将刷新" : "尚未生成"}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-[var(--muted)]">
                        {f.hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--line)] px-6 py-4">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowVariantPicker(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!genFamilies.length || generatingVariants}
                onClick={() => void generateSelectedVariants(true, genFamilies)}
              >
                开始生成（{genFamilies.length}）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
