"use client";

import { useEffect, useState } from "react";
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
  const [ttsModels, setTtsModels] = useState<ModelPickerItem[]>([]);
  const [mode, setMode] = useState<PodcastMode>("dialogue");
  const [hostVoice, setHostVoice] = useState(DEFAULT_PODCAST_HOST_VOICE);
  const [guestVoice, setGuestVoice] = useState(DEFAULT_PODCAST_GUEST_VOICE);
  const [modelId, setModelId] = useState("deepseek-reasoner");
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
            setStatus("上次生成可能中断了，再点一次");
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
          mode,
          hostVoice,
          guestVoice,
          model: modelId,
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
          setStatus(next.coverUrl ? "播客已生成" : "播客已生成，封面没出成");
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
  const shortTitle = title.trim().slice(0, 16);

  return (
    <div className="space-y-3">
      <header className="video-music-lead">
        <p className="video-music-lead__kicker">文章播客</p>
        <h2>
          {oralReady
            ? oralReady.mode === "solo"
              ? `「${shortTitle || "这篇"}」已是单人口播，生成时直接配音`
              : `「${shortTitle || "这篇"}」已是双人对谈，生成时直接配音`
            : shortTitle
              ? `把「${shortTitle}」改成能听下去的口播`
              : "把这篇改成能听下去的口播"}
        </h2>
        <p>
          {oralReady
            ? oralReady.mode === "solo"
              ? "写作里选的单人口播已经定好了，不再重写成对谈。点生成只配音、出封面。"
              : "写作里选的双人对谈已经定好了，不再重写成单人口播。点生成只配音、出封面。"
            : mode === "solo"
              ? "单人吸引力口播：第一句停住，每段只揭一层、结尾钩住下一段。说话要有情绪，不是念稿。"
              : "双人对谈：主持是听的人在追问，嘉宾每次只揭一层、话尾再钩。两个人都要有口气，不是采访提纲。"}
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
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || covering}
            onClick={() => void generate()}
          >
            {busy ? "生成中…" : ready ? "再生成" : "生成播客"}
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
        ) : (
          <p className="text-sm text-[var(--muted)]">
            写完正文后点生成。单人口播和双人对谈用两套写法，都是连环钩，听的人想划走也划不掉。判断仍来自正文。
          </p>
        )}
      </div>
    </div>
  );
}
