"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  MentionProbeSource,
  MentionRun,
  MentionSettings,
  MentionSource,
} from "@/lib/types";
import { MENTION_SOURCES } from "@/lib/types";
import { DOUBAO_CHAT_MODELS } from "@/lib/ai/doubao";
import { QuotaHint, QuotaMessage } from "@/components/QuotaHint";
import { parseQuotaError, useQuota } from "@/components/useQuota";
import { useInfiniteList } from "@/components/useInfiniteList";

const PASTE_SOURCES = MENTION_SOURCES.filter((s) => s.id !== "deepseek");

type Configured = {
  deepseek: boolean;
  doubao: boolean;
  sources: MentionProbeSource[];
};

function linesToList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function listToLines(items: string[]): string {
  return items.join("\n");
}

function sourceLabel(source: MentionSource): string {
  return MENTION_SOURCES.find((s) => s.id === source)?.label ?? source;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

export function MentionPanel() {
  const [brandsText, setBrandsText] = useState("");
  const [questionsText, setQuestionsText] = useState("");
  const [configured, setConfigured] = useState<Configured>({
    deepseek: false,
    doubao: false,
    sources: [],
  });
  const [doubaoModel, setDoubaoModel] = useState("");
  const [doubaoApiKey, setDoubaoApiKey] = useState("");
  const [useDeepseek, setUseDeepseek] = useState(true);
  const [useDoubao, setUseDoubao] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pasteQuestion, setPasteQuestion] = useState("");
  const [pasteSource, setPasteSource] = useState<MentionSource>("yuanbao");
  const [pasteAnswer, setPasteAnswer] = useState("");
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const { snap, refresh, can } = useQuota();
  const mentionQuota = snap("mentions");
  const noMentionQuota = !can("mentions");

  const questions = useMemo(() => linesToList(questionsText), [questionsText]);

  const selectedSources = useMemo(() => {
    const next: MentionProbeSource[] = [];
    if (useDeepseek && configured.deepseek) next.push("deepseek");
    if (useDoubao && configured.doubao) next.push("doubao");
    return next;
  }, [useDeepseek, useDoubao, configured]);

  const applyConfigured = useCallback(
    (next: Configured | undefined, syncChecks = false) => {
      if (!next) return;
      setConfigured(next);
      if (syncChecks) {
        setUseDeepseek(next.deepseek);
        setUseDoubao(next.doubao);
      }
    },
    [],
  );

  const fetchRuns = useCallback(
    async (offset: number, limit: number) => {
      const res = await fetch(
        `/api/mentions?limit=${limit}&offset=${offset}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as {
        settings?: MentionSettings;
        runs?: MentionRun[];
        configured?: Configured;
        nextOffset?: number | null;
        hasMore?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "加载失败");
      if (offset === 0) {
        if (data.settings) {
          setBrandsText(listToLines(data.settings.brands));
          setQuestionsText(listToLines(data.settings.questions));
          setDoubaoModel(data.settings.doubao_model);
          setPasteQuestion((prev) => prev || data.settings!.questions[0] || "");
        }
        applyConfigured(data.configured, true);
      }
      const runs = data.runs ?? [];
      if (offset === 0 && runs[0]?.id) setOpenRunId(runs[0].id);
      return {
        items: runs,
        nextOffset: data.nextOffset ?? null,
        hasMore: Boolean(data.hasMore),
      };
    },
    [applyConfigured],
  );

  const {
    items: runs,
    setItems: setRuns,
    booting,
    sentinel,
  } = useInfiniteList<MentionRun>(fetchRuns);

  const loading = booting;

  async function saveSettings(extra?: { doubaoApiKey?: string }) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/mentions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brands: linesToList(brandsText),
          questions: linesToList(questionsText),
          doubaoModel,
          doubaoApiKey: extra?.doubaoApiKey ?? doubaoApiKey,
        }),
      });
      const data = (await res.json()) as {
        settings?: MentionSettings;
        configured?: Configured;
        error?: string;
      };
      if (!res.ok || !data.settings) {
        setMessage(data.error || "保存失败");
        return false;
      }
      setBrandsText(listToLines(data.settings.brands));
      setQuestionsText(listToLines(data.settings.questions));
      setDoubaoModel(data.settings.doubao_model);
      applyConfigured(data.configured);
      if (extra?.doubaoApiKey || doubaoApiKey.trim()) {
        setDoubaoApiKey("");
      }
      return true;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function runProbe() {
    setRunning(true);
    setMessage(null);
    try {
      await saveSettings();
      const res = await fetch("/api/mentions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "run",
          brands: linesToList(brandsText),
          questions: linesToList(questionsText),
          sources: selectedSources,
        }),
      });
      const data = (await res.json()) as { run?: MentionRun; error?: string; code?: string };
      const quota = parseQuotaError(res, data);
      if (quota) {
        setMessage(quota);
        void refresh();
        return;
      }
      if (!res.ok || !data.run) {
        setMessage(data.error || "检测失败");
        return;
      }
      setRuns((prev) => [data.run!, ...prev]);
      setOpenRunId(data.run.id);
      const total = data.run.hit_count + data.run.miss_count + data.run.error_count;
      setMessage(
        `本轮 ${data.run.hit_count}/${total} 题提到品牌${
          data.run.error_count ? `，${data.run.error_count} 题失败` : ""
        }`,
      );
      void refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "检测失败");
    } finally {
      setRunning(false);
    }
  }

  async function scorePaste() {
    setScoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/mentions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "score",
          question: pasteQuestion,
          answer: pasteAnswer,
          source: pasteSource,
        }),
      });
      const data = (await res.json()) as { run?: MentionRun; error?: string; code?: string };
      const quota = parseQuotaError(res, data);
      if (quota) {
        setMessage(quota);
        void refresh();
        return;
      }
      if (!res.ok || !data.run) {
        setMessage(data.error || "记入失败");
        return;
      }
      setRuns((prev) => [data.run!, ...prev]);
      setOpenRunId(data.run.id);
      setPasteAnswer("");
      const hit = data.run.results[0]?.mentioned;
      setMessage(hit ? "对照结果：提到了品牌" : "对照结果：未提到品牌");
      void refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "记入失败");
    } finally {
      setScoring(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">查排名</h1>
        <p className="mt-1 text-[var(--muted)]">
          用 DeepSeek 和火山方舟里的豆包问同一组问题，看答案里有没有品牌词。这是模型探针，不是豆包 App 的收录排名。
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="card space-y-4 p-5">
          <h2 className="text-lg font-medium">探测设置</h2>
          <label className="block">
            <span className="mb-1 block text-sm text-[var(--muted)]">
              品牌词（一行一个，命中任一即算提到）
            </span>
            <textarea
              className="field min-h-[96px]"
              value={brandsText}
              onChange={(e) => setBrandsText(e.target.value)}
              placeholder={"点物\ndianwu.ai"}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-[var(--muted)]">
              问题（最多 8 条，系统提示里不会出现品牌名）
            </span>
            <textarea
              className="field min-h-[160px]"
              value={questionsText}
              onChange={(e) => setQuestionsText(e.target.value)}
              placeholder="GEO是什么？中小企业怎么做？"
            />
          </label>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useDeepseek}
                disabled={!configured.deepseek}
                onChange={(e) => setUseDeepseek(e.target.checked)}
              />
              DeepSeek
              <span className={`badge ${configured.deepseek ? "badge-ok" : "badge-danger"}`}>
                {configured.deepseek ? "已配置" : "未配置"}
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useDoubao}
                disabled={!configured.doubao}
                onChange={(e) => setUseDoubao(e.target.checked)}
              />
              豆包
              <span className={`badge ${configured.doubao ? "badge-ok" : "badge-danger"}`}>
                {configured.doubao ? "已配置" : "未配置"}
              </span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={running || noMentionQuota || !questions.length || !selectedSources.length}
              onClick={() => void runProbe()}
            >
              {running ? "正在提问…" : "跑一轮"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={saving}
              onClick={() => void saveSettings()}
            >
              {saving ? "保存中…" : "保存设置"}
            </button>
            <QuotaHint snap={mentionQuota} need={1} />
          </div>
          {running ? (
            <p className="text-sm text-[var(--muted)]">
              每个模型每题大约十几秒。勾了两个模型时会并行问。
            </p>
          ) : null}
        </div>

        <div className="space-y-6">
          <div className="card space-y-4 p-5">
            <h2 className="text-lg font-medium">豆包（火山方舟）</h2>
            <p className="text-sm text-[var(--muted)]">
              网页版豆包没有接口。用方舟 API Key 调豆包模型。
              不要填 Doubao-Seed-Character 这种角色名，用下面的对话模型，或控制台里的 ep- 接入点。
              若提示欠费，先到火山引擎费用中心充值。
            </p>
            <label className="block">
              <span className="mb-1 block text-sm text-[var(--muted)]">API Key</span>
              <input
                className="field"
                type="password"
                autoComplete="off"
                value={doubaoApiKey}
                onChange={(e) => setDoubaoApiKey(e.target.value)}
                placeholder={configured.doubao ? "已保存，留空则不改" : "ARK 开头的方舟 Key"}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-[var(--muted)]">
                模型 ID（方舟控制台的 Model ID 或 ep- 接入点，不要填角色名）
              </span>
              <select
                className="field"
                value={
                  DOUBAO_CHAT_MODELS.includes(
                    doubaoModel as (typeof DOUBAO_CHAT_MODELS)[number],
                  )
                    ? doubaoModel
                    : "__custom"
                }
                onChange={(e) => {
                  if (e.target.value === "__custom") {
                    setDoubaoModel(doubaoModel.startsWith("ep-") ? doubaoModel : "ep-");
                    return;
                  }
                  setDoubaoModel(e.target.value);
                }}
              >
                {DOUBAO_CHAT_MODELS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
                <option value="__custom">自定义接入点 ep-…</option>
              </select>
            </label>
            {!DOUBAO_CHAT_MODELS.includes(
              doubaoModel as (typeof DOUBAO_CHAT_MODELS)[number],
            ) ? (
              <input
                className="field"
                value={doubaoModel}
                onChange={(e) => setDoubaoModel(e.target.value)}
                placeholder="ep-xxxxxxxxxxxxxxxx"
              />
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || (!doubaoApiKey.trim() && !configured.doubao)}
                onClick={() => void saveSettings({ doubaoApiKey })}
              >
                {saving ? "保存中…" : "保存豆包配置"}
              </button>
              <a
                className="text-sm underline"
                href="https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey"
                target="_blank"
                rel="noreferrer"
              >
                去方舟控制台拿 Key
              </a>
            </div>
          </div>

          <div className="card space-y-4 p-5">
            <h2 className="text-lg font-medium">手工对照</h2>
            <p className="text-sm text-[var(--muted)]">
              元宝、通义，或豆包 App 里的回答，仍可粘过来记一笔。
            </p>
            <label className="block">
              <span className="mb-1 block text-sm text-[var(--muted)]">问题</span>
              <select
                className="field"
                value={pasteQuestion}
                onChange={(e) => setPasteQuestion(e.target.value)}
              >
                {questions.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
                {!questions.includes(pasteQuestion) && pasteQuestion ? (
                  <option value={pasteQuestion}>{pasteQuestion}</option>
                ) : null}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-[var(--muted)]">来源</span>
              <select
                className="field"
                value={pasteSource}
                onChange={(e) => setPasteSource(e.target.value as MentionSource)}
              >
                {PASTE_SOURCES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-[var(--muted)]">粘贴回答</span>
              <textarea
                className="field min-h-[140px]"
                value={pasteAnswer}
                onChange={(e) => setPasteAnswer(e.target.value)}
                placeholder="把元宝 / 通义 / 豆包 App 的回答贴在这里"
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                scoring ||
                noMentionQuota ||
                !pasteAnswer.trim() ||
                !pasteQuestion.trim()
              }
              onClick={() => void scorePaste()}
            >
              {scoring ? "记入中…" : "记入结果"}
            </button>
          </div>
        </div>
      </div>

      {message ? (
        <QuotaMessage text={message} className="text-sm" />
      ) : null}

      <div className="card space-y-4 p-5">
        <h2 className="text-lg font-medium">历史</h2>
        {loading ? (
          <p className="text-sm text-[var(--muted)]">加载中…</p>
        ) : !runs.length ? (
          <p className="text-sm text-[var(--muted)]">还没有记录。先跑一轮或粘贴一条对照。</p>
        ) : (
          <div className="space-y-3">
            {runs.map((run) => {
              const total = run.hit_count + run.miss_count + run.error_count;
              const open = openRunId === run.id;
              return (
                <div key={run.id} className="rounded-lg border border-[var(--line)]">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left"
                    onClick={() => setOpenRunId(open ? null : run.id)}
                  >
                    <span className="text-sm">
                      {formatTime(run.created_at)} · {run.model}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`badge ${run.hit_count > 0 ? "badge-ok" : "badge-danger"}`}>
                        {run.hit_count}/{total} 提到
                      </span>
                    </span>
                  </button>
                  {open ? (
                    <ul className="space-y-3 border-t border-[var(--line)] px-4 py-3">
                      {run.results.map((row) => (
                        <li key={row.id} className="space-y-1 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`badge ${
                                row.error
                                  ? "badge-danger"
                                  : row.mentioned
                                    ? "badge-ok"
                                    : "badge-danger"
                              }`}
                            >
                              {row.error
                                ? "失败"
                                : row.mentioned
                                  ? "提到"
                                  : "未提"}
                            </span>
                            <span className="text-[var(--muted)]">
                              {sourceLabel(row.source)}
                            </span>
                            <span>{row.question}</span>
                          </div>
                          {row.error ? (
                            <p className="text-[var(--danger)]">{row.error}</p>
                          ) : row.excerpt ? (
                            <p className="text-[var(--muted)]">{row.excerpt}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
            {sentinel}
          </div>
        )}
      </div>
    </div>
  );
}
