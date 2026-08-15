"use client";

import { useEffect, useState } from "react";
import type {
  ArticleVideoSeries,
  VideoCharacterAngle,
  VideoCharacterPhoto,
  VideoScriptHookStyle,
  VideoShot,
  VideoSpeakMode,
} from "@/lib/types";
import { normalizeSpeakMode } from "@/lib/types";
import {
  VIDEO_SCRIPT_HOOK_STYLES,
  hookStyleLabel,
  normalizeHookStyle,
} from "@/lib/ai/video-script-styles";
import { EpisodeVideoPlayer } from "@/components/EpisodeVideoPlayer";
import { SceneShotBoard } from "@/components/SceneShotBoard";
import { VideoCharacterPanel } from "@/components/VideoCharacterPanel";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import { VoiceSelect } from "@/components/VoiceSelect";
import {
  DEFAULT_NARRATOR_VOICE,
  NARRATOR_SPEAKER_ID,
  resolveVoiceId,
} from "@/lib/ai/tts-voice-ids";

type EpisodeView = {
  id: string;
  episode_no: number;
  title: string;
  hook: string;
  voiceover: string;
  on_screen: string;
  recap: string;
  next_hook: string;
  duration_sec: number;
  shots: VideoShot[];
  confirmed: boolean;
  video_status: "idle" | "generating" | "ready" | "failed";
  video_url: string | null;
  video_error: string | null;
  video_model: string | null;
};

type VideoResolution = "480p" | "720p";

type VideoModelOption = {
  id: string;
  label: string;
  hint: string;
  model?: string;
  generateAudio?: boolean;
  resolutions?: VideoResolution[];
};

const DEFAULT_VIDEO_MODELS: VideoModelOption[] = [
  {
    id: "seedance-2-mini",
    label: "Doubao-Seedance-2.0-mini",
    hint: "先配音再对口型",
    generateAudio: true,
    resolutions: ["480p", "720p"],
  },
  {
    id: "seedance-2-fast",
    label: "Doubao-Seedance-2.0-fast",
    hint: "比 mini 更清，须先开通",
    generateAudio: true,
    resolutions: ["480p", "720p"],
  },
];

function composeVideoPresetId(modelId: string, resolution: VideoResolution): string {
  return `${modelId}-${resolution === "720p" ? "720" : "480"}`;
}

type CharacterOption = {
  id: string;
  name: string;
  thumb: string;
  voice_id?: string;
  angles?: VideoCharacterAngle[];
  photos?: VideoCharacterPhoto[];
};

type VoiceOption = {
  id: string;
  label: string;
  hint?: string;
  group?: string;
};

type Payload = {
  series: ArticleVideoSeries | null;
  episodes: EpisodeView[];
  videoReady: boolean;
  videoModels?: VideoModelOption[];
  voices?: VoiceOption[];
  characters?: CharacterOption[];
  cast?: CharacterOption[];
  suggestedName?: string;
};

type Props = {
  articleId: string;
  title: string;
  bodyHtml: string;
};

function genreLabel(series: Pick<ArticleVideoSeries, "genre" | "hook_style">): string {
  return hookStyleLabel(series.hook_style || series.genre);
}

function scenesReady(shots: VideoShot[]): boolean {
  return shots.length > 0 && shots.every((s) => Boolean(s.sceneUrl?.trim()));
}

function clipsReady(shots: VideoShot[]): boolean {
  return shots.length > 0 && shots.every((s) => Boolean(s.clipUrl?.trim()));
}

function pendingClipScenesReady(shots: VideoShot[]): boolean {
  const pending = shots.filter((s) => !s.clipUrl?.trim());
  return pending.length === 0 || pending.every((s) => Boolean(s.sceneUrl?.trim()));
}

async function readNdjsonEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        onEvent(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        // skip broken line
      }
    }
  }
}

export function VideoScriptPanel({ articleId, title, bodyHtml }: Props) {
  const [hookStyle, setHookStyle] = useState<VideoScriptHookStyle>("talk");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [renderingId, setRenderingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [thinking, setThinking] = useState("");
  const [draft, setDraft] = useState("");
  const [modelName, setModelName] = useState("");
  const [series, setSeries] = useState<ArticleVideoSeries | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeView[]>([]);
  const [videoReady, setVideoReady] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rewritingId, setRewritingId] = useState<string | null>(null);
  const [videoModels, setVideoModels] = useState<VideoModelOption[]>(
    DEFAULT_VIDEO_MODELS,
  );
  const [videoModelId, setVideoModelId] = useState("seedance-2-mini");
  const [videoResolution, setVideoResolution] = useState<VideoResolution>("480p");
  const [seriesName, setSeriesName] = useState("");
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [castIds, setCastIds] = useState<string[]>([]);
  const [speakMode, setSpeakMode] = useState<VideoSpeakMode>("narration");
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState(DEFAULT_NARRATOR_VOICE);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [sceneProgress, setSceneProgress] = useState<{
    current: number;
    total: number;
    done: number;
    message: string;
    kind?: "scene" | "video";
  } | null>(null);
  const [renderProgress, setRenderProgress] = useState<{
    current: number;
    total: number;
    done: number;
    message: string;
    kind?: "scene" | "video";
  } | null>(null);

  function applyPayload(data: Payload) {
    setSeries(data.series);
    setEpisodes(data.episodes || []);
    setVideoReady(Boolean(data.videoReady));
    const models = data.videoModels;
    if (models?.length) {
      setVideoModels(models);
      setVideoModelId((cur) => {
        const next = models.some((m) => m.id === cur) ? cur : models[0].id;
        const picked = models.find((m) => m.id === next) || models[0];
        const allowed = picked.resolutions?.length
          ? picked.resolutions
          : (["480p", "720p"] as VideoResolution[]);
        setVideoResolution((res) => (allowed.includes(res) ? res : allowed[0]));
        return next;
      });
    }
    if (data.characters) setCharacters(data.characters);
    const nextCastIds = Array.isArray(data.cast)
      ? data.cast.map((c) => c.id)
      : data.series?.character_id
        ? [data.series.character_id]
        : [];
    if (data.series) setCastIds(nextCastIds);
    const nextVoices = data.voices;
    if (nextVoices?.length) setVoices(nextVoices);
    if (data.series) {
      setHookStyle(normalizeHookStyle(data.series.hook_style || data.series.genre));
      if (data.series.title) setSeriesName(data.series.title);
      const nextSpeak = normalizeSpeakMode(data.series.speak_mode);
      setSpeakMode(nextSpeak);
      if (data.series.voice_id) {
        setVoiceId(resolveVoiceId(data.series.voice_id, DEFAULT_NARRATOR_VOICE));
      } else if (nextVoices?.find((v) => v.group === "旁白")) {
        setVoiceId(nextVoices.find((v) => v.group === "旁白")!.id);
      }
    } else if (data.suggestedName) {
      setSeriesName((cur) => cur || data.suggestedName || "");
    }
    const raw =
      typeof window !== "undefined"
        ? window.location.hash.replace(/^#/, "")
        : "";
    const wanted = raw.startsWith("ep-") ? raw.slice(3) : "";
    const hashEp = wanted
      ? data.episodes?.find((ep) => ep.id === wanted)
      : null;
    if (hashEp) setOpenId(hashEp.id);
    else if (!openId && data.episodes?.[0]) setOpenId(data.episodes[0].id);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/articles/${articleId}/video-script`);
        const data = (await res.json()) as Payload;
        if (cancelled || !res.ok) return;
        applyPayload(data);
        if (!data.series && !data.suggestedName) {
          const named = await fetch(
            `/api/articles/${articleId}/script-title`,
            { method: "POST" },
          );
          const namedData = (await named.json()) as { script_title?: string };
          if (!cancelled && namedData.script_title) {
            setSeriesName(namedData.script_title);
          }
        }
      } catch {
        // empty until generate
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  function ProcessView() {
    if (!thinking && !draft) return null;
    return (
      <div className="space-y-2">
        {thinking && (
          <div>
            <div className="mb-1 text-xs text-[var(--muted)]">思考过程</div>
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-white/60 p-3 text-xs leading-relaxed text-[var(--muted)]">
              {thinking}
            </pre>
          </div>
        )}
        {draft && (
          <div>
            <div className="mb-1 text-xs text-[var(--muted)]">正在落笔</div>
            <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-white/60 p-3 text-xs leading-relaxed">
              {draft.slice(-1200)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  async function generate(regenerateEpisodeId?: string) {
    setBusy(true);
    setRewritingId(regenerateEpisodeId || null);
    if (regenerateEpisodeId) setOpenId(regenerateEpisodeId);
    setError(null);
    setThinking("");
    setDraft("");
    setModelName("");
    setStatus(
      regenerateEpisodeId
        ? "正在重写本集…"
        : count === 1
          ? "正在写 1 集 90 秒剧本…"
          : `正在按抖音节奏拆 ${count} 集…`,
    );
    try {
      const res = await fetch(`/api/articles/${articleId}/video-script`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          bodyHtml,
          hookStyle,
          episodeCount: count,
          seriesName,
          cast: castIds,
          speakMode,
          voiceId,
          regenerateEpisodeId,
          stream: true,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "生成剧本失败");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let donePayload: Payload | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(trimmed) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (event.type === "status" && typeof event.message === "string") {
            setStatus(event.message);
          } else if (event.type === "meta" && typeof event.model === "string") {
            setModelName(event.model);
          } else if (event.type === "thinking" && typeof event.delta === "string") {
            setThinking((prev) => prev + event.delta);
          } else if (event.type === "content" && typeof event.delta === "string") {
            setDraft((prev) => prev + event.delta);
          } else if (event.type === "error") {
            throw new Error(
              typeof event.error === "string" ? event.error : "生成剧本失败",
            );
          } else if (event.type === "done") {
            donePayload = event as unknown as Payload;
          }
        }
      }

      if (!donePayload?.episodes) {
        throw new Error("没有收到完整剧本，请再试一次");
      }
      applyPayload(donePayload);
      if (regenerateEpisodeId) setOpenId(regenerateEpisodeId);
      setStatus(
        regenerateEpisodeId
          ? "本集已重写，请再确认"
          : `已写出 ${donePayload.episodes.length} 集，先改、确认，再按集出视频`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成剧本失败");
    } finally {
      setBusy(false);
      setRewritingId(null);
    }
  }

  async function saveEpisode(episode: EpisodeView, extra?: Partial<EpisodeView>) {
    const next = { ...episode, ...extra };
    setEpisodes((rows) => rows.map((row) => (row.id === next.id ? next : row)));
    const res = await fetch(`/api/articles/${articleId}/video-script`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        episodeId: next.id,
        episode: {
          title: next.title,
          hook: next.hook,
          voiceover: next.voiceover,
          on_screen: next.on_screen,
          recap: next.recap,
          next_hook: next.next_hook,
          confirmed: next.confirmed,
          shots: next.shots,
        },
      }),
    });
    const data = (await res.json()) as Payload & { error?: string };
    if (!res.ok) throw new Error(data.error || "保存失败");
    applyPayload(data);
  }

  async function confirmEpisode(episode: EpisodeView) {
    setError(null);
    try {
      await saveEpisode(episode, { confirmed: true });
      setStatus(
        scenesReady(episode.shots)
          ? `第 ${episode.episode_no} 集已确认，可以出视频`
          : `第 ${episode.episode_no} 集已确认，下一步生成本集场景`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "确认失败");
    }
  }

  async function patchSeries(patch: Record<string, unknown>) {
    if (!series) return;
    setError(null);
    try {
      const res = await fetch(`/api/articles/${articleId}/video-script`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ series: patch }),
      });
      const data = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(data.error || "保存失败");
      applyPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function persistCast(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))].slice(0, 4);
    setCastIds(unique);
    if (!series) return;
    await patchSeries({ cast: unique });
  }

  async function persistCharacterVoice(id: string, next: string) {
    await fetch(`/api/characters/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voice_id: next }),
    }).catch(() => undefined);
    setCharacters((rows) =>
      rows.map((row) => (row.id === id ? { ...row, voice_id: next } : row)),
    );
  }

  async function refreshLibrary() {
    const res = await fetch(`/api/articles/${articleId}/video-script`);
    const data = (await res.json()) as Payload;
    if (res.ok) applyPayload(data);
  }

  async function selectSpeakMode(next: VideoSpeakMode) {
    setSpeakMode(next);
    await patchSeries({ speak_mode: next });
  }

  async function selectNarratorVoice(next: string) {
    setVoiceId(next);
    await patchSeries({ voice_id: next });
  }

  async function generateScenes(
    episode: EpisodeView,
    opts: { force?: boolean; shotIndex?: number } = {},
  ) {
    const force = opts.force === true;
    const shotIndex =
      typeof opts.shotIndex === "number" && opts.shotIndex > 0
        ? opts.shotIndex
        : undefined;
    setSceneId(episode.id);
    setError(null);
    const total = shotIndex ? 1 : episode.shots.length || 1;
    setSceneProgress({
      current: shotIndex || 1,
      total,
      done: 0,
      message: shotIndex
        ? `正在重出第 ${episode.episode_no} 集第 ${shotIndex} 镜…`
        : force
          ? `正在重出第 ${episode.episode_no} 集场景…`
          : `正在生成第 ${episode.episode_no} 集场景…`,
      kind: "scene",
    });
    setStatus(
      shotIndex
        ? `正在重出第 ${episode.episode_no} 集第 ${shotIndex} 镜…`
        : force
          ? `正在重出第 ${episode.episode_no} 集场景…`
          : `正在生成第 ${episode.episode_no} 集场景…`,
    );
    try {
      const res = await fetch(`/api/articles/${articleId}/video-script/scenes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          episodeId: episode.id,
          force: shotIndex ? false : force,
          shotIndex,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "生成场景失败");
      }

      let gotDone = false;
      await readNdjsonEvents(res.body, (event) => {
        if (event.type === "progress") {
          const current = Number(event.index) || 0;
          const all = Number(event.total) || total;
          const doneCount = Number(event.done) || 0;
          const message =
            typeof event.message === "string"
              ? event.message
              : `第 ${current} 镜分镜生成中…`;
          setSceneProgress({
            current,
            total: all,
            done: doneCount,
            message,
            kind: "scene",
          });
          setStatus(`第 ${episode.episode_no} 集 · ${message}`);
          if (event.shot && typeof event.shot === "object") {
            const shot = event.shot as VideoShot;
            setEpisodes((rows) =>
              rows.map((row) =>
                row.id === episode.id
                  ? {
                      ...row,
                      shots: row.shots.map((s) =>
                        s.index === shot.index ? { ...s, ...shot } : s,
                      ),
                    }
                  : row,
              ),
            );
          }
        } else if (event.type === "error") {
          throw new Error(
            typeof event.error === "string" ? event.error : "生成场景失败",
          );
        } else if (event.type === "done") {
          gotDone = true;
          if (Array.isArray(event.shots)) {
            setEpisodes((rows) =>
              rows.map((row) =>
                row.id === episode.id
                  ? { ...row, shots: event.shots as VideoShot[] }
                  : row,
              ),
            );
          }
        }
      });

      if (!gotDone) {
        throw new Error("场景没有全部生成完，请再试一次");
      }
      const reload = await fetch(`/api/articles/${articleId}/video-script`);
      applyPayload((await reload.json()) as Payload);
      setStatus(
        shotIndex
          ? `第 ${episode.episode_no} 集第 ${shotIndex} 镜已重出`
          : `第 ${episode.episode_no} 集场景已就绪，可以出视频`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成场景失败");
    } finally {
      setSceneId(null);
      setSceneProgress(null);
    }
  }

  async function renderEpisode(
    episode: EpisodeView,
    opts: { dubOnly?: boolean; shotIndex?: number; composeOnly?: boolean } = {},
  ) {
    const dubOnly = opts.dubOnly === true;
    const composeOnly = opts.composeOnly === true;
    const shotIndex =
      typeof opts.shotIndex === "number" && opts.shotIndex > 0
        ? opts.shotIndex
        : undefined;
    if (!dubOnly && !episode.confirmed) {
      setError("先确认本集剧本，再生成视频");
      return;
    }
    if (dubOnly && !episode.video_url) {
      setError("还没有成片，先出一版画面再补旁白");
      return;
    }
    if (!dubOnly && composeOnly && !clipsReady(episode.shots)) {
      setError("还有分镜没有出片，先按镜出完再合成");
      return;
    }
    if (!dubOnly && !composeOnly) {
      const pending = shotIndex
        ? episode.shots.filter((s) => s.index === shotIndex)
        : episode.shots.filter((s) => !s.clipUrl?.trim());
      if (pending.some((s) => !s.sceneUrl?.trim())) {
        setError("先生成本集每一镜的场景图，再出视频");
        return;
      }
    }
    setRenderingId(episode.id);
    setError(null);
    const shotTotal = shotIndex
      ? 1
      : episode.shots.filter((s) => composeOnly || !s.clipUrl?.trim()).length ||
        episode.shots.length ||
        1;
    setRenderProgress({
      current: shotIndex || 0,
      total: dubOnly ? 3 : shotTotal,
      done: 0,
      message: dubOnly
        ? `正在给第 ${episode.episode_no} 集补旁白…`
        : composeOnly
          ? `正在合成第 ${episode.episode_no} 集成片…`
          : shotIndex
            ? `第 ${shotIndex} 镜视频生成中…`
            : `视频生成中…`,
      kind: "video",
    });
    setEpisodes((rows) =>
      rows.map((row) =>
        row.id === episode.id ? { ...row, video_status: "generating" } : row,
      ),
    );
    setStatus(
      dubOnly
        ? `正在给第 ${episode.episode_no} 集补旁白，不重出画面…`
        : composeOnly
          ? `正在把第 ${episode.episode_no} 集各镜合成成片…`
          : shotIndex
            ? `第 ${shotIndex} 镜视频生成中…`
            : `视频生成中…`,
    );
    try {
      const res = await fetch(`/api/articles/${articleId}/video-script/render`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          episodeId: episode.id,
          model: composeVideoPresetId(videoModelId, videoResolution),
          speakMode: dubOnly ? "narration" : speakMode,
          voiceId,
          dubOnly,
          composeOnly,
          shotIndex,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || (dubOnly ? "补旁白失败" : "生成视频失败"));
      }
      let gotDone = false;
      let composed = false;
      await readNdjsonEvents(res.body, (event) => {
        if (event.type === "progress") {
          const current = Number(event.index) || 0;
          const all = Number(event.total) || shotTotal;
          const doneCount = Number(event.done) || 0;
          const message =
            typeof event.message === "string"
              ? event.message
              : `第 ${current} 镜视频生成中…`;
          setRenderProgress({
            current,
            total: all,
            done: doneCount,
            message,
            kind: "video",
          });
          setStatus(`第 ${episode.episode_no} 集 · ${message}`);
          if (event.shot && typeof event.shot === "object") {
            const shot = event.shot as VideoShot;
            setEpisodes((rows) =>
              rows.map((row) =>
                row.id === episode.id
                  ? {
                      ...row,
                      shots: row.shots.map((s) =>
                        s.index === shot.index ? { ...s, ...shot } : s,
                      ),
                    }
                  : row,
              ),
            );
          }
        } else if (event.type === "error") {
          throw new Error(
            typeof event.error === "string"
              ? event.error
              : dubOnly
                ? "补旁白失败"
                : "生成视频失败",
          );
        } else if (event.type === "done") {
          gotDone = true;
          composed = event.composed === true;
          if (Array.isArray(event.shots)) {
            setEpisodes((rows) =>
              rows.map((row) =>
                row.id === episode.id
                  ? { ...row, shots: event.shots as VideoShot[] }
                  : row,
              ),
            );
          }
        }
      });
      if (!gotDone) {
        throw new Error(dubOnly ? "旁白没有补完，请再试一次" : "视频没有出完，请再试一次");
      }
      const reload = await fetch(`/api/articles/${articleId}/video-script`);
      applyPayload((await reload.json()) as Payload);
      setStatus(
        dubOnly
          ? `第 ${episode.episode_no} 集旁白已补上`
          : composed
            ? `第 ${episode.episode_no} 集成片已合成`
            : shotIndex
              ? `第 ${episode.episode_no} 集第 ${shotIndex} 镜视频已出`
              : `第 ${episode.episode_no} 集分镜视频已保存，出齐后再合成`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成视频失败";
      setError(message);
      setEpisodes((rows) =>
        rows.map((row) =>
          row.id === episode.id
            ? { ...row, video_status: "failed", video_error: message }
            : row,
        ),
      );
      try {
        const reload = await fetch(`/api/articles/${articleId}/video-script`);
        if (reload.ok) applyPayload((await reload.json()) as Payload);
      } catch {
        // keep local error
      }
    } finally {
      setRenderingId(null);
      setRenderProgress(null);
    }
  }

  return (
    <div id="video-script" className="card scroll-mt-24 space-y-3 p-5">
      <div>
        <h2 className="text-lg font-medium">短视频剧本</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          先出每镜场景图，再按分镜出视频，最后合成一集。某一镜不合格就重出那一镜。
          {videoReady ? "" : " 出片要先在提及检测填方舟 API Key。"}
        </p>
      </div>
      <div className="script-toolbar">
        <input
          className="field script-toolbar__name"
          value={seriesName}
          placeholder="剧本名"
          disabled={busy}
          onChange={(e) => setSeriesName(e.target.value.slice(0, 16))}
        />
        <div className="script-toolbar__cluster">
          <select
            className="field"
            value={speakMode}
            disabled={busy}
            title="说话方式"
            onChange={(e) =>
              void selectSpeakMode(e.target.value as VideoSpeakMode)
            }
          >
            <option value="narration">独白旁白</option>
            <option value="dialogue">角色开口</option>
          </select>
          <label className="script-toolbar__voice" title="画外音用这条音色，角色开口跟各自角色走">
            <span>旁白</span>
            <VoiceSelect
              value={voiceId}
              voices={voices}
              disabled={busy}
              title="旁白音色"
              onChange={(next) => void selectNarratorVoice(next)}
            />
          </label>
          <VoicePreviewButton voiceId={voiceId} disabled={busy} />
        </div>
        <div className="script-toolbar__cluster">
          <select
            className="field"
            value={videoModelId}
            disabled={busy}
            title={
              (videoModels.find((m) => m.id === videoModelId) || DEFAULT_VIDEO_MODELS[0])
                .hint
            }
            onChange={(e) => {
              const next = e.target.value;
              setVideoModelId(next);
              const picked =
                videoModels.find((m) => m.id === next) || DEFAULT_VIDEO_MODELS[0];
              const allowed = picked.resolutions?.length
                ? picked.resolutions
                : (["480p", "720p"] as VideoResolution[]);
              if (!allowed.includes(videoResolution)) {
                setVideoResolution(allowed[0]);
              }
            }}
          >
            {(videoModels.length ? videoModels : DEFAULT_VIDEO_MODELS).map((m) => (
              <option key={m.id} value={m.id} title={m.hint}>
                {m.label}
              </option>
            ))}
          </select>
          <select
            className="field script-toolbar__res"
            value={videoResolution}
            disabled={busy}
            title="清晰度"
            onChange={(e) =>
              setVideoResolution(e.target.value as VideoResolution)
            }
          >
            {(
              (
                videoModels.find((m) => m.id === videoModelId) ||
                DEFAULT_VIDEO_MODELS[0]
              ).resolutions || (["480p", "720p"] as VideoResolution[])
            ).map((res) => (
              <option key={res} value={res}>
                {res === "720p" ? "720" : "480"}
              </option>
            ))}
          </select>
        </div>
        <div className="script-toolbar__cluster">
          <select
            className="field"
            value={hookStyle}
            disabled={busy}
            title={
              VIDEO_SCRIPT_HOOK_STYLES.find((s) => s.id === hookStyle)?.hint ||
              "剧本类型"
            }
            onChange={(e) =>
              setHookStyle(normalizeHookStyle(e.target.value))
            }
          >
            {VIDEO_SCRIPT_HOOK_STYLES.map((s) => (
              <option key={s.id} value={s.id} title={s.hint}>
                {s.label}
              </option>
            ))}
          </select>
          <label className="script-toolbar__count">
            <span>集数</span>
            <select
              className="field"
              value={count}
              disabled={busy}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 6, 8, 10, 12].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          className="btn btn-ghost text-xs"
          disabled={busy}
          onClick={() => void generate()}
        >
          {busy
            ? "写剧本中…"
            : series
              ? count === 1
                ? "重写 1 集"
                : "重新拆剧本"
              : count === 1
                ? "生成 1 集剧本"
                : "拆成短视频剧本"}
        </button>
      </div>

      <VideoCharacterPanel
        articleId={articleId}
        library={characters}
        cast={castIds
          .map((id) => characters.find((c) => c.id === id))
          .filter((c): c is CharacterOption => Boolean(c))}
        voices={voices}
        disabled={busy}
        hasScript={Boolean(series)}
        onCastChange={persistCast}
        onVoiceChange={persistCharacterVoice}
        onLibraryRefresh={refreshLibrary}
      />
      {characters.length === 0 && (
        <p className="text-xs text-[var(--muted)]">
          还没有角色。先去{" "}
          <a className="underline" href="/characters">
            角色库
          </a>{" "}
          上传，或写出剧本后点「按剧本识别角色」。
        </p>
      )}

      {!rewritingId && error && (
        <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
      )}
      {!rewritingId && (status || modelName) && !error && (
        <p className="mt-3 text-sm text-[var(--muted)]">
          {status}
          {modelName ? ` · ${modelName}` : ""}
        </p>
      )}
      {busy && !rewritingId && <ProcessView />}

      {series && (
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[var(--muted)]">剧本名</span>
            <input
              className="field max-w-xs py-1"
              value={seriesName}
              placeholder="给这套剧本起个名字"
              onChange={(e) => setSeriesName(e.target.value.slice(0, 16))}
              onBlur={() => {
                const next = seriesName.trim();
                if (!next || next === series.title) return;
                void fetch(`/api/articles/${articleId}/video-script`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ series: { title: next } }),
                })
                  .then((res) => res.json())
                  .then((data: Payload) => applyPayload(data))
                  .catch(() => undefined);
              }}
            />
            <span className="text-xs text-[var(--muted)]">
              {genreLabel(series)} · {episodes.length} 集 ·{" "}
              {speakMode === "dialogue" ? "角色开口" : "独白旁白"}
            </span>
          </div>
          {series.logline && (
            <p className="text-[var(--muted)]">{series.logline}</p>
          )}
        </div>
      )}

      {episodes.length > 0 && (
        <ul className="mt-3 space-y-2">
          {episodes.map((ep) => {
            const open = openId === ep.id;
            return (
              <li
                key={ep.id}
                className="rounded-lg border border-[var(--line)] bg-white"
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                  onClick={() => {
                    if (rewritingId === ep.id) return;
                    setOpenId(open ? null : ep.id);
                  }}
                >
                  <span>
                    第 {ep.episode_no} 集 · {ep.title || "未命名"}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {ep.confirmed ? "已确认" : "待确认"}
                    {ep.video_url
                      ? ep.video_status === "generating" || renderingId === ep.id
                        ? " · 上一版可看"
                        : " · 已出片"
                      : ""}
                    {ep.video_status === "failed" ? " · 出片失败" : ""}
                  </span>
                </button>
                {open && (
                  <div className="space-y-2 border-t border-[var(--line)] px-3 py-3">
                    {rewritingId === ep.id && (
                      <div className="space-y-2">
                        {error && (
                          <p className="text-sm text-[var(--danger)]">{error}</p>
                        )}
                        {(status || modelName) && !error && (
                          <p className="text-sm text-[var(--muted)]">
                            {status}
                            {modelName ? ` · ${modelName}` : ""}
                          </p>
                        )}
                        {busy && <ProcessView />}
                      </div>
                    )}
                    {rewritingId === ep.id ? null : (
                    <>
                    <input
                      className="field"
                      value={ep.title}
                      placeholder="本集标题"
                      onChange={(e) =>
                        setEpisodes((rows) =>
                          rows.map((row) =>
                            row.id === ep.id
                              ? { ...row, title: e.target.value }
                              : row,
                          ),
                        )
                      }
                      onBlur={(e) =>
                        void saveEpisode({ ...ep, title: e.target.value })
                      }
                    />
                    <input
                      className="field"
                      value={ep.hook}
                      placeholder="前 3 秒钩子"
                      onChange={(e) =>
                        setEpisodes((rows) =>
                          rows.map((row) =>
                            row.id === ep.id
                              ? { ...row, hook: e.target.value }
                              : row,
                          ),
                        )
                      }
                      onBlur={(e) =>
                        void saveEpisode({ ...ep, hook: e.target.value })
                      }
                    />
                    <textarea
                      className="field min-h-28"
                      value={ep.voiceover}
                      placeholder={
                        speakMode === "dialogue"
                          ? "角色对着镜头说的原话（约 90 秒）"
                          : "独白旁白（约 90 秒 / 220–280 字）"
                      }
                      onChange={(e) =>
                        setEpisodes((rows) =>
                          rows.map((row) =>
                            row.id === ep.id
                              ? { ...row, voiceover: e.target.value }
                              : row,
                          ),
                        )
                      }
                      onBlur={(e) =>
                        void saveEpisode({ ...ep, voiceover: e.target.value })
                      }
                    />
                    <input
                      className="field"
                      value={
                        ep.on_screen ||
                        ep.shots.map((s) => s.onScreen).find(Boolean) ||
                        ""
                      }
                      placeholder="主出字，屏幕上的大字"
                      onChange={(e) =>
                        setEpisodes((rows) =>
                          rows.map((row) =>
                            row.id === ep.id
                              ? { ...row, on_screen: e.target.value }
                              : row,
                          ),
                        )
                      }
                      onBlur={(e) =>
                        void saveEpisode({ ...ep, on_screen: e.target.value })
                      }
                    />
                    <input
                      className="field"
                      value={ep.next_hook}
                      placeholder="下集预告"
                      onChange={(e) =>
                        setEpisodes((rows) =>
                          rows.map((row) =>
                            row.id === ep.id
                              ? { ...row, next_hook: e.target.value }
                              : row,
                          ),
                        )
                      }
                      onBlur={(e) =>
                        void saveEpisode({ ...ep, next_hook: e.target.value })
                      }
                    />
                    {ep.shots.length > 0 && (
                      <SceneShotBoard
                        shots={ep.shots}
                        speakers={[
                          { id: NARRATOR_SPEAKER_ID, name: "旁白" },
                          ...castIds
                            .map((id) => characters.find((c) => c.id === id))
                            .filter((c): c is CharacterOption => Boolean(c))
                            .map((c) => ({
                              id: c.id,
                              name: c.name || "未命名角色",
                            })),
                        ]}
                        speakMode={speakMode}
                        progress={
                          sceneId === ep.id
                            ? sceneProgress
                            : renderingId === ep.id
                              ? renderProgress
                              : null
                        }
                        regenDisabled={
                          sceneId === ep.id || renderingId === ep.id
                        }
                        onSpeakerChange={(shot, speakerId) => {
                          const person = characters.find((c) => c.id === speakerId);
                          const nextShots = ep.shots.map((row) =>
                            row.index === shot.index
                              ? {
                                  ...row,
                                  speakerId,
                                  speaker:
                                    speakerId === NARRATOR_SPEAKER_ID
                                      ? "旁白"
                                      : person?.name || "旁白",
                                }
                              : row,
                          );
                          void saveEpisode({ ...ep, shots: nextShots });
                        }}
                        onRegenShot={(shot) =>
                          void generateScenes(ep, { shotIndex: shot.index })
                        }
                        onRegenClip={(shot) =>
                          void renderEpisode(ep, { shotIndex: shot.index })
                        }
                      />
                    )}
                    {ep.video_url && (
                      <EpisodeVideoPlayer
                        src={ep.video_url}
                        compact
                        regenerating={
                          ep.video_status === "generating" ||
                          renderingId === ep.id
                        }
                        title={
                          renderingId === ep.id && renderProgress
                            ? renderProgress.message
                            : ep.video_status === "generating" ||
                                renderingId === ep.id
                              ? "上一版，正在重出"
                              : "本集成片"
                        }
                      />
                    )}
                    {ep.video_error && (
                      <p className="text-xs text-[var(--danger)]">
                        {ep.video_error}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        disabled={busy}
                        onClick={() => void generate(ep.id)}
                      >
                        重写本集
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        disabled={ep.confirmed}
                        onClick={() => void confirmEpisode(ep)}
                      >
                        {ep.confirmed ? "已确认" : "确认本集没问题"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        disabled={
                          sceneId === ep.id ||
                          renderingId === ep.id ||
                          ep.shots.length === 0
                        }
                        onClick={() =>
                          void generateScenes(ep, {
                            force: scenesReady(ep.shots),
                          })
                        }
                      >
                        {sceneId === ep.id
                          ? sceneProgress
                            ? `出场景 ${sceneProgress.done}/${sceneProgress.total}`
                            : "出场景中…"
                          : scenesReady(ep.shots)
                            ? "重出本集场景"
                            : "生成本集场景"}
                      </button>
                      {ep.video_url && (
                        <button
                          type="button"
                          className="btn btn-ghost text-xs"
                          disabled={renderingId === ep.id || sceneId === ep.id}
                          onClick={() => void renderEpisode(ep, { dubOnly: true })}
                        >
                          {renderingId === ep.id
                            ? renderProgress
                              ? renderProgress.message
                              : "配音中…"
                            : "补旁白"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-primary text-xs"
                        disabled={
                          !ep.confirmed ||
                          renderingId === ep.id ||
                          sceneId === ep.id ||
                          !videoReady ||
                          (clipsReady(ep.shots)
                            ? false
                            : !pendingClipScenesReady(ep.shots))
                        }
                        onClick={() =>
                          void renderEpisode(ep, {
                            composeOnly: clipsReady(ep.shots),
                          })
                        }
                      >
                        {renderingId === ep.id
                          ? renderProgress
                            ? `${clipsReady(ep.shots) ? "合成" : "出片"} ${renderProgress.done}/${renderProgress.total}`
                            : "出片中…"
                          : clipsReady(ep.shots)
                            ? ep.video_url
                              ? "重新合成成片"
                              : "合成成片"
                            : ep.shots.some((s) => s.clipUrl)
                              ? `继续出片 ${ep.shots.filter((s) => s.clipUrl).length}/${ep.shots.length}`
                              : "按分镜出片"}
                      </button>
                    </div>
                    </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
