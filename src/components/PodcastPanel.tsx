"use client";

import { useEffect, useState } from "react";
import { HumanTalkRevise } from "@/components/HumanTalkRevise";
import { ModelPicker, type ModelPickerItem } from "@/components/ModelPicker";
import { PodcastListen } from "@/components/PodcastListen";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import { VoiceSelect, type VoiceSelectOption } from "@/components/VoiceSelect";
import {
  DEFAULT_PODCAST_GUEST_VOICE,
  DEFAULT_PODCAST_HOST_VOICE,
  DEFAULT_PODCAST_TTS_MODEL,
  type PublicPodcast,
} from "@/lib/ai/podcast-shared";
import type { PodcastMode } from "@/lib/types";

type PodcastView = PublicPodcast;

type Props = {
  articleId: string;
  title: string;
};

async function readNdjsonEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flushLines = (flush: boolean) => {
    const lines = buffer.split("\n");
    if (!flush) buffer = lines.pop() || "";
    else buffer = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        onEvent(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        // skip
      }
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    if (done) {
      buffer += decoder.decode();
      flushLines(true);
      break;
    }
    flushLines(false);
  }
}

export function PodcastPanel({ articleId, title }: Props) {
  const [podcast, setPodcast] = useState<PodcastView | null>(null);
  const [voices, setVoices] = useState<VoiceSelectOption[]>([]);
  const [models, setModels] = useState<ModelPickerItem[]>([]);
  const [reviewModels, setReviewModels] = useState<ModelPickerItem[]>([]);
  const [ttsModels, setTtsModels] = useState<ModelPickerItem[]>([]);
  const [mode, setMode] = useState<PodcastMode>("dialogue");
  const [hostVoice, setHostVoice] = useState(DEFAULT_PODCAST_HOST_VOICE);
  const [guestVoice, setGuestVoice] = useState(DEFAULT_PODCAST_GUEST_VOICE);
  const [modelId, setModelId] = useState("deepseek-reasoner");
  const [reviewModel, setReviewModel] = useState("deepseek-chat");
  const [ttsModel, setTtsModel] = useState(DEFAULT_PODCAST_TTS_MODEL);
  const [busy, setBusy] = useState(false);
  const [covering, setCovering] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [oralReady, setOralReady] = useState<{
    mode: PodcastMode;
    turns: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/articles/${articleId}/podcast`, {
          cache: "no-store",
        });
        const data = (await res.json()) as {
          podcast?: PodcastView | null;
          voices?: VoiceSelectOption[];
          scriptModels?: ModelPickerItem[];
          reviewModels?: ModelPickerItem[];
          ttsModels?: ModelPickerItem[];
          defaults?: {
            hostVoice?: string;
            guestVoice?: string;
            ttsModel?: string;
          };
          oralScript?: { mode?: PodcastMode; turns?: number } | null;
        };
        if (cancelled) return;
        if (data.voices?.length) setVoices(data.voices);
        if (data.scriptModels?.length) {
          setModels(data.scriptModels);
          const ready = data.scriptModels.find((m) => m.ready !== false);
          if (ready?.id) setModelId(ready.id);
        }
        const reviews = data.reviewModels?.length
          ? data.reviewModels
          : data.scriptModels || [];
        if (reviews.length) {
          setReviewModels(reviews);
          let savedReview = "";
          try {
            savedReview = localStorage.getItem("dwgeo-review-model") || "";
          } catch {
            savedReview = "";
          }
          const picked =
            (savedReview &&
              reviews.find((m) => m.id === savedReview && m.ready !== false)?.id) ||
            reviews.find((m) => m.id === "deepseek-chat" && m.ready !== false)?.id ||
            reviews.find((m) => m.ready !== false)?.id ||
            reviews[0]?.id;
          if (picked) setReviewModel(picked);
        }
        if (data.ttsModels?.length) {
          setTtsModels(data.ttsModels);
          const ready = data.ttsModels.find((m) => m.ready !== false);
          if (ready?.id) setTtsModel(ready.id);
        }
        if (data.defaults?.ttsModel) setTtsModel(data.defaults.ttsModel);
        if (data.oralScript?.mode) {
          setOralReady({
            mode: data.oralScript.mode,
            turns: Number(data.oralScript.turns) || 0,
          });
          if (!data.podcast) setMode(data.oralScript.mode);
        } else {
          setOralReady(null);
        }
        if (data.podcast) {
          setPodcast(data.podcast);
          setMode(data.podcast.mode);
          if (data.podcast.hostVoice) setHostVoice(data.podcast.hostVoice);
          if (data.podcast.guestVoice) setGuestVoice(data.podcast.guestVoice);
          if (data.podcast.ttsModel) setTtsModel(data.podcast.ttsModel);
          if (data.podcast.status === "failed" && data.podcast.error) {
            setError(data.podcast.error);
          }
          if (data.podcast.status === "pending") {
            setStatus(
              (data.podcast.turns || []).length
                ? "上次配音可能中断了，改完再点确认配音"
                : "上次写稿可能中断了，再点一次",
            );
          }
        } else {
          if (data.defaults?.hostVoice) setHostVoice(data.defaults.hostVoice);
          if (data.defaults?.guestVoice) setGuestVoice(data.defaults.guestVoice);
        }
      } catch {
        if (!cancelled) setError("播客加载失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  async function generate() {
    if (busy || covering) return;
    setBusy(true);
    setError(null);
    setStatus(mode === "solo" ? "正在写口播…" : "正在写对谈…");
    try {
      const res = await fetch(`/api/articles/${articleId}/podcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "script",
          mode,
          hostVoice,
          guestVoice,
          model: modelId,
          reviewModel,
          ttsModel,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "生成失败");
      }
      let gotDone = false;
      await readNdjsonEvents(res.body, (event) => {
        if (event.type === "progress" && typeof event.message === "string") {
          setStatus(event.message);
        } else if (event.type === "error") {
          throw new Error(
            typeof event.error === "string" ? event.error : "生成失败",
          );
        } else if (event.type === "done" && event.podcast) {
          gotDone = true;
          const next = event.podcast as PodcastView;
          setPodcast(next);
          setStatus(
            next.status === "draft"
              ? next.mode === "solo"
                ? "口播已写好，先改到你点头再配音"
                : "对谈已写好，先改到你点头再配音"
              : next.coverUrl
                ? "播客已生成"
                : "播客已生成，封面没出成",
          );
        }
      });
      if (!gotDone) throw new Error("生成中断，请再试一次");
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function speak() {
    if (busy || covering) return;
    setBusy(true);
    setError(null);
    setStatus(mode === "solo" ? "开始按情绪配音…" : "开始按情绪配音…");
    try {
      const res = await fetch(`/api/articles/${articleId}/podcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "speak",
          hostVoice,
          guestVoice,
          ttsModel,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "配音失败");
      }
      let gotDone = false;
      await readNdjsonEvents(res.body, (event) => {
        if (event.type === "progress" && typeof event.message === "string") {
          setStatus(event.message);
        } else if (event.type === "error") {
          throw new Error(
            typeof event.error === "string" ? event.error : "配音失败",
          );
        } else if (event.type === "done" && event.podcast) {
          gotDone = true;
          const next = event.podcast as PodcastView;
          setPodcast(next);
          setStatus(next.coverUrl ? "播客已生成" : "播客已生成，封面没出成");
        }
      });
      if (!gotDone) throw new Error("配音中断，请再试一次");
    } catch (err) {
      setError(err instanceof Error ? err.message : "配音失败");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function applyRevisedScript(raw: string) {
    if (!podcast) return;
    let nextTurns = podcast.turns;
    let nextTitle = podcast.title;
    try {
      const json = JSON.parse(raw) as {
        title?: unknown;
        turns?: Array<{ speaker?: unknown; text?: unknown; feel?: unknown }>;
      };
      if (typeof json.title === "string" && json.title.trim()) {
        nextTitle = json.title.trim().slice(0, 24);
      }
      if (Array.isArray(json.turns) && json.turns.length) {
        nextTurns = json.turns
          .map((row, index) => {
            const speaker = row.speaker === "guest" ? ("guest" as const) : ("host" as const);
            const text = String(row.text || "").trim();
            if (!text) return null;
            const prev = podcast.turns[index];
            return {
              index: index + 1,
              speaker,
              name:
                podcast.mode === "solo"
                  ? "口播"
                  : speaker === "guest"
                    ? "答"
                    : "问",
              text,
              feel: String(row.feel || prev?.feel || "").trim(),
              audioUrl: "",
              durationSec: 0,
            };
          })
          .filter((row): row is NonNullable<typeof row> => Boolean(row));
      }
    } catch {
      throw new Error("改稿格式不对，再试一次");
    }
    if (!nextTurns.length) return;
    const res = await fetch(`/api/articles/${articleId}/podcast`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: nextTitle,
        turns: nextTurns.map((turn) => ({
          speaker: turn.speaker,
          text: turn.text,
          feel: turn.feel,
        })),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      podcast?: PodcastView;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error || "保存改稿失败");
    if (data.podcast) setPodcast(data.podcast);
  }

  async function fillCover() {
    if (busy || covering || !podcast) return;
    setCovering(true);
    setError(null);
    setStatus("正在出封面…");
    try {
      const res = await fetch(`/api/articles/${articleId}/podcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverOnly: true }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        podcast?: PodcastView;
        error?: string;
      };
      if (data.podcast) setPodcast(data.podcast);
      if (!res.ok) throw new Error(data.error || "封面没出成");
      setStatus("封面已出");
    } catch (err) {
      setError(err instanceof Error ? err.message : "封面没出成");
      setStatus(null);
    } finally {
      setCovering(false);
    }
  }

  const turns = podcast?.turns || [];
  const ready = podcast?.status === "ready" && turns.length > 0;
  const draft = podcast?.status === "draft" && turns.length > 0;
  const shortTitle = title.trim().slice(0, 16);
  const draftText = podcast
    ? JSON.stringify(
        {
          title: podcast.title,
          turns: turns.map((turn) => ({
            speaker: turn.speaker,
            text: turn.text,
            feel: turn.feel || "",
          })),
        },
        null,
        2,
      )
    : "";

  return (
    <div className="space-y-3">
      <header className="video-music-lead">
        <p className="video-music-lead__kicker">文章播客</p>
        <h2>
          {oralReady
            ? oralReady.mode === "solo"
              ? `「${shortTitle || "这篇"}」已经写好口播了，先过一遍再配音`
              : `「${shortTitle || "这篇"}」已经写好对谈了，先过一遍再配音`
            : shortTitle
              ? `把「${shortTitle}」变成能听的`
              : "把这篇变成能听的"}
        </h2>
        <p>
          {oralReady
            ? oralReady.mode === "solo"
              ? "写作里已经定成单人说。先改到你点头，再配音、出封面。"
              : "写作里已经定成两个人聊。先改到你点头，再配音、出封面。"
            : mode === "solo"
              ? "一个人说。话要浅，小学生也听得懂。写完先改，点头再配音。"
              : "两个人聊。话要浅，小学生也听得懂。写完先改，点头再配音。"}
        </p>
      </header>
      <div id="podcast" className="card scroll-mt-24 space-y-4 p-5">
        <div className="podcast-toolbar">
          <select
            className="field"
            value={mode}
            disabled={busy || covering || Boolean(oralReady)}
            title={oralReady ? "正文已经定好单人还是对谈" : "说话方式"}
            onChange={(e) => setMode(e.target.value as PodcastMode)}
          >
            <option value="dialogue">双人对谈</option>
            <option value="solo">单人口播</option>
          </select>
          <label className="podcast-toolbar__voice">
            <span>{mode === "solo" ? "口播" : "问"}</span>
            <VoiceSelect
              value={hostVoice}
              voices={voices}
              disabled={busy || covering}
              title={mode === "solo" ? "口播音色" : "主持音色"}
              className="script-toolbar__voice-pick"
              onChange={setHostVoice}
            />
            <VoicePreviewButton
              voiceId={hostVoice}
              disabled={busy || covering}
              ttsModel={ttsModel}
              kind="podcast"
              speaker="host"
              mode={mode}
            />
          </label>
          {mode === "dialogue" ? (
            <label className="podcast-toolbar__voice">
              <span>答</span>
              <VoiceSelect
                value={guestVoice}
                voices={voices}
                disabled={busy || covering}
                title="嘉宾音色"
                className="script-toolbar__voice-pick"
                onChange={setGuestVoice}
              />
              <VoicePreviewButton
                voiceId={guestVoice}
                disabled={busy || covering}
                ttsModel={ttsModel}
                kind="podcast"
                speaker="guest"
                mode={mode}
              />
            </label>
          ) : null}
          {ttsModels.length > 0 ? (
            <label className="podcast-toolbar__voice">
              <span>配音</span>
              <ModelPicker
                value={ttsModel}
                items={ttsModels}
                disabled={busy || covering}
                title="配音模型"
                placeholder="配音"
                onChange={setTtsModel}
              />
            </label>
          ) : null}
          {models.length > 0 && !oralReady ? (
            <label className="podcast-toolbar__voice">
              <span>写对谈</span>
              <ModelPicker
                value={modelId}
                items={models}
                disabled={busy || covering}
                title="写对谈的模型"
                placeholder="写对谈"
                onChange={setModelId}
              />
            </label>
          ) : null}
          {reviewModels.length > 0 ? (
            <label className="podcast-toolbar__voice">
              <span>人话审核</span>
              <ModelPicker
                value={reviewModel}
                items={reviewModels}
                disabled={busy || covering}
                title="人话审核的模型"
                placeholder="人话审核"
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
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || covering}
            onClick={() => void generate()}
          >
            {busy
              ? "生成中…"
              : ready || draft
                ? mode === "solo"
                  ? "重写口播"
                  : "重写对谈"
                : mode === "solo"
                  ? "写口播"
                  : "写对谈"}
          </button>
          {ready && podcast && !podcast.coverUrl ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || covering}
              onClick={() => void fillCover()}
            >
              {covering ? "出封面中…" : "出封面"}
            </button>
          ) : null}
        </div>
        {status ? (
          <p className="text-sm text-[var(--muted)]">{status}</p>
        ) : null}
        {error ? (
          <p className="text-sm text-[var(--danger)]">{error}</p>
        ) : null}
        {ready && podcast ? (
          <PodcastListen podcast={podcast} />
        ) : draft && podcast ? (
          <div className="space-y-3">
            <ol className="space-y-2 text-sm">
              {turns.map((turn) => (
                <li
                  key={turn.index}
                  className="rounded-lg border border-[var(--line)] px-3 py-2"
                >
                  <span className="mr-2 font-medium">
                    {turn.name || (turn.speaker === "guest" ? "答" : "问")}
                  </span>
                  <span>{turn.text}</span>
                  {turn.feel ? (
                    <span className="ml-2 text-xs text-[var(--muted)]">
                      {turn.feel}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
            <HumanTalkRevise
              kind="podcast"
              text={draftText}
              reviewModel={reviewModel}
              disabled={busy || covering}
              confirming={busy}
              confirmLabel="确认，开始配音"
              onText={(next) => applyRevisedScript(next)}
              onConfirm={() => speak()}
            />
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            写完正文后点写对谈。先改到你点头，再配音。
          </p>
        )}
      </div>
    </div>
  );
}
