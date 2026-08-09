"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Article, PlatformId, PlatformSession, PublishJob } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import { JobBadge } from "@/components/StatusBadge";
import { RichTextEditor } from "@/components/RichTextEditor";
import { toEditorHtml } from "@/lib/content/adapt";
import {
  accountDraftUrl,
  addDianwuGeoTask,
  beginOpenDianwuGeoPanel,
  DIANWU_GEO_PRODUCT_NAME,
  formatDianwuGeoOpenMessage,
  getDianwuGeoAccounts,
  getDianwuGeoSyncState,
  getExtensionIdFromDom,
  isAccountSuccess,
  isAccountTerminal,
  isDianwuGeoExtensionPresent,
  isExtensionPlatform,
  pingDianwuGeoExtension,
  stashArticleForDianwuGeo,
  subscribeDianwuGeoSyncResults,
  subscribeDianwuGeoTaskUpdates,
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
};

export function ArticleEditor({ id }: { id: string }) {
  const router = useRouter();
  const [article, setArticle] = useState<Article | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [summary, setSummary] = useState("");
  const [coverPath, setCoverPath] = useState<string | null>(null);
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
  const patchedJobStatusRef = useRef<Map<string, "success" | "failed">>(
    new Map(),
  );

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
    setJobs([]);
    manualSyncWaitRef.current = null;
    void load();
    void loadJobs();
  }, [id, load, loadJobs]);

  useEffect(() => {
    if (!article) return;
    const timer = window.setTimeout(() => {
      stashArticleForDianwuGeo(buildManualSyncArticle());
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

  const dirty = useMemo(() => {
    if (!article) return false;
    return (
      title !== article.title ||
      body !== article.body ||
      summary !== article.summary ||
      coverPath !== article.cover_path
    );
  }, [article, title, body, summary, coverPath]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
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
      setSavedAt(new Date().toLocaleTimeString("zh-CN"));
    } finally {
      setSaving(false);
    }
  }

  async function openSyncModal() {
    if (dirty) await save();
    const res = await fetch("/api/platforms");
    const data = await res.json();
    setSessions(data.sessions ?? []);
    setShowPublish(true);
  }

  function buildManualSyncArticle() {
    let thumb: string | undefined;
    if (coverPath) {
      if (coverPath.startsWith("http")) {
        thumb = coverPath;
      } else {
        const name = coverPath.split("/").pop();
        thumb = name
          ? `${window.location.origin}/api/uploads/${name}`
          : undefined;
      }
    }
    return {
      title: title.trim() || "未命名",
      desc: summary.trim() || undefined,
      content: body || "<p></p>",
      thumb,
    };
  }

  async function patchJob(
    jobId: string,
    patch: {
      status: "success" | "failed" | "running";
      result_url?: string | null;
      error?: string | null;
    },
  ): Promise<boolean> {
    if (patch.status === "success" || patch.status === "failed") {
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
          if (patch.status === "success" || patch.status === "failed") {
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
      if (result.success) {
        wrote =
          (await patchJob(jobId, {
            status: "success",
            result_url: result.postUrl || result.url || null,
            error: null,
          })) || wrote;
      } else {
        wrote =
          (await patchJob(jobId, {
            status: "failed",
            error: result.error || "扩展同步失败",
            result_url: null,
          })) || wrote;
      }
    }
    if (wrote) await loadJobs();
    return wrote;
  }

  async function applyExtensionAccountUpdate(account: DianwuGeoAccount) {
    const platform = account.type as PlatformId;
    const jobId = resolveJobId(platform);
    if (!jobId || !isAccountTerminal(account)) return;

    if (isAccountSuccess(account)) {
      await patchJob(jobId, {
        status: "success",
        result_url: accountDraftUrl(account),
        error: null,
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
  ) {
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

  async function applySyncStateToJobs(state: DianwuGeoSyncState | null) {
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

  function startExtensionSyncWatchers(platforms: PlatformId[]) {
    stopExtensionSyncWatchers();

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
        await finalizeCompletedSync(platforms, state);
      } else {
        await applySyncStateToJobs(state);
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
        if (state?.status === "completed") {
          await finalizeCompletedSync(platforms, state);
        } else {
          await applySyncStateToJobs(state);
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
          return (
            !!job && (job.status === "success" || job.status === "failed")
          );
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
    const articlePayload = buildManualSyncArticle();
    stashArticleForDianwuGeo(articlePayload);

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

    const extAccounts = await getDianwuGeoAccounts(2_500);

    const accounts: DianwuGeoAccount[] = platforms.map((pid) => {
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

    startExtensionSyncWatchers(platforms);

    // Do not block the publish button on full sync completion
    void addDianwuGeoTask(
      {
        post: {
          title: articlePayload.title,
          content: articlePayload.content,
          thumb: articlePayload.thumb,
          desc: articlePayload.desc,
        },
        accounts,
      },
      async (update) => {
        for (const acc of update.accounts || []) {
          await applyExtensionAccountUpdate(acc);
        }
      },
    )
      .then(async (out) => {
        if (out.results?.length) {
          await applyResultList(out.results);
        }
        const state = await getDianwuGeoSyncState(3_000);
        if (state?.status === "completed") {
          await finalizeCompletedSync(platforms, state);
        } else if (state?.results?.length) {
          await applyResultList(state.results);
        }
      })
      .catch(async (err) => {
        const msg =
          err instanceof Error ? err.message : "扩展同步任务提交失败";
        for (const pid of platforms) {
          const jobId = resolveJobId(pid);
          if (!jobId || patchedJobStatusRef.current.has(jobId)) continue;
          await patchJob(jobId, { status: "failed", error: msg });
        }
        void loadJobs();
      });

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
      startExtensionSyncWatchers(platforms);
    }
    void getDianwuGeoSyncState(3_000).then(async (state) => {
      if (state?.status === "completed") {
        await finalizeCompletedSync(platforms, state);
      } else {
        await applySyncStateToJobs(state);
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
      beginOpenDianwuGeoPanel(buildManualSyncArticle()).wait;
    manualSyncWaitRef.current = null;
    stashArticleForDianwuGeo(buildManualSyncArticle());
    const saveTask = dirty ? save() : Promise.resolve();

    try {
      const [result] = await Promise.all([wait, saveTask]);
      setExtensionReady(true);
      setMessage(formatDianwuGeoOpenMessage(result));
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
    const { wait } = beginOpenDianwuGeoPanel(buildManualSyncArticle());
    manualSyncWaitRef.current = wait;
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

      <div className="card space-y-4 p-5 md:p-7">
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
        <div data-dwgeo-article-body>
          <RichTextEditor
            value={body}
            onChange={setBody}
            placeholder="在这里写正文，支持标题、加粗、列表、链接、图片…"
          />
        </div>
      </div>

      {jobs.length > 0 && (
        <div className="card p-5">
          <h2 className="text-lg font-medium">本文同步记录</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            扩展任务同步为草稿；成功后请打开链接确认再发布
          </p>
          <ul className="mt-3 space-y-2">
            {jobs.slice(0, 12).map((job) => (
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
                <div className="text-sm text-[var(--muted)]">
                  {job.result_url ? (
                    <a
                      href={job.result_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {job.engine === "playwright" ? "查看链接" : "打开草稿"}
                    </a>
                  ) : (
                    job.error || new Date(job.updated_at).toLocaleString("zh-CN")
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showPublish && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/35 p-4">
          <div className="card flex max-h-[min(85vh,720px)] w-full max-w-lg flex-col p-0 shadow-2xl">
            <div className="shrink-0 border-b border-[var(--line)] px-6 py-5">
              <h2 className="text-xl font-semibold">多平台同步</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                已连本机会话的 API 平台免开窗；扩展平台走 Chrome 草稿；其余本机自动。已选扩展{" "}
                {extSelected} / 本机 {pwSelected}
                {extensionReady === false
                  ? " · 当前未检测到扩展，扩展平台将回落本机自动"
                  : ""}
              </p>
            </div>
            <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
              {PLATFORMS.map((p) => {
                const session = sessions.find((s) => s.platform === p.id);
                const connected = session?.status === "connected";
                const viaApi = isApiDraftPlatform(p.id) && connected;
                const viaExt = !viaApi && isExtensionPlatform(p.id);
                const routeLabel = viaApi
                  ? "API·草稿"
                  : viaExt
                    ? "扩展·草稿"
                    : "本机自动";
                return (
                  <li
                    key={p.id}
                    className="rounded-xl border border-[var(--line)] bg-[#fffdf9] p-3"
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.includes(p.id)}
                        onChange={(e) => {
                          setSelected((prev) =>
                            e.target.checked
                              ? [...prev, p.id]
                              : prev.filter((x) => x !== p.id),
                          );
                        }}
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{p.name}</span>
                          <span
                            className={`badge ${viaApi || viaExt ? "badge-ok" : "badge-warn"}`}
                          >
                            {routeLabel}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {p.limits}
                          {(viaApi || !viaExt) && (
                            <span>
                              {" "}
                              · 本机会话
                              {connected
                                ? "已连接"
                                : viaApi
                                  ? "未连接"
                                  : "未连接（将弹窗登录）"}
                            </span>
                          )}
                        </p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[var(--line)] px-6 py-4">
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
                {publishing ? "同步中…" : "开始同步"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
