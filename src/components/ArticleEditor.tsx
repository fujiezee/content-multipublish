"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
  isExtensionTimeoutError,
  isJobOkStatus,
  isPlatformEditorUrl,
  isTerminalJobStatus,
  jobStatusFromExtensionResult,
  extensionResultTip,
  platformPublishMode,
  shouldReplaceJobStatus,
} from "@/lib/job-status";
import { JobBadge } from "@/components/StatusBadge";
import { PlatformIcon } from "@/components/PlatformIcon";
import { JobErrorText } from "@/components/JobErrorText";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@/components/RichTextEditor";
import { InfographicPanel } from "@/components/InfographicPanel";
import { QuotaHint, QuotaMessage } from "@/components/QuotaHint";
import { isQuotaMessage, parseQuotaError, useQuota } from "@/components/useQuota";
import { quotaRechargeText } from "@/lib/billing/copy";
import dynamic from "next/dynamic";
import { ArticleEditorSkeleton } from "@/components/ArticleEditorSkeleton";
import {
  cacheArticle,
  peekArticleHint,
  peekPrefetchedArticle,
} from "@/lib/article-prefetch";

const VideoScriptPanel = dynamic(
  () =>
    import("@/components/VideoScriptPanel").then((mod) => ({
      default: mod.VideoScriptPanel,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="card p-4 text-sm text-[var(--muted)]">短视频区域加载中…</div>
    ),
  },
);
const PodcastPanel = dynamic(
  () =>
    import("@/components/PodcastPanel").then((mod) => ({
      default: mod.PodcastPanel,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="card p-4 text-sm text-[var(--muted)]">播客区域加载中…</div>
    ),
  },
);
import { pickScriptTitle } from "@/lib/ai/script-title";
import { ExtensionInstall } from "@/components/ExtensionInstall";
import { toEditorHtml } from "@/lib/content/adapt";
import {
  removeCoverFromBody,
  upsertCoverInBody,
} from "@/lib/content/cover-html";
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
  isExtensionRequiredPlatform,
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
import { isLocalWorkspaceUser } from "@/lib/auth/local";
import {
  platformLoginActionCopy,
  platformLoginUrl,
} from "@/lib/platform-login";
import { useAuth } from "@/components/useAuth";
import type { PublishEngine } from "@/lib/types";

const JOB_MAP_KEY = (articleId: string) => `dwgeo-ext-job-map:${articleId}`;

function engineLabel(engine: PublishEngine | undefined): string {
  if (engine === "extension") return "扩展";
  if (engine === "api") return "API";
  return "本机自动";
}

/** Production / Cloudflare: no Playwright on the server, no local agent pairing. */
function isCloudPublish(): boolean {
  if (typeof window === "undefined") return true;
  const host = window.location.hostname;
  return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
}

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem ? `${min} 分 ${rem} 秒` : `${min} 分`;
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分`;
}

function jobViewKey(job: PublishJob) {
  return `${job.id}\t${job.status}\t${job.error || ""}\t${job.result_url || ""}\t${job.engine || ""}`;
}

function sameJobList(a: PublishJob[], b: PublishJob[]) {
  if (a.length !== b.length) return false;
  const left = a.map(jobViewKey).sort();
  const right = b.map(jobViewKey).sort();
  return left.every((key, i) => key === right[i]);
}

function mergeJobLists(prev: PublishJob[], next: PublishJob[]) {
  if (!next.length && prev.length) return prev;
  const byId = new Map<string, PublishJob>();
  for (const job of prev) byId.set(job.id, job);
  for (const job of next) byId.set(job.id, job);
  return [...byId.values()].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  );
}

const EXT_STALL_MS = 3 * 60_000;
const EXT_DEAD_MS = 6 * 60_000;

type ExtLiveRow = {
  msg: string;
  kind: "progress" | "waiting" | "offline";
  lastProgressAt: number;
  lastCheckAt: number;
};
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
  const { user } = useAuth();
  const canPushDirectory = isLocalWorkspaceUser(user);
  const publishPlatforms = PLATFORMS.filter(
    (p) => p.id !== "dianwu" || canPushDirectory,
  );
  const [article, setArticle] = useState<Article | null>(() =>
    peekPrefetchedArticle(id),
  );
  const [title, setTitle] = useState(
    () => peekPrefetchedArticle(id)?.title || peekArticleHint(id)?.title || "",
  );
  const [body, setBody] = useState(
    () => peekPrefetchedArticle(id)?.body || "",
  );
  const [summary, setSummary] = useState(
    () =>
      peekPrefetchedArticle(id)?.summary || peekArticleHint(id)?.summary || "",
  );
  const [scriptTitle, setScriptTitle] = useState("");
  const [coverPath, setCoverPath] = useState<string | null>(null);
  const [generatingCover, setGeneratingCover] = useState(false);
  const { snap: quotaSnap, refresh: refreshQuota } = useQuota();
  const imageQuota = quotaSnap("images");
  const [optimizingTitle, setOptimizingTitle] = useState(false);
  const [titleOptimized, setTitleOptimized] = useState(false);
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
  const [jobActionId, setJobActionId] = useState<string | null>(null);
  const [extLoginHint, setExtLoginHint] = useState<{
    platform: PlatformId;
    status: "checking" | "ok" | "wait";
    text: string;
  } | null>(null);
  const [extLive, setExtLive] = useState<Partial<Record<PlatformId, ExtLiveRow>>>(
    {},
  );
  const [extOnline, setExtOnline] = useState<boolean | null>(null);
  const [agentStatus, setAgentStatus] = useState<{
    online: boolean;
    deferPlaywright: boolean;
    cloudLocked: boolean;
  } | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [extensionReady, setExtensionReady] = useState<boolean | null>(null);
  const [clientMounted, setClientMounted] = useState(false);
  const manualSyncRunningRef = useRef(false);
  const manualSyncPrefetchRef = useRef<
    ReturnType<typeof buildManualSyncArticle> | null
  >(null);
  const jobsLoadingRef = useRef(false);
  const jobsReloadQueuedRef = useRef(false);
  const jobsFetchGenRef = useRef(0);
  const jobByPlatformRef = useRef<Map<PlatformId, string>>(new Map());
  const jobsRef = useRef<PublishJob[]>([]);
  const extSyncCleanupRef = useRef<(() => void) | null>(null);
  const extSyncStartedAtRef = useRef(0);
  const lastHistoryRecoverRef = useRef(0);
  const patchedJobStatusRef = useRef<Map<string, JobStatus>>(new Map());
  const titleRef = useRef(title);
  const articleTitleRef = useRef(article?.title);
  titleRef.current = title;
  articleTitleRef.current = article?.title;

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
        router.push("/articles");
        return;
      }
      const data = await res.json();
      const a = data.article as Article;
      const html = toEditorHtml(a.body);
      const coverName = a.cover_path?.split("/").pop() || "";
      const coverSrc = a.cover_path
        ? a.cover_path.startsWith("http") || a.cover_path.startsWith("/")
          ? a.cover_path
          : `/api/uploads/${coverName}`
        : "";
      const needsCover =
        Boolean(a.cover_path && coverSrc) &&
        !/data-article-cover/i.test(html) &&
        !(coverName && html.includes(coverName));
      const withCover = needsCover
        ? upsertCoverInBody(html, coverSrc, a.title || "封面")
        : html;
      setArticle({ ...a, body: withCover });
      setTitle(a.title);
      setTitleOptimized(false);
      setBody(withCover);
      setSummary(a.summary);
      setScriptTitle(pickScriptTitle(a.script_title) || a.script_title || "");
      setCoverPath(a.cover_path);
      cacheArticle({ ...a, body: withCover });
      if (!(a.script_title || "").trim() && a.title) {
        void fetch(`/api/articles/${id}/script-title`, { method: "POST" })
          .then((r) => r.json())
          .then((d: { script_title?: string }) => {
            if (d.script_title) setScriptTitle(d.script_title);
          })
          .catch(() => undefined);
      }
    } catch {
      // Transient network errors — keep current editor state.
    }
  }, [id, router]);

  const commitJobs = useCallback((next: PublishJob[], replace = false) => {
    const merged = replace ? next : mergeJobLists(jobsRef.current, next);
    if (sameJobList(jobsRef.current, merged)) return;
    jobsRef.current = merged;
    setJobs(merged);
  }, []);

  const fetchArticleJobs = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles/${id}/jobs`, { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      if (!Array.isArray(data.jobs)) return null;
      return data.jobs as PublishJob[];
    } catch {
      return null;
    }
  }, [id]);

  const importExtensionHistory = useCallback(
    async (articleTitle?: string) => {
      const gen = jobsFetchGenRef.current;
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
            title: (
              articleTitle ||
              titleRef.current ||
              articleTitleRef.current ||
              ""
            ).trim(),
            entries: history,
          }),
        });
        if (!res.ok) return 0;
        const data = await res.json();
        if (gen !== jobsFetchGenRef.current) return 0;
        if (Array.isArray(data.jobs)) {
          commitJobs(data.jobs);
        }
        return Number(data.imported || 0);
      } catch {
        return 0;
      }
    },
    [id, commitJobs],
  );

  const loadJobs = useCallback(async () => {
    if (jobsLoadingRef.current) {
      jobsReloadQueuedRef.current = true;
      return;
    }
    jobsLoadingRef.current = true;
    const gen = jobsFetchGenRef.current;
    try {
      const next = await fetchArticleJobs();
      if (next == null || gen !== jobsFetchGenRef.current) return;
      commitJobs(next);
    } finally {
      jobsLoadingRef.current = false;
      if (jobsReloadQueuedRef.current) {
        jobsReloadQueuedRef.current = false;
        void loadJobs();
      }
    }
  }, [commitJobs, fetchArticleJobs]);

  useEffect(() => {
    extSyncCleanupRef.current?.();
    extSyncCleanupRef.current = null;
    const warm = peekPrefetchedArticle(id);
    const hint = peekArticleHint(id);
    const html = warm ? toEditorHtml(warm.body) : "";
    setArticle(warm ? { ...warm, body: html } : null);
    setTitle(warm?.title || hint?.title || "");
    setTitleOptimized(false);
    setBody(html);
    setSummary(warm?.summary || hint?.summary || "");
    setScriptTitle(warm?.script_title || "");
    setCoverPath(warm?.cover_path ?? null);
    setVariants([]);
    setEditingTarget("master");
    jobsFetchGenRef.current += 1;
    jobsRef.current = [];
    setJobs([]);
    manualSyncPrefetchRef.current = null;
    void load();
    void loadVariants();
    void loadJobs();
    void fetch("/api/platforms")
      .then((res) => res.json())
      .then((data) => {
        setSessions(data.sessions ?? []);
      })
      .catch(() => undefined);
    // Reset only when switching articles. `load` depends on `router` and would
    // otherwise wipe the job list (and the whole editor) every identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
    void importExtensionHistory(article.title);
    // Only re-import when the article or extension presence changes, not on every title keystroke.
  }, [clientMounted, extensionReady, article?.id, importExtensionHistory]);

  const baselineVariantBody = useMemo(() => {
    if (editingTarget === "master") return null;
    const variant = variants.find((v) => v.family === editingTarget);
    if (!variant) return "";
    return toEditorHtml(variant.body);
  }, [editingTarget, variants]);

  const dirty = useMemo(() => {
    if (!article) return false;
    if (editingTarget === "master") {
      return (
        title !== article.title ||
        body !== article.body ||
        summary !== article.summary ||
        scriptTitle !== (article.script_title || "") ||
        coverPath !== article.cover_path
      );
    }
    const variant = variants.find((v) => v.family === editingTarget);
    if (!variant) {
      return Boolean(title.trim() || body.trim() || summary.trim());
    }
    return (
      title !== variant.title ||
      body !== (baselineVariantBody ?? "") ||
      summary !== (variant.summary || "")
    );
  }, [
    article,
    editingTarget,
    variants,
    title,
    body,
    summary,
    scriptTitle,
    coverPath,
    baselineVariantBody,
  ]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const liveBody = editorRef.current?.flushChange() ?? body;
      if (editingTarget === "master") {
        const res = await fetch(`/api/articles/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            body: liveBody,
            summary,
            script_title: scriptTitle,
            cover_path: coverPath,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "保存失败");
        }
        const saved = data.article as Article;
        const latestHtml = editorRef.current?.getHTML() ?? liveBody;
        if (latestHtml === liveBody) setBody(liveBody);
        setArticle({ ...saved, body: liveBody });
        if (data.variantsCleared) {
          setVariants([]);
          setMessage(
            "主稿已保存；旧平台变体已清空，同步将用当前主稿。需要平台定制请重新生成变体",
          );
        }
      } else {
        const res = await fetch(`/api/articles/${id}/variants`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            family: editingTarget,
            title,
            body: liveBody,
            summary,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "保存变体失败");
        }
        const latestHtml = editorRef.current?.getHTML() ?? liveBody;
        if (latestHtml === liveBody) setBody(liveBody);
        await loadVariants();
      }
      setSavedAt(new Date().toLocaleTimeString("zh-CN"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!article || !dirty || saving) return;
    const timer = window.setTimeout(() => {
      void saveRef.current();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    article,
    dirty,
    saving,
    title,
    body,
    summary,
    scriptTitle,
    coverPath,
    editingTarget,
  ]);

  /** Flush TipTap debounce, then save if live content differs from stored. */
  async function ensureEditorPersisted() {
    const liveBody = editorRef.current?.flushChange() ?? body;
    if (!article) return;
    if (editingTarget === "master") {
      const needs =
        title !== article.title ||
        liveBody !== article.body ||
        summary !== article.summary ||
        scriptTitle !== (article.script_title || "") ||
        coverPath !== article.cover_path;
      if (needs) await save();
      return;
    }
    const variant = variants.find((v) => v.family === editingTarget);
    const needs = !variant
      ? Boolean(title.trim() || liveBody.trim() || summary.trim())
      : title !== variant.title ||
        liveBody !== toEditorHtml(variant.body) ||
        summary !== (variant.summary || "");
    if (needs) await save();
  }

  async function switchEditingTarget(next: "master" | PlatformFamily) {
    if (next === editingTarget) return;
    await ensureEditorPersisted();
    if (next === "master") {
      if (article) {
        setTitle(article.title);
        setBody(toEditorHtml(article.body));
        setSummary(article.summary);
        setScriptTitle(
          pickScriptTitle(article.script_title) || article.script_title || "",
        );
      }
      setTitleOptimized(false);
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
    setTitleOptimized(false);
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
    await ensureEditorPersisted();
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

  async function refreshAgentStatus() {
    try {
      const res = await fetch("/api/agent/status", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) return;
      setAgentStatus({
        online: Boolean(data.online),
        deferPlaywright: Boolean(data.deferPlaywright),
        cloudLocked: Boolean(data.cloudLocked),
      });
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!showPublish) return;
    void refreshAgentStatus();
    const t = setInterval(() => void refreshAgentStatus(), 8000);
    return () => clearInterval(t);
  }, [showPublish]);

  function openSyncModal() {
    setShowPublish(true);
    void loadVariants();
    void fetch("/api/platforms")
      .then((res) => res.json())
      .then((data) => {
        setSessions(data.sessions ?? []);
      })
      .catch(() => undefined);
    void refreshAgentStatus();
  }

  function buildManualSyncArticleBase() {
    const origin = window.location.origin;
    const liveBody = editorRef.current?.getHTML?.() ?? body;
    let thumb: string | undefined;
    if (coverPath) {
      if (coverPath.startsWith("http")) {
        thumb = coverPath;
      } else if (coverPath.startsWith("/")) {
        thumb = `${origin}${coverPath}`;
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
      content: absolutizeHtmlMedia(liveBody || "<p></p>", origin),
      thumb,
      cover: thumb,
    };
  }

  /** Include platform-family variants so the extension popup can auto-pick copy. */
  async function buildManualSyncArticle(): Promise<{
    title: string;
    desc?: string;
    content: string;
    thumb?: string;
    cover?: string;
    familyVariants?: Record<
      string,
      {
        title: string;
        content: string;
        html: string;
        markdown: string;
        summary?: string;
        cover?: string;
        thumb?: string;
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
          cover?: string;
          thumb?: string;
        }
      > = {};
      const cover =
        (typeof data.cover === "string" && data.cover.trim()) ||
        (typeof data.thumb === "string" && data.thumb.trim()) ||
        base.cover ||
        base.thumb;
      const content =
        (typeof data.masterContent === "string" && data.masterContent.trim()) ||
        base.content;
      for (const group of data.groups || []) {
        if (!group?.family || !group?.content) continue;
        const groupCover =
          (typeof group.cover === "string" && group.cover.trim()) || cover;
        familyVariants[group.family] = {
          title: group.title || base.title,
          content: group.content,
          html: group.content,
          markdown: group.markdown || "",
          summary: group.summary,
          cover: groupCover,
          thumb: groupCover,
        };
      }
      return { ...base, content, cover, thumb: cover || base.thumb, familyVariants };
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
    const prev =
      patchedJobStatusRef.current.get(jobId) ||
      jobsRef.current.find((j) => j.id === jobId)?.status;
    if (prev && !shouldReplaceJobStatus(prev, patch.status)) {
      return false;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            job?: { status?: JobStatus };
          };
          const actual = data.job?.status ?? patch.status;
          if (isTerminalJobStatus(actual)) {
            patchedJobStatusRef.current.set(jobId, actual);
          }
          return actual === patch.status;
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
    const plat = platform.toLowerCase();
    const inflight = jobsRef.current.find(
      (j) =>
        j.platform.toLowerCase() === plat &&
        (j.status === "running" || j.status === "pending"),
    );
    if (inflight) return inflight.id;
    const timedOut = jobsRef.current.find(
      (j) =>
        j.platform.toLowerCase() === plat &&
        j.status === "failed" &&
        isExtensionTimeoutError(j.error),
    );
    return timedOut?.id;
  }

  async function applyResultList(results: SyncResultLike[]) {
    let wrote = false;
    for (const result of results) {
      const platform = result.platform;
      if (!platform) continue;
      const status = jobStatusFromExtensionResult({
        ...result,
        platform,
      });
      let jobId = resolveJobId(platform);
      if (status === "published") {
        const awaiting = jobsRef.current.find(
          (j) =>
            j.platform.toLowerCase() === platform.toLowerCase() &&
            j.status === "filled_awaiting_publish",
        );
        if (awaiting) jobId = awaiting.id;
      }
      if (!jobId) continue;
      const tip = extensionResultTip({ ...result, platform }, status);
      wrote =
        (await patchJob(jobId, {
          status,
          result_url:
            status === "failed"
              ? null
              : status === "published" &&
                  isPlatformEditorUrl(
                    platform,
                    result.postUrl || result.url,
                  )
                ? null
                : result.postUrl || result.url || null,
          error: tip,
        })) || wrote;
    }
    if (wrote) await loadJobs();
    return wrote;
  }

  function noteExtLive(
    platform: PlatformId,
    msg: string,
    kind: ExtLiveRow["kind"] = "progress",
  ) {
    setExtLive((prev) => {
      const cur = prev[platform];
      const now = Date.now();
      if (
        cur &&
        cur.msg === msg &&
        cur.kind === kind &&
        now - cur.lastCheckAt < 800
      ) {
        return prev;
      }
      return {
        ...prev,
        [platform]: {
          msg,
          kind,
          lastCheckAt: now,
          lastProgressAt:
            kind === "progress" ? now : (cur?.lastProgressAt ?? now),
        },
      };
    });
  }

  function runningJobHint(job: PublishJob): {
    text: string;
    stuck: boolean;
    dead: boolean;
  } {
    const started =
      Date.parse(job.updated_at) || Date.parse(job.created_at) || nowTick;
    const elapsed = formatElapsed(nowTick - started);
    if (job.engine !== "extension" && !isExtensionPlatform(job.platform)) {
      const silent = nowTick - started;
      const apiHint = job.engine === "api" || job.platform === "dianwu";
      return {
        text: apiHint
          ? silent > EXT_STALL_MS
            ? `已 ${elapsed} · 点物目录还没回写结果`
            : `已 ${elapsed} · 正在推送到点物目录`
          : silent > EXT_STALL_MS
            ? `已 ${elapsed} · 本机队列超过 3 分钟没有结果`
            : `已 ${elapsed} · 本机队列进行中，请耐心等待`,
        stuck: silent > EXT_STALL_MS,
        dead: silent > EXT_DEAD_MS,
      };
    }
    const live = extLive[job.platform];
    const silent = live
      ? nowTick - live.lastProgressAt
      : nowTick - started;
    if (extOnline === false) {
      return {
        text: `已 ${elapsed} · 扩展暂时无响应`,
        stuck: true,
        dead: silent > EXT_DEAD_MS,
      };
    }
    if (!live) {
      return {
        text:
          silent > EXT_STALL_MS
            ? `已 ${elapsed} · 超过 3 分钟还没收到扩展进度`
            : `已 ${elapsed} · 等待扩展回传，请耐心等待`,
        stuck: silent > EXT_STALL_MS,
        dead: silent > EXT_DEAD_MS,
      };
    }
    if (live.kind === "offline") {
      return {
        text: `已 ${elapsed} · ${live.msg}`,
        stuck: true,
        dead: true,
      };
    }
    const ago = formatElapsed(silent);
    if (silent > EXT_DEAD_MS) {
      return {
        text: `已 ${elapsed} · 上次「${live.msg}」已 ${ago}，超过 6 分钟没有新进度`,
        stuck: true,
        dead: true,
      };
    }
    if (silent > EXT_STALL_MS) {
      return {
        text: `已 ${elapsed} · 上次「${live.msg}」已 ${ago}，超过 3 分钟没有新进度`,
        stuck: true,
        dead: false,
      };
    }
    return {
      text: `已 ${elapsed} · ${live.msg}，请耐心等待`,
      stuck: false,
      dead: false,
    };
  }

  async function applyExtensionAccountUpdate(account: DianwuGeoAccount) {
    const platform = account.type as PlatformId;
    const tip = account.msg || account.error || account.status;
    if (tip) {
      noteExtLive(platform, tip, "progress");
    }
    const jobId = resolveJobId(platform);
    if (!jobId || !isAccountTerminal(account)) return;

    if (isAccountSuccess(account)) {
      const mode = platformPublishMode(platform);
      const next =
        mode === "fill_confirm" ? "filled_awaiting_publish" : "draft_ok";
      const current =
        patchedJobStatusRef.current.get(jobId) ||
        jobsRef.current.find((j) => j.id === jobId)?.status;
      if (current && !shouldReplaceJobStatus(current, next)) return;
      await patchJob(jobId, {
        status: next,
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

  async function markJobPublished(job: PublishJob) {
    const keepUrl = isPlatformEditorUrl(job.platform, job.result_url)
      ? null
      : job.result_url;
    await patchJob(job.id, {
      status: "published",
      error: null,
      result_url: keepUrl,
    });
    await loadJobs();
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

  async function recoverJobsFromExtension() {
    await importExtensionHistory(title.trim() || article?.title);
    const state = await getDianwuGeoSyncState(3_000);
    if (state?.results?.length) {
      await applyResultList(state.results);
    }
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
      }
      await recoverJobsFromExtension();
      const alive = await pingDianwuGeoExtension(1_200);
      setExtOnline(alive);
      const latestJobs = await fetchArticleJobs();
      if (latestJobs) commitJobs(latestJobs);
      if (!alive) {
        for (const j of jobsRef.current) {
          if (map.get(j.platform) === j.id && j.status === "running") {
            await patchJob(j.id, {
              status: "failed",
              error:
                "扩展无响应。请先点「同步扩展历史」核对；若平台上确实没发出去再「重试」",
            });
          }
        }
        void loadJobs();
      }
      const allDone = platforms.every((pid) => {
        const jobId = map.get(pid);
        const job = jobsRef.current.find((j) => j.id === jobId);
        return !!job && isTerminalJobStatus(job.status);
      });
      if (allDone || !alive) stopExtensionSyncWatchers();
    }, 3 * 60_000);

    // Primary recovery: poll activeSyncState (popup "同步完成" reads this)
    const pollId = window.setInterval(() => {
      void (async () => {
        const alive = await pingDianwuGeoExtension(1_200);
        setExtOnline(alive);
        const state = await getDianwuGeoSyncState(2_500);
        for (const pid of platforms) {
          const row = state?.results?.find(
            (r) =>
              !!r.platform &&
              String(r.platform).toLowerCase() === String(pid).toLowerCase(),
          );
          if (row) {
            noteExtLive(
              pid,
              row.message ||
                row.error ||
                (row.success ? "扩展已返回结果" : "扩展正在处理"),
              "progress",
            );
          } else if (
            state?.status &&
            state.status !== "completed" &&
            state.status !== "idle"
          ) {
            noteExtLive(pid, "扩展任务进行中", "waiting");
          } else if (!alive) {
            noteExtLive(pid, "扩展无响应", "offline");
          } else if (!state || state.status === "idle") {
            noteExtLive(pid, "扩展已空闲，正在对照同步历史", "waiting");
          }
        }
        if (
          !state ||
          state.status === "idle" ||
          state.status === "completed"
        ) {
          const now = Date.now();
          if (now - lastHistoryRecoverRef.current > 8_000) {
            lastHistoryRecoverRef.current = now;
            await recoverJobsFromExtension();
          }
        }
        if (
          state?.status === "completed" &&
          syncStateMatchesPlatforms(state, platforms, { startedAt })
        ) {
          await finalizeCompletedSync(platforms, state, { startedAt });
        } else if (state?.status !== "completed") {
          await applySyncStateToJobs(platforms, state, { startedAt });
        }

        const map = jobByPlatformRef.current;
        const list = await fetchArticleJobs();
        if (list) commitJobs(list);
        const current = jobsRef.current;
        const allDone = platforms.every((pid) => {
          const jobId = map.get(pid);
          const job = current.find((j) => j.id === jobId);
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

  function extensionAccountLoggedIn(acc?: DianwuGeoAccount | null): boolean {
    if (!acc) return false;
    return Boolean(
      String(acc.uid || "").trim() ||
        String(acc.displayName || "").trim() ||
        String(acc.title || "").trim(),
    );
  }

  async function resetExtensionJobs(platforms: PlatformId[]) {
    const map = restoreJobMap();
    const missing: PlatformId[] = [];
    for (const pid of platforms) {
      const mappedId = map.get(pid);
      const existing =
        jobsRef.current.find((j) => j.id === mappedId) ||
        jobsRef.current.find(
          (j) => j.platform === pid && j.engine === "extension",
        ) ||
        jobsRef.current.find((j) => j.platform === pid);
      if (existing?.id) {
        map.set(pid, existing.id);
        patchedJobStatusRef.current.delete(existing.id);
        await patchJob(existing.id, { status: "running", error: null });
      } else {
        missing.push(pid);
      }
    }
    if (missing.length) {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleId: id,
          platforms: missing,
          engine: "extension",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "创建扩展同步任务失败");
      }
      for (const j of (data.jobs ?? []) as PublishJob[]) {
        map.set(j.platform, j.id);
        patchedJobStatusRef.current.delete(j.id);
      }
    }
    jobByPlatformRef.current = map;
    persistJobMap(map);
  }

  async function createExtensionJobs(platforms: PlatformId[]) {
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
  }

  /**
   * Kick off extension sync and return immediately — do not block the UI.
   * Final results are applied when addTask resolves + background watchers.
   */
  async function runExtensionSync(
    platforms: PlatformId[],
    opts?: { reuseJobs?: boolean },
  ) {
    const articlePayload = await buildManualSyncArticle();
    stashArticleForDianwuGeo(articlePayload);
    void pushDianwuGeoFamilyVariants(articlePayload.familyVariants);

    if (opts?.reuseJobs) {
      await resetExtensionJobs(platforms);
    } else {
      await createExtensionJobs(platforms);
    }

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
      cover?: string;
    };
    const groups = (contentData.groups ?? []) as SyncGroup[];
    const missing = (contentData.missingFamilies ?? []) as PlatformFamily[];
    if (missing.length) {
      setMessage(
        `部分平台尚无专属变体（${missing.map(familyLabel).join("、")}），将暂用主稿；可先生成变体再同步`,
      );
    }

    const extAccounts = await getDianwuGeoAccounts(2_500);
    const thumb =
      (typeof contentData.cover === "string" && contentData.cover.trim()) ||
      (typeof contentData.thumb === "string" && contentData.thumb.trim()) ||
      articlePayload.cover ||
      articlePayload.thumb;

    const syncStartedAt = Date.now();
    for (const pid of platforms) {
      noteExtLive(pid, "已提交给扩展", "progress");
    }
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
                thumb: group.cover || thumb,
                cover: group.cover || thumb,
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

  async function refreshExtensionLogin(job: PublishJob) {
    const platform = job.platform;
    const name = PLATFORMS.find((p) => p.id === platform)?.name || platform;
    setJobActionId(job.id);
    setExtLoginHint({
      platform,
      status: "checking",
      text: `正在检测 ${name} 登录…`,
    });
    try {
      const accounts = await getDianwuGeoAccounts(4_000);
      const acc = accounts.find((a) => a.type === platform);
      if (extensionAccountLoggedIn(acc)) {
        const who = acc?.displayName || acc?.title || acc?.uid || "已登录";
        setExtLoginHint({
          platform,
          status: "ok",
          text: `${name} 已登录（${who}），可以重试`,
        });
        setMessage(`${name} 扩展已检测到登录，可以点「重试」`);
        return;
      }
      const url = platformLoginUrl(platform);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      const copy = platformLoginActionCopy(platform, name);
      setExtLoginHint({
        platform,
        status: "wait",
        text: copy.opened,
      });
      setMessage(copy.opened);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "检测登录失败");
    } finally {
      setJobActionId(null);
    }
  }

  async function retryFailedJob(job: PublishJob) {
    const name = PLATFORMS.find((p) => p.id === job.platform)?.name || job.platform;
    setJobActionId(job.id);
    try {
      if (job.engine === "extension" || isExtensionPlatform(job.platform)) {
        const accounts = await getDianwuGeoAccounts(4_000);
        const acc = accounts.find((a) => a.type === job.platform);
        if (!extensionAccountLoggedIn(acc)) {
          const url = platformLoginUrl(job.platform);
          if (url) window.open(url, "_blank", "noopener,noreferrer");
          const copy = platformLoginActionCopy(job.platform, name);
          setExtLoginHint({
            platform: job.platform,
            status: "wait",
            text: copy.notDetected,
          });
          setMessage(copy.notDetected);
          return;
        }
        await importExtensionHistory(title.trim() || article?.title);
        await loadJobs();
        const latest = jobsRef.current.find((j) => j.id === job.id);
        if (latest && isJobOkStatus(latest.status)) {
          setMessage(
            `${name} 其实已经同步成功，已按扩展历史更正，不会再发一次`,
          );
          return;
        }
        setSyncingExt(true);
        await runExtensionSync([job.platform], { reuseJobs: true });
        setExtLoginHint({
          platform: job.platform,
          status: "ok",
          text: `已重新提交 ${name} 扩展同步`,
        });
        setMessage(`已重新提交 ${name} 扩展同步`);
        return;
      }
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "重试失败");
      }
      await loadJobs();
      setMessage(`已重新加入 ${name} 队列`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "重试失败");
    } finally {
      setSyncingExt(false);
      setJobActionId(null);
    }
  }

  function flattenPublishWarnings(data: { warnings?: Record<string, string[]> }) {
    return Object.values(data.warnings || {}).flat().filter(Boolean);
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
    return flattenPublishWarnings(data);
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
    return flattenPublishWarnings(data);
  }

  function sessionConnected(platform: PlatformId): boolean {
    return sessions.some(
      (s) => s.platform === platform && s.status === "connected",
    );
  }

  function canUseApiDraft(platform: PlatformId): boolean {
    if (platform === "dianwu") return canPushDirectory;
    return isApiDraftPlatform(platform) && sessionConnected(platform);
  }

  async function persistCover(next = coverPath) {
    const cover = next ?? null;
    if (cover === (article?.cover_path ?? null)) return;
    const res = await fetch(`/api/articles/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cover_path: cover }),
    });
    const data = await res.json();
    if (res.ok && data.article) {
      setArticle(data.article);
      setCoverPath(data.article.cover_path ?? cover);
    }
  }

  async function persistCoverInBody(path: string | null, src?: string) {
    const nextBody = path
      ? upsertCoverInBody(body, src || coverPreviewSrc(path), title.trim() || "封面")
      : removeCoverFromBody(body);
    setCoverPath(path);
    setBody(nextBody);
    if (editingTarget === "master") {
      const res = await fetch(`/api/articles/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body: nextBody,
          summary,
          script_title: scriptTitle,
          cover_path: path,
        }),
      });
      const data = await res.json();
      if (res.ok && data.article) {
        setArticle(data.article);
        setCoverPath(data.article.cover_path ?? path);
        setSavedAt(new Date().toLocaleTimeString("zh-CN"));
      }
      return;
    }
    await persistCover(path);
    const res = await fetch(`/api/articles/${id}/variants`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        family: editingTarget,
        title,
        body: nextBody,
        summary,
      }),
    });
    if (res.ok) {
      await loadVariants();
      setSavedAt(new Date().toLocaleTimeString("zh-CN"));
    }
  }

  async function startSync() {
    setPublishing(true);
    setMessage(null);
    try {
      await ensureEditorPersisted();
      await persistCover();

      const apiPlatforms = selected.filter((p) => canUseApiDraft(p));
      const remainder = selected.filter((p) => !canUseApiDraft(p));
      const cloudNoPw = isCloudPublish();
      const extPlatforms = cloudNoPw
        ? remainder
        : remainder.filter((p) => isExtensionPlatform(p));
      const pwPlatforms = cloudNoPw
        ? []
        : remainder.filter((p) => !isExtensionPlatform(p));

      const extOk =
        extensionReady === true ||
        isDianwuGeoExtensionPresent() ||
        (await waitForDianwuGeoExtension(2_000));

      const parts: string[] = [];
      const notes: string[] = [];

      if (apiPlatforms.length) {
        notes.push(...(await runApiSync(apiPlatforms)));
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
        const names = extPlatforms
          .map((id) => PLATFORMS.find((p) => p.id === id)?.name || id)
          .join("、");
        if (cloudNoPw) {
          parts.push(
            `${names}需要 Chrome 扩展。请先安装点物扩展并登录对应平台，再点同步。线上不会在服务器开窗`,
          );
        } else {
          const mustExt = extPlatforms.filter(isExtensionRequiredPlatform);
          const canFallback = extPlatforms.filter(
            (p) => !isExtensionRequiredPlatform(p),
          );
          if (mustExt.length) {
            const mustNames = mustExt
              .map((id) => PLATFORMS.find((p) => p.id === id)?.name || id)
              .join("、");
            parts.push(
              `${mustNames}需要点物扩展，本机不再自动开窗。请加载扩展后再同步`,
            );
          }
          if (canFallback.length) {
            notes.push(...(await runPlaywrightSync(canFallback)));
            parts.push(
              `未检测到扩展，已将 ${canFallback.length} 个平台改走本机自动`,
            );
          }
        }
      }

      if (pwPlatforms.length) {
        notes.push(...(await runPlaywrightSync(pwPlatforms)));
        parts.push(
          `本机自动队列 ${pwPlatforms.length} 个平台（一次一窗，关窗后继续）`,
        );
      }

      setShowPublish(false);
      setMessage(
        [...parts, ...notes].filter(Boolean).join("；") || "已提交同步",
      );
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

  // Keep listening after「待你发布」so closing the platform tab can flip to 已发布.
  useEffect(() => {
    if (!clientMounted) return;
    return subscribeDianwuGeoSyncResults((result) => {
      void applyResultList([result]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persistent listener; applyResultList uses refs
  }, [clientMounted]);

  const awaitingKey = jobs
    .filter(
      (j) =>
        j.engine === "extension" && j.status === "filled_awaiting_publish",
    )
    .map((j) => j.id)
    .sort()
    .join(",");
  useEffect(() => {
    if (!clientMounted || !awaitingKey) return;
    const awaiting = jobsRef.current.filter(
      (j) =>
        j.engine === "extension" && j.status === "filled_awaiting_publish",
    );
    if (!awaiting.length) return;
    const map = restoreJobMap();
    for (const j of awaiting) map.set(j.platform, j.id);
    jobByPlatformRef.current = map;
    void getDianwuGeoSyncState(3_000).then(async (state) => {
      if (state?.results?.length) await applyResultList(state.results);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-check when awaiting job ids change
  }, [clientMounted, awaitingKey]);

  // Resume / recover: poll extension activeSyncState while jobs stay "running"
  const runningExtKey = jobs
    .filter((j) => j.engine === "extension" && j.status === "running")
    .map((j) => `${j.id}:${j.platform}`)
    .sort()
    .join(",");
  useEffect(() => {
    if (!clientMounted || !runningExtKey) return;
    const runningExt = jobsRef.current.filter(
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recover when running ext job ids change
  }, [clientMounted, runningExtKey]);

  async function onCover(file: File | null) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await res.json();
    if (data.path) {
      await persistCoverInBody(data.path, data.url);
    }
  }

  function coverPreviewSrc(path: string): string {
    if (path.startsWith("http") || path.startsWith("/")) return path;
    const name = path.split("/").pop();
    return name ? `/api/uploads/${name}` : path;
  }

  async function optimizeTitle() {
    if (optimizingTitle) return;
    if (!title.trim() && !body.trim()) {
      setMessage("先写标题或正文再优化标题");
      return;
    }
    setOptimizingTitle(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ai/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          family: editingTarget === "master" ? undefined : editingTarget,
          rewrite: titleOptimized,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "标题优化失败");
      const next = String(data.title || "").trim();
      if (!next) throw new Error("标题优化失败");
      setTitle(next);
      setTitleOptimized(true);
      setMessage(titleOptimized ? "标题已重写，保存后生效" : "标题已优化，保存后生效");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "标题优化失败");
    } finally {
      setOptimizingTitle(false);
    }
  }

  async function generateCover() {
    if (generatingCover) return;
    if (imageQuota?.remaining === 0) {
      setMessage(quotaRechargeText("images"));
      return;
    }
    if (!title.trim() && !body.trim()) {
      setMessage("先写标题或正文再生成封面");
      return;
    }
    setGeneratingCover(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ai/cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      const data = await res.json();
      const quota = parseQuotaError(res, data);
      if (quota) throw new Error(quota);
      if (!res.ok) throw new Error(data.error || "生成封面失败");
      if (data.path) {
        await persistCoverInBody(data.path, data.url);
      }
      setMessage("已生成 16:9 封面并插入正文开头，同步时也会带到各平台封面位");
      void refreshQuota();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "生成封面失败");
      void refreshQuota();
    } finally {
      setGeneratingCover(false);
    }
  }

  const hasInFlightJobs = jobs.some(
    (j) => j.status === "pending" || j.status === "running",
  );
  useEffect(() => {
    if (!hasInFlightJobs) return;
    const t = setInterval(() => void loadJobs(), 2000);
    return () => clearInterval(t);
  }, [hasInFlightJobs, loadJobs]);

  useEffect(() => {
    if (!hasInFlightJobs) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasInFlightJobs]);

  async function runOpenExtensionPanel() {
    if (manualSyncRunningRef.current || syncingExt) return;
    manualSyncRunningRef.current = true;
    setSyncingExt(true);
    setMessage(null);

    if (!isDianwuGeoExtensionPresent()) {
      const ready = await waitForDianwuGeoExtension(3_000);
      if (!ready) {
        const domMarker = getExtensionIdFromDom();
        setExtensionReady(false);
        setMessage(
          domMarker
            ? `${DIANWU_GEO_PRODUCT_NAME}已连接但页面桥接未就绪，请硬刷新（Cmd+Shift+R）后重试。`
            : `未检测到${DIANWU_GEO_PRODUCT_NAME}。请下载扩展包，在 chrome://extensions 开启开发者模式并加载解压文件夹，然后硬刷新本页。`,
        );
        manualSyncRunningRef.current = false;
        setSyncingExt(false);
        return;
      }
    }

    await ensureEditorPersisted();
    // Prefetch on pointerdown may have started before the save above — rebuild.
    manualSyncPrefetchRef.current = null;
    const full = await buildManualSyncArticle();
    stashArticleForDianwuGeo(full);
    void pushDianwuGeoFamilyVariants(full.familyVariants);
    const { wait } = beginOpenDianwuGeoPanel(full);

    try {
      const result = await wait;
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
    manualSyncPrefetchRef.current = buildManualSyncArticle();
    stashArticleForDianwuGeo(buildManualSyncArticleBase());
  }

  useEffect(() => {
    if (!article || typeof window === "undefined") return;
    if (window.location.hash !== "#video-script") return;
    const el = document.getElementById("video-script");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [article]);

  if (!article) {
    return <ArticleEditorSkeleton title={title} />;
  }

  const cloudPublish = agentStatus
    ? Boolean(agentStatus.cloudLocked)
    : clientMounted && isCloudPublish();
  const listedPlatforms = cloudPublish
    ? publishPlatforms.filter(
        (p) =>
          p.id === "dianwu" ||
          isApiDraftPlatform(p.id) ||
          isExtensionPlatform(p.id),
      )
    : publishPlatforms;
  const extSelected = cloudPublish
    ? selected.filter((p) => !canUseApiDraft(p)).length
    : selected.filter((p) => isExtensionPlatform(p)).length;
  const pwSelected = cloudPublish ? 0 : selected.length - extSelected;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => router.push("/articles")}
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
          <a href="#podcast" className="btn btn-ghost">
            播客
          </a>
          <Link href={`/scripts/${id}`} className="btn btn-ghost">
            短视频剧本
          </Link>
          <Link href={`/paid?article=${id}`} className="btn btn-ghost">
            付费
          </Link>
          <Link href={`/ads?article=${id}`} className="btn btn-ghost">
            营销
          </Link>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => openSyncModal()}
            disabled={!title.trim()}
          >
            多平台同步
          </button>
        </div>
      </div>

      {clientMounted && extensionReady === false ? (
        <ExtensionInstall compact onReadyChange={setExtensionReady} />
      ) : null}

      {message && isQuotaMessage(message) ? (
        <QuotaMessage text={message} />
      ) : message ? (
        <div className="card border-[var(--accent)]/30 bg-[var(--accent-soft)]/50 px-4 py-3 text-sm">
          {message}
        </div>
      ) : null}

      <div className="card space-y-3 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium">正文版本</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              主稿可直接改；同步优先用各平台变体。改主稿并保存后会清空旧变体，避免发出旧稿
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
        <div className="flex items-center gap-2">
          <input
            className="field min-w-0 flex-1 text-2xl font-semibold"
            placeholder="文章标题"
            value={title}
            data-dwgeo-article-title
            data-value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-ghost shrink-0 text-xs"
            disabled={optimizingTitle || (!title.trim() && !body.trim())}
            title={
              titleOptimized
                ? "换一个角度重写标题"
                : "按正文把标题写得更吸引人"
            }
            onClick={() => void optimizeTitle()}
          >
            {optimizingTitle
              ? "优化中…"
              : titleOptimized
                ? "重写标题"
                : "标题优化"}
          </button>
        </div>
        {editingTarget === "master" && (
          <input
            className="field"
            placeholder="剧本名（抖音合集名，不是某一集的分镜名）"
            value={scriptTitle}
            maxLength={16}
            title="整套剧本的合集名"
            onChange={(e) => setScriptTitle(e.target.value.slice(0, 16))}
            onBlur={() => {
              const name = pickScriptTitle(scriptTitle);
              if (!name) return;
              setScriptTitle(name);
              void fetch(`/api/articles/${id}/video-script`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ series: { title: name } }),
              }).catch(() => undefined);
            }}
          />
        )}
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
                coverPath.startsWith("http") || coverPath.startsWith("/")
                  ? coverPath
                  : `/api/uploads/${coverPath.split("/").pop()}`
              }
            />
          )}
          {coverPath ? (
            <img
              src={coverPreviewSrc(coverPath)}
              alt="封面"
              className="h-14 w-24 rounded-lg object-cover ring-1 ring-[var(--line)]"
            />
          ) : null}
          <label className="btn btn-ghost cursor-pointer">
            上传封面
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void onCover(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={generatingCover || imageQuota?.remaining === 0}
            onClick={() => void generateCover()}
          >
            {generatingCover ? "出图中，大约一分钟…" : "生成封面"}
          </button>
          <QuotaHint snap={imageQuota} need={1} />
          {coverPath && (
            <span className="text-sm text-[var(--muted)]">
              封面已选 · 16:9 ·{" "}
              <button
                className="underline"
                onClick={() => void persistCoverInBody(null)}
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
            } else if (editingTarget !== "master") {
              setVariants((prev) =>
                prev.map((v) =>
                  v.family === editingTarget ? { ...v, body: html } : v,
                ),
              );
            }
          }}
          onVariantsSynced={(next) => setVariants(next)}
          onBodyPersisted={() => {
            void loadVariants();
            void load();
          }}
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

      <PodcastPanel articleId={id} title={title} />

      <VideoScriptPanel
        articleId={id}
        title={title}
        bodyHtml={body}
        scriptTitle={scriptTitle}
        onScriptTitleChange={(name) => {
          const next = pickScriptTitle(name);
          if (!next) return;
          setScriptTitle(next);
          setArticle((cur) =>
            cur && cur.script_title !== next
              ? { ...cur, script_title: next }
              : cur,
          );
        }}
      />

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-medium">本文同步记录</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              「同步中」会显示已用时和扩展最近进度。超过 3 分钟没新进度会提示变慢；超过 6 分钟仍对不上结果才标可能卡住。请先点「同步扩展历史」核对，确认没发出去再重试，避免重复发布。
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
          <p className="mt-3 min-h-[4.5rem] text-sm text-[var(--muted)]">
            暂无记录。在扩展里同步完成后点「同步扩展历史」，或使用上方「多平台同步」。
          </p>
        ) : (
          <ul className="mt-3 min-h-[4.5rem] space-y-2">
            {jobs.slice(0, 20).map((job) => {
              const inFlight =
                job.status === "running" || job.status === "pending";
              const hint = inFlight ? runningJobHint(job) : null;
              const canAct =
                job.status === "failed" || Boolean(hint?.dead);
              return (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[#fffdf9] px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  {hint?.dead ? (
                    <span className="badge badge-warn">可能卡住</span>
                  ) : (
                    <JobBadge status={job.status} />
                  )}
                  <span>
                    {PLATFORMS.find((p) => p.id === job.platform)?.name}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {engineLabel(job.engine)}
                  </span>
                </div>
                <div className="max-w-md text-right text-sm text-[var(--muted)]">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {job.result_url &&
                    !(
                      job.status === "published" &&
                      isPlatformEditorUrl(job.platform, job.result_url)
                    ) ? (
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
                    {job.status === "filled_awaiting_publish" ? (
                      <button
                        type="button"
                        className="btn btn-ghost px-2 py-0.5 text-xs"
                        onClick={() => void markJobPublished(job)}
                      >
                        标记已发布
                      </button>
                    ) : null}
                    {canAct ? (
                      <>
                        {(job.engine === "extension" ||
                          isExtensionPlatform(job.platform)) &&
                        platformLoginUrl(job.platform) ? (
                          <button
                            type="button"
                            className="btn btn-ghost px-2 py-0.5 text-xs"
                            disabled={jobActionId === job.id}
                            onClick={() => void refreshExtensionLogin(job)}
                          >
                            {jobActionId === job.id &&
                            extLoginHint?.status === "checking"
                              ? "检测中…"
                              : "刷新登录"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-ghost px-2 py-0.5 text-xs"
                          disabled={jobActionId === job.id || syncingExt}
                          onClick={() => void retryFailedJob(job)}
                        >
                          {jobActionId === job.id &&
                          extLoginHint?.status !== "checking"
                            ? "重试中…"
                            : "重试"}
                        </button>
                      </>
                    ) : null}
                  </div>
                  {hint ? (
                    <p
                      className={
                        hint.dead
                          ? "mt-0.5 min-h-[1.25rem] text-xs text-[var(--danger)]"
                          : hint.stuck
                            ? "mt-0.5 min-h-[1.25rem] text-xs text-[var(--warn)]"
                            : "mt-0.5 min-h-[1.25rem] text-xs tabular-nums text-[var(--muted)]"
                      }
                    >
                      {hint.text}
                    </p>
                  ) : job.error ? (
                    <p
                      className={
                        isJobOkStatus(job.status)
                          ? "mt-0.5 text-xs text-[var(--muted)]"
                          : "mt-0.5 text-xs text-[var(--danger)]"
                      }
                    >
                      <JobErrorText error={job.error} platform={job.platform} />
                    </p>
                  ) : !job.result_url ? (
                    new Date(job.updated_at).toLocaleString("zh-CN")
                  ) : null}
                  {extLoginHint?.platform === job.platform ? (
                    <p
                      className={
                        extLoginHint.status === "ok"
                          ? "mt-0.5 text-xs text-[var(--ok,#2f6d3a)]"
                          : "mt-0.5 text-xs text-[var(--muted)]"
                      }
                    >
                      {extLoginHint.text}
                    </p>
                  ) : null}
                </div>
              </li>
              );
            })}
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
                    {cloudPublish
                      ? extensionReady === false
                        ? " · 未检测到 Chrome 扩展。线上发稿由扩展在你电脑上完成，服务器不会开窗。"
                        : " · 线上发稿由 Chrome 扩展在你电脑上完成，服务器不会开窗。"
                      : extensionReady === false
                        ? " · 当前未检测到扩展，部分平台将回落本机自动"
                        : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
                  <span>
                    {cloudPublish
                      ? `已选 ${selected.length}`
                      : `已选 ${selected.length} · 扩展 ${extSelected} · 本机 ${pwSelected}`}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost px-2.5 py-1 text-xs"
                    onClick={() =>
                      setSelected(listedPlatforms.map((p) => p.id))
                    }
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
              {cloudPublish && extensionReady === false ? (
                <p className="mb-3 rounded-lg border border-[var(--line)] bg-[#fff8ee] px-3 py-2 text-xs">
                  未检测到 Chrome 扩展。请先在本页下载并加载点物扩展，登录各平台后再同步。线上不会在服务器开窗，也不再使用本机助手配对。
                </p>
              ) : null}
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
                {listedPlatforms.map((p) => {
                  const session = sessions.find((s) => s.platform === p.id);
                  const connected = session?.status === "connected";
                  const viaApi =
                    isApiDraftPlatform(p.id) &&
                    (p.id === "dianwu" || connected);
                  const viaExt = !viaApi && isExtensionPlatform(p.id);
                  const checked = selected.includes(p.id);
                  const family = platformFamily(p.id);
                  const hasVariant = variants.some(
                    (v) => v.family === family && v.body?.trim(),
                  );
                  const publishMode = platformPublishMode(p.id);
                  const routeLabel = viaApi
                    ? p.id === "dianwu"
                      ? "API·目录"
                      : "API·草稿"
                    : viaExt
                      ? publishMode === "fill_confirm"
                        ? "扩展·待你发布"
                        : p.id === "zhihu"
                          ? "扩展·发布"
                          : "扩展·草稿"
                      : publishMode === "fill_confirm"
                        ? "本机·待你发布"
                        : "本机自动";
                  const statusLabel =
                    p.id === "dianwu"
                      ? `${routeLabel} · 本地账号`
                      : viaExt
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
                      } ${!viaExt && !connected && p.id !== "dianwu" ? "opacity-70 hover:opacity-90" : ""}`}
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
                {publishing
                  ? "同步中…"
                  : cloudPublish &&
                      extensionReady === false &&
                      extSelected > 0
                    ? "请先安装扩展"
                    : `开始同步（${selected.length}）`}
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
