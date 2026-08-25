"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ArticleVideoSeries,
  ScriptProp,
  VideoCharacterAngle,
  VideoCharacterPhoto,
  VideoScriptHookStyle,
  VideoShot,
  VideoSpeakMode,
} from "@/lib/types";
import {
  DEFAULT_SPEAK_MODE,
  normalizeSpeakMode,
  resolveInnerVoice,
  resolveVoicePath,
  shotCanLipSync,
  shotFramesApproved,
  shotHasKeyframes,
  speakShotsMissingLock,
  type InnerVoiceLevel,
  type VideoVoicePath,
} from "@/lib/types";
import {
  DEFAULT_EPISODE_DURATION,
  EPISODE_DURATION_OPTIONS,
  MAX_EPISODE_COUNT,
  MAX_SERIES_CAST,
  PREMISE_MAX,
  VIDEO_SCRIPT_STYLE_GROUPS,
  VIDEO_SCRIPT_STYLE_OPTIONS,
  clampEpisodeCount,
  durationBudget,
  hookStyleLabel,
  hookStyleMeta,
  defaultRenderVoicePath,
  isShowStyle,
  normalizeHookStyle,
  textHasShowEngine,
} from "@/lib/ai/video-script-styles";
import {
  leftoverImportedEpisodes,
  resolveScriptSourceKind,
} from "@/lib/ai/script-import";
import { removeShot, voiceoverFromShots } from "@/lib/ai/shot-edit";
import { dirtyStillsKeepSpeech, keepLocalShotMedia, platesEqual } from "@/lib/ai/shot-plate";
import { FILM_STEPS, inferFilmStep } from "@/lib/ai/shot-qa";
import { normalizeLookStyle, type LookStyleId } from "@/lib/ai/look-styles";
import { LookStyleSelect } from "@/components/LookStyleSelect";
import { ModelPicker } from "@/components/ModelPicker";
import { VideoMusicPanel } from "@/components/VideoMusicPanel";
import type { AiModelBadge } from "@/lib/ai/model-catalog/types";
import {
  looksLikeManualScriptTitle,
  pickScriptTitle,
} from "@/lib/ai/script-title";
import {
  formatCastLine,
  resolveStanceCards,
  stanceCardsNeedRewrite,
} from "@/lib/ai/stance-card";
import { SceneShotBoard } from "@/components/SceneShotBoard";
import { FilmCaptionEditor } from "@/components/FilmCaptionEditor";
import { VideoCharacterPanel } from "@/components/VideoCharacterPanel";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import { SearchSelect } from "@/components/SearchSelect";
import { VoiceSelect } from "@/components/VoiceSelect";
import { QuotaHint, QuotaMessage } from "@/components/QuotaHint";
import { isQuotaMessage, parseQuotaError, useQuota } from "@/components/useQuota";
import { quotaRechargeText } from "@/lib/billing/copy";
import { remainingWithMeter } from "@/lib/billing/meters";
import {
  IMAGE_GEN_MODELS,
  readStoredImageModel,
  writeStoredImageModel,
  type ImageGenModelOption,
} from "@/lib/ai/image-gen-models-shared";
import {
  DEFAULT_NARRATOR_VOICE,
  NARRATOR_SPEAKER_ID,
  lockEpisodeVoices,
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
  source_video_url?: string | null;
  subtitle_url: string | null;
  caption_style_json?: string;
  caption_cues_json?: string;
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
  maxSec?: number;
  open?: "open" | "closed" | "unknown";
  badges?: AiModelBadge[];
};

const DEFAULT_VIDEO_MODELS: VideoModelOption[] = [
  {
    id: "seedance-2-mini",
    label: "Seedance-2.0-mini",
    hint: "模型直接出声。口型不准再点对口型",
    generateAudio: true,
    resolutions: ["480p", "720p"],
    badges: ["recommended"],
  },
  {
    id: "seedance-2-fast",
    label: "Seedance-2.0-fast",
    hint: "比 mini 更清，须先开通",
    generateAudio: true,
    resolutions: ["480p", "720p"],
  },
  {
    id: "seedance-2-0",
    label: "Seedance-2.0",
    hint: "标准档，画质比 mini/fast 稳，须先开通",
    generateAudio: true,
    resolutions: ["480p", "720p"],
  },
  {
    id: "seedance-2-5",
    label: "Seedance-2.5",
    hint: "指令更稳，叙事更长，须先开通",
    generateAudio: true,
    resolutions: ["480p", "720p"],
  },
];

function composeVideoPresetId(modelId: string, resolution: VideoResolution): string {
  return `${modelId}-${resolution === "720p" ? "720" : "480"}`;
}

const AUTO_LIPSYNC_KEY = "dwgeo-auto-lipsync";
const BED_MUSIC_KEY = "dwgeo-bed-music";

function countStorageKey(articleId: string) {
  return `dwgeo-episode-count:${articleId}`;
}

function readStoredCount(articleId: string): number | null {
  try {
    const raw = localStorage.getItem(countStorageKey(articleId));
    if (!raw) return null;
    return clampEpisodeCount(raw);
  } catch {
    return null;
  }
}

function writeStoredCount(articleId: string, n: number) {
  try {
    localStorage.setItem(countStorageKey(articleId), String(n));
  } catch {
    // ignore quota / private mode
  }
}

function durationStorageKey(articleId: string) {
  return `dwgeo-episode-duration:${articleId}`;
}

function readStoredDuration(articleId: string): 15 | 90 | null {
  try {
    const raw = localStorage.getItem(durationStorageKey(articleId));
    if (raw == null) return null;
    return Number(raw) === 15 ? 15 : Number(raw) === 90 ? 90 : null;
  } catch {
    return null;
  }
}

function writeStoredDuration(articleId: string, n: 15 | 90) {
  try {
    localStorage.setItem(durationStorageKey(articleId), String(n));
  } catch {
    // ignore quota / private mode
  }
}

function scriptModelStorageKey(articleId: string) {
  return `dwgeo-script-llm:${articleId}`;
}

function readStoredScriptModel(articleId: string): string | null {
  try {
    return localStorage.getItem(scriptModelStorageKey(articleId));
  } catch {
    return null;
  }
}

function writeStoredScriptModel(articleId: string, id: string) {
  try {
    localStorage.setItem(scriptModelStorageKey(articleId), id);
  } catch {
    // ignore quota / private mode
  }
}

function shotModelStorageKey(articleId: string) {
  return `dwgeo-shot-llm:${articleId}`;
}

function readStoredShotModel(articleId: string): string | null {
  try {
    return localStorage.getItem(shotModelStorageKey(articleId));
  } catch {
    return null;
  }
}

function writeStoredShotModel(articleId: string, id: string) {
  try {
    localStorage.setItem(shotModelStorageKey(articleId), id);
  } catch {
    // ignore quota / private mode
  }
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

type ScriptModelOption = {
  id: string;
  provider: "deepseek" | "openai" | "anthropic" | "proxy";
  label: string;
  hint: string;
  cost: string;
  ready: boolean;
  badges?: AiModelBadge[];
};

type Payload = {
  series: ArticleVideoSeries | null;
  episodes: EpisodeView[];
  videoReady: boolean;
  videoModels?: VideoModelOption[];
  imageModels?: ImageGenModelOption[];
  scriptModels?: ScriptModelOption[];
  voices?: VoiceOption[];
  characters?: CharacterOption[];
  cast?: CharacterOption[];
  props?: ScriptProp[];
  suggestedName?: string;
  castNotice?: {
    needed?: string[];
    added?: string[];
    reused?: string[];
    pendingLooks?: string[];
    message?: string;
  };
};

type Props = {
  articleId: string;
  title: string;
  bodyHtml: string;
  scriptTitle?: string;
  sourceKind?: "article" | "script";
  autoGenerate?: boolean;
  forceGenerate?: boolean;
  initialEpisodeCount?: number;
  initialHasSequel?: boolean;
  onScriptTitleChange?: (name: string) => void;
};

function genreLabel(series: Pick<ArticleVideoSeries, "genre" | "hook_style">): string {
  return hookStyleLabel(series.hook_style || series.genre);
}

function scenesReady(shots: VideoShot[]): boolean {
  return shots.length > 0 && shots.every((s) => shotHasKeyframes(s));
}

function clipsReady(shots: VideoShot[]): boolean {
  return shots.length > 0 && shots.every((s) => Boolean(s.clipUrl?.trim()));
}

function pendingClipScenesReady(shots: VideoShot[]): boolean {
  const pending = shots.filter((s) => !s.clipUrl?.trim());
  return pending.length === 0 || pending.every((s) => shotHasKeyframes(s));
}

function pendingClipFramesApproved(shots: VideoShot[]): boolean {
  const pending = shots.filter((s) => !s.clipUrl?.trim());
  return pending.length === 0 || pending.every((s) => shotFramesApproved(s));
}

function pendingRenderSeconds(shots: VideoShot[], shotIndex?: number): number {
  const picked =
    typeof shotIndex === "number" && shotIndex > 0
      ? shots.filter((shot) => shot.index === shotIndex)
      : shots.filter((shot) => !shot.clipUrl?.trim());
  return picked.reduce(
    (sum, shot) => sum + Math.max(1, Math.round(Number(shot.seconds) || 0)),
    0,
  );
}

const WORK_STEPS = [
  { id: "think", label: "想钩子和节奏" },
  { id: "stance", label: "锁人设" },
  { id: "write", label: "写剧本" },
  { id: "review", label: "审稿" },
  { id: "shots", label: "分镜导演" },
  { id: "cast", label: "识别角色" },
  { id: "looks", label: "生成角色外形" },
] as const;

type WorkStepId = (typeof WORK_STEPS)[number]["id"];

function workStepIndex(id: WorkStepId): number {
  return WORK_STEPS.findIndex((step) => step.id === id);
}

function inferWorkStep(message: string): WorkStepId | null {
  if (/已有角色图|不再生成外形/.test(message)) return "cast";
  if (/正在按设定生成外形|正在生成正面|侧前|侧面|背面|还需要「|挂到各镜/.test(message)) {
    return "looks";
  }
  if (/认角色|认出了|从角色库挂上/.test(message)) return "cast";
  if (/分镜导演|分镜已排|分镜已切|重排分镜/.test(message)) return "shots";
  if (/审稿|立场写反|核立场|共鸣|反应镜/.test(message)) return "review";
  if (/人设/.test(message)) return "stance";
  if (/补第|重写|写剧本|正在写|正在拆|落剧本|JSON/.test(message)) {
    return "write";
  }
  if (/还在想|思考|钩子和节奏/.test(message)) return "think";
  return null;
}

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
        // skip broken line
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

export function VideoScriptPanel({
  articleId,
  title,
  bodyHtml,
  scriptTitle,
  sourceKind,
  autoGenerate,
  forceGenerate,
  initialEpisodeCount,
  initialHasSequel,
  onScriptTitleChange,
}: Props) {
  const [hookStyle, setHookStyle] = useState<VideoScriptHookStyle>("talk");
  const [lookStyle, setLookStyle] = useState<LookStyleId>("semi");
  const [booted, setBooted] = useState(false);
  const autoTried = useRef(false);
  const sequelAuto = useRef(false);
  const episodeWorkRef = useRef<string | null>(null);
  const [count, setCount] = useState(() =>
    clampEpisodeCount(initialEpisodeCount || 1),
  );
  const [hasSequel, setHasSequel] = useState(initialHasSequel === true);
  const [durationSec, setDurationSec] = useState(DEFAULT_EPISODE_DURATION);
  const [durationTouched, setDurationTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renderingId, setRenderingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [workStep, setWorkStep] = useState<WorkStepId>("think");
  const [workLog, setWorkLog] = useState<string[]>([]);
  const [modelName, setModelName] = useState("");
  const [series, setSeries] = useState<ArticleVideoSeries | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeView[]>([]);
  const [videoReady, setVideoReady] = useState(false);
  const [rewritingId, setRewritingId] = useState<string | null>(null);
  const [videoModels, setVideoModels] = useState<VideoModelOption[]>(
    DEFAULT_VIDEO_MODELS,
  );
  const [videoModelId, setVideoModelId] = useState("seedance-2-mini");
  const [videoResolution, setVideoResolution] = useState<VideoResolution>("480p");
  const [imageModels, setImageModels] = useState<ImageGenModelOption[]>(
    IMAGE_GEN_MODELS,
  );
  const [imageModelId, setImageModelId] = useState(readStoredImageModel);
  const [scriptModels, setScriptModels] = useState<ScriptModelOption[]>([]);
  const [scriptModelId, setScriptModelId] = useState("deepseek-reasoner");
  const [shotModelId, setShotModelId] = useState("deepseek-reasoner");
  const [seriesName, setSeriesName] = useState("");
  const [premise, setPremise] = useState("");
  const premiseFilled = useRef(false);
  const stanceFilled = useRef(false);
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [castIds, setCastIds] = useState<string[]>([]);
  const [castNotice, setCastNotice] = useState("");
  const [scriptProps, setScriptProps] = useState<ScriptProp[]>([]);
  const [speakMode, setSpeakMode] = useState<VideoSpeakMode>(DEFAULT_SPEAK_MODE);
  const [innerVoice, setInnerVoice] = useState<InnerVoiceLevel>("off");
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState(DEFAULT_NARRATOR_VOICE);
  const [editCaptionsId, setEditCaptionsId] = useState<string | null>(null);
  const [copyBusy, setCopyBusy] = useState<{
    id: string;
    index: number;
    intent: "visual" | "emotion";
  } | null>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [sceneProgress, setSceneProgress] = useState<{
    current: number;
    total: number;
    done: number;
    message: string;
    kind?: "scene" | "speech" | "video";
  } | null>(null);
  const [renderProgress, setRenderProgress] = useState<{
    current: number;
    total: number;
    done: number;
    message: string;
    kind?: "scene" | "video";
  } | null>(null);
  const [autoLipSync, setAutoLipSync] = useState(false);
  const [bedMusic, setBedMusic] = useState(false);
  const { view: quotaView, snap: quotaSnap, refresh: refreshQuota } = useQuota();
  const videoQuota = quotaSnap("videoSeconds");
  const videoLeft = remainingWithMeter(
    quotaView,
    "videoSeconds",
    composeVideoPresetId(videoModelId, videoResolution),
  );
  const videoBlocked = videoLeft === 0;
  const nextClipSeconds = episodes.reduce(
    (max, ep) => Math.max(max, pendingRenderSeconds(ep.shots)),
    0,
  );

  function applyPayload(data: Payload) {
    setSeries(data.series);
    setEpisodes(data.episodes || []);
    if (Array.isArray(data.props)) setScriptProps(data.props);
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
    const nextImageModels = data.imageModels;
    if (nextImageModels?.length) {
      setImageModels(nextImageModels);
      setImageModelId((cur) => {
        const pick = readStoredImageModel() || cur;
        return nextImageModels.some((m) => m.id === pick)
          ? pick
          : nextImageModels[0].id;
      });
    }
    if (data.scriptModels?.length) {
      setScriptModels(data.scriptModels);
      const pickReady = (stored: string | null, cur: string) => {
        const pick = stored || cur;
        const ready = data.scriptModels?.find((m) => m.id === pick && m.ready);
        if (ready) return ready.id;
        return (
          data.scriptModels?.find((m) => m.ready)?.id ||
          data.scriptModels?.[0]?.id ||
          "deepseek-reasoner"
        );
      };
      setScriptModelId((cur) => pickReady(readStoredScriptModel(articleId), cur));
      setShotModelId((cur) => pickReady(readStoredShotModel(articleId), cur));
    }
    if (data.characters) {
      setCharacters(data.characters.map((row) => ({ ...row })));
    }
    const nextCastIds = Array.isArray(data.cast)
      ? data.cast.map((c) => c.id)
      : data.series?.character_id
        ? [data.series.character_id]
        : [];
    if (data.series) setCastIds(nextCastIds);
    if (!durationTouched) {
      const fromSeries =
        data.series?.duration_sec === 15 || data.series?.duration_sec === 90
          ? data.series.duration_sec
          : null;
      const fromStore = readStoredDuration(articleId);
      const fromEpisode = data.episodes?.[0]?.duration_sec
        ? durationBudget(data.episodes[0].duration_sec)
        : null;
      const next = fromSeries || fromStore || fromEpisode;
      if (next) {
        setDurationSec(next);
        writeStoredDuration(articleId, next);
      }
    }
    const nextVoices = data.voices;
    if (nextVoices?.length) setVoices(nextVoices);
    if (data.series) {
      const planned = Number(data.series.episode_count) || 0;
      const imported =
        forceGenerate && initialEpisodeCount
          ? clampEpisodeCount(initialEpisodeCount)
          : 0;
      const nextCount = clampEpisodeCount(
        imported || planned || data.episodes?.length || 1,
      );
      setCount(nextCount);
      writeStoredCount(articleId, nextCount);
      setHookStyle(normalizeHookStyle(data.series.hook_style || data.series.genre));
      setLookStyle(normalizeLookStyle(data.series.look_style));
      const nextName = pickScriptTitle(
        data.series.title,
        data.suggestedName,
        scriptTitle,
      );
      if (nextName) {
        setSeriesName(nextName);
        onScriptTitleChange?.(nextName);
      } else if (data.series.title) {
        setSeriesName(data.series.title);
      }
      setPremise(data.series.premise || "");
      const nextSpeak = normalizeSpeakMode(data.series.speak_mode);
      setSpeakMode(nextSpeak);
      setInnerVoice(resolveInnerVoice(data.series.inner_voice));
      if (data.series.voice_id) {
        setVoiceId(resolveVoiceId(data.series.voice_id, DEFAULT_NARRATOR_VOICE));
      } else if (nextVoices?.find((v) => v.group === "旁白")) {
        setVoiceId(nextVoices.find((v) => v.group === "旁白")!.id);
      }
    } else {
      setPremise("");
      setSpeakMode(DEFAULT_SPEAK_MODE);
      const stored = readStoredCount(articleId);
      const nextCount = clampEpisodeCount(initialEpisodeCount || stored || 1);
      setCount(nextCount);
      writeStoredCount(articleId, nextCount);
      if (initialHasSequel) setHasSequel(true);
      const nextName = pickScriptTitle(data.suggestedName, scriptTitle);
      if (nextName) {
        setSeriesName((cur) => cur || nextName);
        onScriptTitleChange?.(nextName);
      }
    }
  }

  useEffect(() => {
    try {
      setAutoLipSync(localStorage.getItem(AUTO_LIPSYNC_KEY) === "1");
      setBedMusic(localStorage.getItem(BED_MUSIC_KEY) === "1");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/articles/${articleId}/video-script`);
        const data = (await res.json()) as Payload;
        if (cancelled || !res.ok) return;
        applyPayload(data);
        let latest = data;
        if (
          data.series &&
          (data.episodes?.length || 0) > 0 &&
          !premiseFilled.current &&
          !textHasShowEngine(
            data.series.premise || "",
            data.series.hook_style || data.series.genre,
          )
        ) {
          premiseFilled.current = true;
          const filled = await fetch(`/api/articles/${articleId}/video-script`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ fillPremise: true }),
          });
          const filledData = (await filled.json()) as Payload;
          if (!cancelled && filled.ok) {
            applyPayload(filledData);
            latest = filledData;
          }
        }
        const bootSeries = latest.series;
        const bootCast = latest.cast;
        const bootHook = bootSeries?.hook_style || bootSeries?.genre;
        const bootNames = (bootCast || [])
          .map((row) => row.name?.trim() || "")
          .filter(Boolean);
        if (
          bootSeries &&
          (data.episodes?.length || 0) > 0 &&
          bootNames.length > 0 &&
          !stanceFilled.current &&
          stanceCardsNeedRewrite(
            resolveStanceCards(bootSeries.notes, bootNames, bootHook),
            bootNames,
          )
        ) {
          stanceFilled.current = true;
          const stanceRes = await fetch(`/api/articles/${articleId}/video-script`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ fillStance: true }),
          });
          const stanceData = (await stanceRes.json()) as Payload;
          if (!cancelled && stanceRes.ok) applyPayload(stanceData);
        }
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
      } finally {
        if (!cancelled) setBooted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  useEffect(() => {
    if (!looksLikeManualScriptTitle(seriesName)) return;
    let cancelled = false;
    void fetch(`/api/articles/${articleId}/video-script`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Payload) => {
        if (cancelled || !data.series?.title) return;
        if (looksLikeManualScriptTitle(data.series.title)) return;
        applyPayload(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [articleId, seriesName]);

  function pushWork(message: string) {
    setStatus(message);
    setWorkLog((prev) => {
      if (prev[prev.length - 1] === message) return prev;
      return [...prev.slice(-30), message];
    });
    const next = inferWorkStep(message);
    if (next) {
      setWorkStep((cur) =>
        workStepIndex(next) >= workStepIndex(cur) ? next : cur,
      );
    }
  }

  function ProcessView() {
    if (!busy) return null;
    const order = WORK_STEPS.map((s) => s.id);
    const idx = Math.max(0, order.indexOf(workStep));
    return (
      <div className="space-y-2">
        <div className="mb-1 text-xs text-[var(--muted)]">正在落笔</div>
        <ol className="space-y-1.5 rounded-lg border border-[var(--line)] bg-white/60 p-3 text-sm">
          {WORK_STEPS.map((step, i) => {
            const state = i < idx ? "done" : i === idx ? "run" : "wait";
            return (
              <li
                key={step.id}
                className={
                  state === "wait"
                    ? "text-[var(--muted)]"
                    : state === "run"
                      ? "font-medium"
                      : ""
                }
              >
                <span className={state === "run" ? "script-work-dot" : ""}>
                  {state === "done" ? "✓" : state === "run" ? "●" : "○"}
                </span>{" "}
                {step.label}
                {state === "run" && status ? (
                  <span className="mt-0.5 block pl-4 text-xs font-normal text-[var(--muted)]">
                    {status}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        {workLog.length > 0 && (
          <ul className="max-h-28 overflow-y-auto rounded-lg border border-[var(--line)] bg-white/40 px-3 py-2 text-xs leading-relaxed text-[var(--muted)]">
            {workLog.map((line, i) => (
              <li key={`${i}-${line.slice(0, 16)}`}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  async function generate(
    regenerateEpisodeId?: string,
    appendNext = false,
    appendCount = 1,
    regenerateShots = false,
  ) {
    if (appendNext && !hasSequel) {
      setError("本集已收束。要续写先点「还有后续」。");
      return;
    }
    const nextCount = Math.min(
      MAX_EPISODE_COUNT - episodes.length,
      Math.max(1, Math.round(appendCount) || 1),
    );
    setBusy(true);
    setRewritingId(regenerateEpisodeId || null);
    setError(null);
    setWorkStep("think");
    setModelName("");
    const nextNo = (episodes.at(-1)?.episode_no || 0) + 1;
    const startMsg = regenerateShots
      ? "正在按准稿重排分镜，对白不动…"
      : regenerateEpisodeId
      ? "正在重写本集，先想新的钩子…"
      : appendNext
        ? nextCount > 1
          ? `正在按原作接着写第 ${nextNo} 到 ${nextNo + nextCount - 1} 集…`
          : `正在按第 ${nextNo - 1} 集底本写第 ${nextNo} 集…`
        : count === 1
          ? `正在写 1 集剧本（预算约 ${durationSec} 秒）…`
          : `正在拆 ${count} 集（每集预算约 ${durationSec} 秒）…`;
    setStatus(startMsg);
    setWorkLog([startMsg]);
    try {
      const res = await fetch(`/api/articles/${articleId}/video-script`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          bodyHtml,
          hookStyle,
          lookStyle,
          sourceKind: resolveScriptSourceKind(sourceKind, bodyHtml),
          episodeCount: count,
          durationSec,
          hasSequel,
          seriesName: pickScriptTitle(seriesName, series?.title, scriptTitle),
          cast: castIds,
          speakMode,
          innerVoice,
          voiceId,
          scriptModel: scriptModelId,
          shotModel: shotModelId,
          imageModel: imageModelId,
          regenerateEpisodeId: regenerateShots ? undefined : regenerateEpisodeId,
          episodeId: regenerateShots ? regenerateEpisodeId : undefined,
          regenerateShots,
          appendNext,
          appendCount: nextCount,
          stream: true,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          data.error || (regenerateShots ? "重写分镜失败" : "生成剧本失败"),
        );
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
            pushWork(event.message);
          } else if (event.type === "meta" && typeof event.model === "string") {
            setModelName(event.model);
          } else if (event.type === "thinking") {
            setWorkStep((cur) =>
              cur === "cast" || cur === "looks" || cur === "shots" ? cur : "think",
            );
          } else if (event.type === "content") {
            setWorkStep((cur) =>
              cur === "cast" || cur === "looks" || cur === "shots" ? cur : "write",
            );
          } else if (event.type === "partial") {
            applyPayload(event as unknown as Payload);
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
        throw new Error(
          regenerateShots
            ? "没有收到重排后的分镜，请再试一次"
            : "没有收到完整剧本，请再试一次",
        );
      }
      applyPayload(donePayload);
      const notice = donePayload.castNotice?.message || "";
      setCastNotice(notice);
      setStatus(
        regenerateEpisodeId
          ? notice
            ? `本集已重写。${notice}`
            : "本集已重写，请再确认"
          : appendNext
            ? notice
              ? `第 ${donePayload.episodes.at(-1)?.episode_no || nextNo} 集已续上。${notice}`
              : `第 ${donePayload.episodes.at(-1)?.episode_no || nextNo} 集已续上，先改、确认，再生成分镜`
            : notice
              ? `已写出 ${donePayload.episodes.length} 集。${notice}`
              : `已写出 ${donePayload.episodes.length} 集，先改、确认，再生成分镜`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成剧本失败";
      if (castIds.length && /没从剧本里看出角色/.test(message)) {
        setStatus("剧本已写出。本剧角色都在，没有认出新人");
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
      setRewritingId(null);
    }
  }

  useEffect(() => {
    if (!autoGenerate || autoTried.current || !booted || busy) return;
    if (series && !forceGenerate) return;
    const text = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length < 40) return;
    autoTried.current = true;
    void generate();
  }, [autoGenerate, forceGenerate, booted, busy, series, bodyHtml]);

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
    if (episodeWorkRef.current) return;
    episodeWorkRef.current = episode.id;
    setError(null);
    setSceneId(episode.id);
    setSceneProgress({
      current: 1,
      total: episode.shots.length || 1,
      done: 0,
      message: "正在按对白出声卡秒…",
      kind: "speech",
    });
    setStatus(`第 ${episode.episode_no} 集已确认，正在按对白出声卡秒…`);
    try {
      await saveEpisode(episode, { confirmed: true });
      const res = await fetch(`/api/articles/${articleId}/video-script/speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ episodeId: episode.id }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "按对白卡秒失败");
      }
      await readNdjsonEvents(res.body, (event) => {
        if (event.type === "progress") {
          const message =
            typeof event.message === "string"
              ? event.message
              : "正在按对白出声卡秒…";
          setSceneProgress({
            current: 1,
            total: episode.shots.length || 1,
            done: 0,
            message,
            kind: "speech",
          });
          setStatus(`第 ${episode.episode_no} 集 · ${message}`);
          if (event.shot && typeof event.shot === "object") {
            const shot = event.shot as VideoShot;
            setEpisodes((rows) =>
              rows.map((row) =>
                row.id === episode.id
                  ? {
                      ...row,
                      confirmed: true,
                      shots: row.shots.map((item) =>
                        item.index === shot.index ? shot : item,
                      ),
                    }
                  : row,
              ),
            );
          }
        }
        if (event.type === "done" && Array.isArray(event.shots)) {
          setEpisodes((rows) =>
            rows.map((row) =>
              row.id === episode.id
                ? {
                    ...row,
                    confirmed: true,
                    shots: event.shots as VideoShot[],
                  }
                : row,
            ),
          );
        }
        if (event.type === "error") {
          throw new Error(
            typeof event.error === "string" ? event.error : "按对白卡秒失败",
          );
        }
      });
      setStatus(
        scenesReady(episode.shots)
          ? `第 ${episode.episode_no} 集已按对白卡秒，过片后可以出视频`
          : `第 ${episode.episode_no} 集已按对白卡秒，下一步生成分镜`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "确认失败");
    } finally {
      if (episodeWorkRef.current === episode.id) episodeWorkRef.current = null;
      setSceneId(null);
      setSceneProgress(null);
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
    const unique = [...new Set(ids.filter(Boolean))].slice(0, MAX_SERIES_CAST);
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

  async function refreshLibrary(partial?: {
    characters?: CharacterOption[];
    cast?: CharacterOption[];
  }) {
    if (partial?.characters) setCharacters(partial.characters);
    if (partial?.cast) {
      setCastIds(partial.cast.map((row) => row.id));
    }
    const res = await fetch(`/api/articles/${articleId}/video-script`, {
      cache: "no-store",
    });
    const data = (await res.json()) as Payload;
    if (res.ok) applyPayload(data);
  }

  async function saveSeriesName(next = seriesName) {
    const name = pickScriptTitle(next);
    if (!name) return;
    setSeriesName(name);
    onScriptTitleChange?.(name);
    if (series && name === series.title) return;
    await patchSeries({ title: name });
  }

  async function selectSpeakMode(next: VideoSpeakMode) {
    setSpeakMode(next);
    await patchSeries({ speak_mode: next });
  }

  async function selectInnerVoice(next: InnerVoiceLevel) {
    setInnerVoice(next);
    await patchSeries({ inner_voice: next });
  }

  async function selectNarratorVoice(next: string) {
    setVoiceId(next);
    await patchSeries({ voice_id: next });
  }

  async function generateScenes(
    episode: EpisodeView,
    opts: { force?: boolean; shotIndex?: number; refShotIndex?: number } = {},
  ) {
    const force = opts.force === true;
    const shotIndex =
      typeof opts.shotIndex === "number" && opts.shotIndex > 0
        ? opts.shotIndex
        : undefined;
    const refShotIndex =
      typeof opts.refShotIndex === "number" && opts.refShotIndex > 0
        ? opts.refShotIndex
        : undefined;
    if (!episode.confirmed) {
      setError("先确认本集剧本没问题，再生成分镜");
      return;
    }
    if (episodeWorkRef.current) return;
    episodeWorkRef.current = episode.id;
    const missingSpeech = speakShotsMissingLock(
      shotIndex
        ? episode.shots.filter((shot) => shot.index === shotIndex)
        : episode.shots,
    );
    if (missingSpeech.length > 0) {
      setStatus(
        `第 ${missingSpeech.join("、")} 镜还没锁声，出分镜时会先按对白出声`,
      );
    }
    setSceneId(episode.id);
    setError(null);
    const total = shotIndex ? 1 : episode.shots.length || 1;
    const sceneStart =
      shotIndex && refShotIndex
        ? `正在重出第 ${episode.episode_no} 集第 ${shotIndex} 镜，参考第 ${refShotIndex} 镜…`
        : shotIndex
          ? `正在重出第 ${episode.episode_no} 集第 ${shotIndex} 镜…`
          : force
            ? `正在重出第 ${episode.episode_no} 镜头尾，向前接上一镜…`
            : `正在生成第 ${episode.episode_no} 镜头尾，向前接上一镜…`;
    setSceneProgress({
      current: shotIndex || 1,
      total,
      done: 0,
      message: sceneStart,
      kind: "scene",
    });
    setStatus(sceneStart);
    try {
      const scoped = (shots: VideoShot[]) =>
        shotIndex ? shots.filter((shot) => shot.index === shotIndex) : shots;
      const missingIndexes = (shots: VideoShot[]) =>
        scoped(shots)
          .filter((shot) => !shotHasKeyframes(shot))
          .map((shot) => shot.index);
      let latestShots = episode.shots;
      const targetIndexes = shotIndex
        ? [shotIndex]
        : force
          ? episode.shots.map((shot) => shot.index)
          : missingIndexes(episode.shots);
      let remaining = [...targetIndexes];
      const maxPasses = Math.max(targetIndexes.length * 2 + 2, shotIndex ? 2 : 6);
      let lastPassError = "";
      for (let pass = 0; pass < maxPasses; pass += 1) {
        const holes =
          (force || shotIndex) && remaining.length > 0
            ? remaining
            : missingIndexes(latestShots);
        if (holes.length === 0) break;
        if (pass > 0) {
          const resume = `还有第 ${holes.join("、")} 镜头尾没出完，接着出…`;
          setSceneProgress({
            current: holes[0] || 1,
            total: holes.length || total,
            done: 0,
            message: resume,
            kind: "scene",
          });
          setStatus(`第 ${episode.episode_no} 集 · ${resume}`);
        }
        const touched = new Set<number>();
        const res = await fetch(`/api/articles/${articleId}/video-script/scenes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            episodeId: episode.id,
            force: pass === 0 ? (shotIndex ? false : force) : false,
            resume: pass > 0,
            fillMissing: !force && !shotIndex,
            shotIndex: pass === 0 ? shotIndex : undefined,
            shotIndexes: holes,
            refShotIndex: pass === 0 ? refShotIndex : undefined,
            imageModel: imageModelId,
            model: composeVideoPresetId(videoModelId, videoResolution),
          }),
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "生成场景失败");
        }

        await readNdjsonEvents(res.body, (event) => {
          if (event.type === "progress") {
            const current = Number(event.index) || 0;
            const all = Number(event.total) || total;
            const doneCount = Number(event.done) || 0;
            const message =
              typeof event.message === "string"
                ? event.message
                : `第 ${current} 镜分镜生成中…`;
            const skipAhead =
              /这次先停|下次接着出/.test(message) && !/已落下/.test(message);
            setSceneProgress((prev) => ({
              current: skipAhead
                ? prev?.current || current || 1
                : current || prev?.current || 1,
              total: all,
              done: skipAhead ? (prev?.done ?? doneCount) : doneCount,
              message:
                skipAhead && prev?.message ? prev.message : message,
              kind: "scene",
            }));
            if (!skipAhead) {
              setStatus(`第 ${episode.episode_no} 集 · ${message}`);
            }
            if (event.shot && typeof event.shot === "object") {
              const shot = event.shot as VideoShot;
              touched.add(shot.index);
              latestShots = latestShots.map((s) =>
                s.index === shot.index ? { ...s, ...shot } : s,
              );
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
            lastPassError =
              typeof event.error === "string" ? event.error : "生成场景失败";
          } else if (event.type === "done") {
            if (Array.isArray(event.shots)) {
              latestShots = keepLocalShotMedia(
                latestShots,
                event.shots as VideoShot[],
              );
              setEpisodes((rows) =>
                rows.map((row) =>
                  row.id === episode.id
                    ? { ...row, shots: latestShots }
                    : row,
                ),
              );
            }
          }
        });

        const reload = await fetch(`/api/articles/${articleId}/video-script`);
        const payload = (await reload.json()) as Payload;
        const fromServer = payload.episodes?.find((row) => row.id === episode.id);
        if (fromServer?.shots?.length) {
          latestShots = keepLocalShotMedia(latestShots, fromServer.shots);
          payload.episodes = payload.episodes.map((row) =>
            row.id === episode.id ? { ...row, shots: latestShots } : row,
          );
        }
        applyPayload(payload);
        if (force && !shotIndex) {
          remaining = remaining.filter((index) => !touched.has(index));
        } else {
          remaining = missingIndexes(latestShots);
        }
        const still = force && !shotIndex ? remaining : missingIndexes(latestShots);
        if (still.length === 0) {
          setStatus(
            shotIndex
              ? `第 ${episode.episode_no} 集第 ${shotIndex} 镜已重出`
              : `第 ${episode.episode_no} 镜头尾已就绪，可以出视频`,
          );
          return;
        }
        if (lastPassError && touched.size === 0) {
          throw new Error(lastPassError);
        }
        lastPassError = "";
        if (pass < maxPasses - 1) continue;
        throw new Error(
          lastPassError ||
            `第 ${still.join("、")} 镜头尾还没出完，请再试一次`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成场景失败");
    } finally {
      if (episodeWorkRef.current === episode.id) episodeWorkRef.current = null;
      setSceneId(null);
      setSceneProgress(null);
    }
  }

  async function renderEpisode(
    episode: EpisodeView,
    opts: {
      dubOnly?: boolean;
      shotIndex?: number;
      composeOnly?: boolean;
      voicePath?: VideoVoicePath;
      autoLipSync?: boolean;
    } = {},
  ) {
    const dubOnly = opts.dubOnly === true;
    const composeOnly = opts.composeOnly === true;
    const voicePath = opts.voicePath
      ? resolveVoicePath(opts.voicePath)
      : defaultRenderVoicePath(hookStyle);
    const wantAutoLip =
      voicePath === "native" &&
      !dubOnly &&
      !composeOnly &&
      isShowStyle(hookStyle) &&
      (opts.autoLipSync === true || autoLipSync);
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
      if (voicePath === "lipsync") {
        const pending = (
          shotIndex
            ? episode.shots.filter((s) => s.index === shotIndex)
            : episode.shots
        ).filter(shotCanLipSync);
        if (pending.length === 0) {
          setError(
            shotIndex
              ? "这一镜还没出片，或是内心独白，不用对口型"
              : "先出片再对口型。内心独白不用对口型",
          );
          return;
        }
        const missingScenes = pending
          .filter((s) => !shotHasKeyframes(s))
          .map((s) => s.index);
        if (missingScenes.length > 0) {
          setError(`第 ${missingScenes.join("、")} 镜还没有头尾关键帧，先出图再出片`);
          return;
        }
      } else {
        const pending = (shotIndex
          ? episode.shots.filter((s) => s.index === shotIndex)
          : episode.shots.filter((s) => !s.clipUrl?.trim())
        ).sort((a, b) => a.index - b.index);
        const missingScenes = pending
          .filter((s) => !shotHasKeyframes(s))
          .map((s) => s.index);
        if (missingScenes.length > 0) {
          setError(`第 ${missingScenes.join("、")} 镜还没有头尾关键帧，先出图再出片`);
          return;
        }
        const missingSpeech = speakShotsMissingLock(pending);
        if (missingSpeech.length > 0) {
          setError(`第 ${missingSpeech.join("、")} 镜还没锁声，先按对白出声再出片`);
          return;
        }
      }
      const need = pendingRenderSeconds(episode.shots, shotIndex);
      if (
        need > 0 &&
        videoLeft !== "unlimited" &&
        typeof videoLeft === "number"
      ) {
        if (videoLeft <= 0) {
          setError(quotaRechargeText("videoSeconds"));
          return;
        }
        if (videoLeft < need) {
          setError(quotaRechargeText("videoSeconds"));
          return;
        }
      }
    }
    setRenderingId(episode.id);
    setError(null);
    const shotTotal = shotIndex
      ? 1
      : voicePath === "lipsync"
        ? episode.shots.filter(shotCanLipSync).length || 1
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
          : voicePath === "lipsync"
            ? shotIndex
              ? `第 ${shotIndex} 镜对口型中…`
              : `对口型中…`
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
          : voicePath === "lipsync"
            ? shotIndex
              ? `第 ${shotIndex} 镜对口型中…`
              : `正在按成片声音对口型…`
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
          voicePath,
          autoLipSync: wantAutoLip,
          bedMusic,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        throw new Error(
          parseQuotaError(res, data) ||
            data.error ||
            (dubOnly ? "补旁白失败" : "生成视频失败"),
        );
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
              : `第 ${episode.episode_no} 集分镜视频已保存，出齐后先预览再合成`,
      );
      void refreshQuota();
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成视频失败";
      setError(message);
      if (isQuotaMessage(message)) void refreshQuota();
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

  const sourceText = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const stanceCards = series
    ? resolveStanceCards(
        series.notes,
        castIds
          .map((id) => characters.find((row) => row.id === id)?.name?.trim() || "")
          .filter(Boolean),
        hookStyle,
      )
    : [];
  const imported =
    resolveScriptSourceKind(sourceKind, sourceText) === "script";
  const leftover = imported
    ? leftoverImportedEpisodes(sourceText, episodes.length)
    : 0;
  const appendBatch = Math.min(
    leftover,
    8,
    Math.max(0, MAX_EPISODE_COUNT - episodes.length),
  );

  useEffect(() => {
    if (sequelAuto.current || !imported || leftover <= 0) return;
    sequelAuto.current = true;
    setHasSequel(true);
  }, [imported, leftover]);

  return (
    <div className="space-y-3">
    <header className="video-music-lead">
      <p className="video-music-lead__kicker">短视频剧本</p>
      <h2>把你的文案生成视频，让传播更有效</h2>
      <p>先出剧本，改到没问题再确认，再生成分镜和成片。</p>
    </header>
    <div id="video-script" className="card scroll-mt-24 space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--muted)]">
            先出剧本，改到没问题后点确认，再生成分镜。批量出头尾时每一镜向前接上一镜；单独重出某一镜时整镜参考指定的那一镜，默认下一镜，也可以自己选。
            {videoReady ? "" : " 出片要配方舟或 Cloudflare AI。"}
          </p>
        </div>
        <QuotaHint
          snap={videoQuota}
          remaining={videoLeft}
          need={Math.max(1, nextClipSeconds)}
        />
      </div>
      {leftover > 0 && series && episodes.length > 0 ? (
        <div className="script-sequel-wrap">
          <p className="script-sequel-note">
            原作大约还有 {leftover} 集没写。点「还有后续」，再点「写下一集」按原作接着改，不要另起故事。
            {appendBatch > 1 ? ` 也可以一次接着写后 ${appendBatch} 集。` : ""}
          </p>
        </div>
      ) : null}
      <div className="script-toolbar">
        <div className="script-toolbar__row">
          <select
            className="field script-toolbar__speak"
            value={speakMode}
            disabled={busy}
            title="说话方式"
            onChange={(e) =>
              void selectSpeakMode(e.target.value as VideoSpeakMode)
            }
          >
            <option value="narration">旁白</option>
            <option value="dialogue">对话</option>
          </select>
          <label className="script-toolbar__voice" title="画外音用这条音色，角色开口跟各自角色走">
            <span>旁白</span>
            <VoiceSelect
              value={voiceId}
              voices={voices}
              disabled={busy}
              title="旁白音色"
              className="script-toolbar__voice-pick"
              onChange={(next) => void selectNarratorVoice(next)}
            />
          </label>
          <VoicePreviewButton voiceId={voiceId} disabled={busy} />
          <i className="script-toolbar__split" aria-hidden />
          <SearchSelect
            value={hookStyle}
            items={VIDEO_SCRIPT_STYLE_OPTIONS.map((s) => ({
              id: s.id,
              label: s.label,
              hint: s.hint,
              group: s.group,
            }))}
            groups={VIDEO_SCRIPT_STYLE_GROUPS}
            disabled={busy}
            className="script-toolbar__hook"
            placeholder={hookStyleLabel(hookStyle)}
            title={hookStyleMeta(hookStyle).hint || "剧本类型"}
            searchPlaceholder="搜穿越、重生、口播…"
            onChange={(next) => {
              const style = normalizeHookStyle(next);
              setHookStyle(style);
              if (isShowStyle(style) && speakMode !== "dialogue") {
                void selectSpeakMode("dialogue");
              }
            }}
          />
          <LookStyleSelect
            value={lookStyle}
            disabled={busy}
            onChange={(next) => {
              const style = normalizeLookStyle(next);
              setLookStyle(style);
              if (series) void patchSeries({ look_style: style });
            }}
          />
          <i className="script-toolbar__split" aria-hidden />
          <div
            className="script-toolbar__pills"
            title="对手说完，切被压的人一句没说出口的话。写剧本时生效。"
          >
            {(
              [
                ["off", "独白关"],
                ["low", "独白压"],
                ["mid", "独白震"],
                ["high", "独白炸"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`script-toolbar__chip${innerVoice === id ? " is-on" : ""}`}
                disabled={busy || speakMode !== "dialogue"}
                title={
                  speakMode !== "dialogue"
                    ? "对话稿才能加内心独白"
                    : id === "off"
                      ? "写剧本时不插内心独白"
                      : id === "low"
                        ? "压着的心里话"
                        : id === "mid"
                          ? "心里一震"
                          : "心里炸开，声音夸张"
                }
                onClick={() => void selectInnerVoice(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <i className="script-toolbar__split" aria-hidden />
          <div
            className="script-toolbar__duration"
            role="group"
            aria-label="每集时长预算"
            title="约数预算。分镜秒数按对白走，以把剧情演清楚为准，不硬凑满。"
          >
            <span>时长</span>
            {EPISODE_DURATION_OPTIONS.map((sec) => (
              <button
                key={sec}
                type="button"
                className={
                  durationSec === sec
                    ? "script-toolbar__chip is-on"
                    : "script-toolbar__chip"
                }
                disabled={busy}
                aria-pressed={durationSec === sec}
                onClick={() => {
                  setDurationTouched(true);
                  setDurationSec(sec);
                  writeStoredDuration(articleId, sec);
                  if (series) void patchSeries({ duration_sec: sec });
                }}
              >
                {sec}秒
              </button>
            ))}
          </div>
          {isShowStyle(hookStyle) ? (
            <>
          <i className="script-toolbar__split" aria-hidden />
          <button
            type="button"
            className={`script-toolbar__chip${autoLipSync ? " is-on" : ""}`}
            disabled={busy}
            title="出片用模型自己的声音。打开后，出完立刻用这段声音再对一次口型"
            onClick={() => {
              setAutoLipSync((on) => {
                const next = !on;
                try {
                  localStorage.setItem(AUTO_LIPSYNC_KEY, next ? "1" : "0");
                } catch {
                  // ignore
                }
                return next;
              });
            }}
          >
            出片后自动对口型
          </button>
            </>
          ) : null}
          <button
            type="button"
            className={`script-toolbar__chip${bedMusic ? " is-on" : ""}`}
            disabled={busy}
            title="合成时垫一层低音量配乐。若下面已出歌并勾了「合成进成片」，会叠那首歌。"
            onClick={() => {
              setBedMusic((on) => {
                const next = !on;
                try {
                  localStorage.setItem(BED_MUSIC_KEY, next ? "1" : "0");
                } catch {
                  // ignore
                }
                return next;
              });
            }}
          >
            合成时垫乐
          </button>
        </div>
        <div className="script-toolbar__row">
          <label className="script-toolbar__voice" title="写对白和准稿用的大模型，分镜另选">
            <span>写剧本</span>
            <ModelPicker
              className="script-toolbar__llm-wrap"
              buttonClassName="field script-toolbar__llm model-picker__btn"
              title="选择写剧本模型"
              value={scriptModelId}
              items={
                scriptModels.length
                  ? scriptModels
                  : [
                      {
                        id: "deepseek-reasoner",
                        label: "DeepSeek 思考",
                        hint: "",
                        cost: "",
                        ready: true,
                        badges: ["recommended"],
                      },
                    ]
              }
              disabled={busy}
              onChange={(next) => {
                setScriptModelId(next);
                writeStoredScriptModel(articleId, next);
              }}
            />
          </label>
          <label className="script-toolbar__voice" title="专门排分镜画面和节奏，不对白。可以和写剧本不是同一个模型">
            <span>分镜</span>
            <ModelPicker
              className="script-toolbar__llm-wrap"
              buttonClassName="field script-toolbar__llm model-picker__btn"
              title="选择分镜模型"
              value={shotModelId}
              items={
                scriptModels.length
                  ? scriptModels
                  : [
                      {
                        id: "deepseek-reasoner",
                        label: "DeepSeek 思考",
                        hint: "",
                        cost: "",
                        ready: true,
                        badges: ["recommended"],
                      },
                    ]
              }
              disabled={busy}
              onChange={(next) => {
                setShotModelId(next);
                writeStoredShotModel(articleId, next);
              }}
            />
          </label>
          <i className="script-toolbar__split" aria-hidden />
          <label className="script-toolbar__voice" title="出角色图和分镜静帧用的模型，不出视频">
            <span>出图</span>
            <ModelPicker
              className="script-toolbar__llm-wrap"
              buttonClassName="field script-toolbar__image model-picker__btn"
              title="选择出图模型"
              value={imageModelId}
              items={(imageModels.length ? imageModels : IMAGE_GEN_MODELS).map((m) => ({
                id: m.id,
                label: m.label,
                hint: m.hint,
                cost: m.cost,
                ready: m.ready !== false,
                badges: m.badges,
              }))}
              disabled={busy}
              onChange={(next) => {
                setImageModelId(next);
                writeStoredImageModel(next);
              }}
            />
          </label>
          <label className="script-toolbar__voice" title="出分镜视频用的模型，不写剧本">
            <span>出片</span>
            <ModelPicker
              className="script-toolbar__llm-wrap"
              buttonClassName="field script-toolbar__video model-picker__btn"
              title="选择出片模型"
              value={videoModelId}
              items={(videoModels.length ? videoModels : DEFAULT_VIDEO_MODELS).map((m) => ({
                id: m.id,
                label: m.open === "closed" ? `${m.label}（未开通）` : m.label,
                hint: m.hint,
                ready: m.open !== "closed",
                badges: m.badges,
              }))}
              disabled={busy}
              onChange={(next) => {
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
            />
          </label>
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
        <div className="script-toolbar__row script-toolbar__row--run">
          <label className="script-toolbar__count">
            <span>集数</span>
            <input
              className="field"
              type="number"
              min={1}
              max={MAX_EPISODE_COUNT}
              value={count}
              disabled={busy}
              title={`1–${MAX_EPISODE_COUNT} 集`}
              onChange={(e) => {
                const next = clampEpisodeCount(e.target.value);
                setCount(next);
                writeStoredCount(articleId, next);
                if (series) void patchSeries({ episode_count: next });
              }}
            />
          </label>
          <div
            className="script-toolbar__duration"
            role="group"
            aria-label="后续剧情"
            title={
              count === 1
                ? "只出一集时默认收束。要留下一集再点「还有后续」，写完后点「写下一集」。"
                : "这批最后一集默认收束。后面还有戏再点「还有后续」，再点「写下一集」。"
            }
          >
            <button
              type="button"
              className={
                !hasSequel
                  ? "script-toolbar__chip is-on"
                  : "script-toolbar__chip"
              }
              disabled={busy}
              aria-pressed={!hasSequel}
              onClick={() => setHasSequel(false)}
            >
              本集收束
            </button>
            <button
              type="button"
              className={
                hasSequel
                  ? "script-toolbar__chip is-on"
                  : "script-toolbar__chip"
              }
              disabled={busy}
              aria-pressed={hasSequel}
              onClick={() => setHasSequel(true)}
            >
              还有后续
            </button>
          </div>
          <button
            type="button"
            className="btn btn-ghost text-xs"
            disabled={busy}
            onClick={() => void generate()}
          >
            <span className="script-toolbar__swap">
              <span className={busy && !rewritingId ? "is-off" : undefined}>
                {series
                  ? count === 1
                    ? "重写 1 集"
                    : "重新拆剧本"
                  : count === 1
                    ? "生成 1 集剧本"
                    : "拆成短视频剧本"}
              </span>
              <span className={busy && !rewritingId ? undefined : "is-off"}>
                写剧本中…
              </span>
            </span>
          </button>
          {series && episodes.length > 0 ? (
            <button
              type="button"
              className={
                hasSequel ? "btn btn-primary text-xs" : "btn btn-ghost text-xs"
              }
              disabled={
                busy ||
                !hasSequel ||
                episodes.length >= MAX_EPISODE_COUNT
              }
              title={
                hasSequel
                  ? leftover > 0
                    ? "按原作还没拍到的部分续写，已有集不动。"
                    : "按上一集的缺口续写，已有集不动。新角色写进剧本后会自动认出来。"
                  : "本集已收束，不会写下一集。要续写先点「还有后续」。"
              }
              onClick={() => void generate(undefined, true)}
            >
              <span className="script-toolbar__swap">
                <span className={busy && !rewritingId ? "is-off" : undefined}>
                  写下一集
                </span>
                <span className={busy && !rewritingId ? undefined : "is-off"}>
                  续写中…
                </span>
              </span>
            </button>
          ) : null}
          {series && leftover > 1 && appendBatch > 1 ? (
            <button
              type="button"
              className="btn btn-ghost text-xs"
              disabled={busy || !hasSequel || episodes.length >= MAX_EPISODE_COUNT}
              title="按原作一次接着写后面几集，已有集不动。"
              onClick={() => void generate(undefined, true, appendBatch)}
            >
              接着写后 {appendBatch} 集
            </button>
          ) : null}
        </div>
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
        imageModelId={imageModelId}
        onCastChange={persistCast}
        onVoiceChange={persistCharacterVoice}
        onLibraryRefresh={refreshLibrary}
      />
      {scriptProps.length > 0 ? (
        <div className="script-props">
          <span className="script-props__label">本剧道具</span>
          <ul className="script-props__list">
            {scriptProps.map((prop) => (
              <li key={prop.id} className="script-props__item">
                {prop.url ? (
                  <img src={prop.url} alt={prop.name} />
                ) : (
                  <span className="script-props__empty">待出图</span>
                )}
                <span>{prop.name}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {castNotice && (
        <p className="text-sm text-[var(--fg)]">{castNotice}</p>
      )}
      {characters.length === 0 && !castNotice && (
        <p className="text-xs text-[var(--muted)]">
          还没有角色。先去{" "}
          <a className="underline" href="/characters">
            角色库
          </a>{" "}
          上传，或写出剧本后点「按剧本识别角色」。
        </p>
      )}

      {!rewritingId && error && (
        <QuotaMessage
          text={error}
          className="mt-3 text-sm text-[var(--danger)]"
        />
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
              title="这套剧本的合集名"
              onChange={(e) => setSeriesName(e.target.value.slice(0, 16))}
              onBlur={() => void saveSeriesName()}
            />
            <span className="text-xs text-[var(--muted)]">
              {genreLabel(series)} · {episodes.length} 集 ·{" "}
              {speakMode === "dialogue" ? "对话" : "旁白"}
            </span>
          </div>
          <label className="block space-y-1">
            <span className="text-xs text-[var(--muted)]">剧情介绍</span>
            <textarea
              className="field script-premise w-full py-1.5 text-sm leading-6"
              value={premise}
              placeholder="写设定和已经发生的事。角色大纲在下面人设卡里。"
              onChange={(e) => setPremise(e.target.value.slice(0, PREMISE_MAX))}
              onBlur={() => {
                const next = premise.trim();
                if (next === (series.premise || "").trim()) return;
                void fetch(`/api/articles/${articleId}/video-script`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ series: { premise: next } }),
                })
                  .then((res) => res.json())
                  .then((data: Payload) => applyPayload(data))
                  .catch(() => undefined);
              }}
            />
          </label>
          <div className="space-y-1">
            <span className="text-xs text-[var(--muted)]">角色大纲</span>
            {stanceCards.length > 0 ? (
              <ul className="space-y-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm leading-6">
                {stanceCards.map((card) => (
                  <li key={card.name}>{formatCastLine(card)}</li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--muted)]">
                {castIds.length
                  ? "本剧已有角色。介绍还没写进大纲，可再点「按剧本识别角色」。"
                  : "还没有角色介绍。写出剧本后点「按剧本识别角色」，由模型从准稿里写是谁。"}
              </p>
            )}
          </div>
        </div>
      )}

      {episodes.length > 0 && (
        <ul className="mt-3 space-y-2">
          {episodes.map((ep) => {
            const castNames = castIds
              .map((id) => characters.find((c) => c.id === id)?.name?.trim())
              .filter((name): name is string => Boolean(name));
            return (
              <li
                key={ep.id}
                className="rounded-lg border border-[var(--line)] bg-white"
              >
                <div className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm">
                  <span>
                    第 {ep.episode_no} 集 ·{" "}
                    {speakMode === "dialogue" ? "对话" : "旁白"} ·{" "}
                    {ep.duration_sec || durationSec}秒 · {ep.title || "未命名"}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {ep.confirmed ? "已确认" : "待确认"}
                    {ep.video_url
                      ? ep.video_status === "generating" || renderingId === ep.id
                        ? " · 上一版可看"
                        : " · 已合成"
                      : clipsReady(ep.shots)
                        ? " · 待合成"
                        : ep.shots.some((s) => s.clipUrl)
                          ? ` · 已出 ${ep.shots.filter((s) => s.clipUrl).length}/${ep.shots.length} 镜`
                          : ""}
                    {ep.video_status === "failed" ? " · 出片失败" : ""}
                  </span>
                </div>
                <div className="space-y-2 border-t border-[var(--line)] px-3 py-3">
                    {rewritingId === ep.id && (
                      <div className="space-y-2">
                        {error && (
                          <QuotaMessage
                            text={error}
                            className="text-sm text-[var(--danger)]"
                          />
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
                      placeholder={`前 ${ep.duration_sec === 15 || durationSec === 15 ? 2 : 3} 秒钩子`}
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
                    <div className="text-sm">
                      <span className="font-medium">
                        说话方式：{speakMode === "dialogue" ? "对话" : "旁白"}
                      </span>
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        {speakMode === "dialogue"
                          ? "角色开口，准稿第一行写【对话】，每句写「角色名：」"
                          : "画外音，准稿第一行写【旁白】，每句写「旁白：」"}
                      </span>
                    </div>
                    <textarea
                      className="field min-h-28"
                      value={ep.voiceover}
                      placeholder={
                        speakMode === "dialogue"
                          ? `【对话】${
                              castNames.length >= 2
                                ? `${castNames[0]}：……${castNames[1]}：……`
                                : "角色名：原话"
                            }`
                          : "【旁白】旁白：……"
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
                      placeholder={
                        hasSequel ? "下集缺口" : "本集收束一句，不要写下集"
                      }
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
                    <div className="ep-block">
                      <div className="ep-block-bar">
                        <span className="ep-block-label">分镜</span>
                        <div className="flex flex-wrap items-center gap-2">
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
                            disabled={busy || !ep.voiceover.trim()}
                            title="对白不动，只让分镜导演按钩共顶打停重排画面"
                            onClick={() => void generate(ep.id, false, 1, true)}
                          >
                            重写分镜
                          </button>
                          <button
                            type="button"
                            className={
                              ep.confirmed
                                ? "btn btn-ghost text-xs"
                                : "btn btn-primary text-xs"
                            }
                            disabled={ep.confirmed}
                            onClick={() => void confirmEpisode(ep)}
                          >
                            {ep.confirmed ? "已确认" : "确认本集没问题"}
                          </button>
                          <button
                            type="button"
                            className={
                              ep.confirmed && !scenesReady(ep.shots)
                                ? "btn btn-primary text-xs"
                                : "btn btn-ghost text-xs"
                            }
                            disabled={
                              !ep.confirmed ||
                              sceneId === ep.id ||
                              renderingId === ep.id ||
                              ep.shots.length === 0
                            }
                            title={
                              ep.confirmed
                                ? undefined
                                : "先确认本集剧本没问题，再生成分镜"
                            }
                            onClick={() =>
                              void generateScenes(ep, {
                                force: scenesReady(ep.shots),
                              })
                            }
                          >
                            {sceneId === ep.id
                              ? sceneProgress?.kind === "speech"
                                ? "卡秒中…"
                                : sceneProgress
                                  ? `出分镜 ${sceneProgress.done}/${sceneProgress.total}`
                                  : "出分镜中…"
                              : scenesReady(ep.shots)
                                ? "重出本集分镜"
                                : "生成分镜"}
                          </button>
                          {scenesReady(ep.shots) &&
                          ep.shots.some((shot) => !shot.framesOk) ? (
                            <button
                              type="button"
                              className="btn btn-ghost text-xs"
                              disabled={
                                !ep.confirmed ||
                                sceneId === ep.id ||
                                renderingId === ep.id
                              }
                              title="头尾图都过一遍，过完才能出片"
                              onClick={() => {
                                const nextShots = ep.shots.map((shot) =>
                                  shotHasKeyframes(shot)
                                    ? { ...shot, framesOk: true }
                                    : shot,
                                );
                                void saveEpisode({ ...ep, shots: nextShots });
                              }}
                            >
                              本集静帧过片
                            </button>
                          ) : null}
                          {!clipsReady(ep.shots) && (
                            <button
                              type="button"
                              className={
                                ep.confirmed && scenesReady(ep.shots)
                                  ? "btn btn-primary text-xs"
                                  : "btn btn-ghost text-xs"
                              }
                              disabled={
                                !ep.confirmed ||
                                renderingId === ep.id ||
                                sceneId === ep.id ||
                                !videoReady ||
                                videoBlocked ||
                                !pendingClipScenesReady(ep.shots) ||
                                !pendingClipFramesApproved(ep.shots)
                              }
                              title={
                                videoBlocked
                                  ? "配额不足，请充值"
                                  : !ep.confirmed
                                  ? "先确认本集剧本没问题"
                                  : !pendingClipScenesReady(ep.shots)
                                    ? "先生成分镜，再出片"
                                    : !pendingClipFramesApproved(ep.shots)
                                      ? "头尾图过片后才能出片"
                                      : undefined
                              }
                              onClick={() => void renderEpisode(ep)}
                            >
                              {renderingId === ep.id
                                ? renderProgress
                                  ? `出片 ${renderProgress.done}/${renderProgress.total}`
                                  : "出片中…"
                                : ep.shots.some((s) => s.clipUrl)
                                  ? `继续出片 ${ep.shots.filter((s) => s.clipUrl).length}/${ep.shots.length}`
                                  : "按分镜出片"}
                            </button>
                          )}
                          {isShowStyle(hookStyle) && ep.shots.some(shotCanLipSync) ? (
                            <button
                              type="button"
                              className="btn btn-ghost text-xs"
                              disabled={
                                !ep.confirmed ||
                                renderingId === ep.id ||
                                sceneId === ep.id ||
                                !videoReady
                              }
                              title="抽出片里的声音，按头尾图重新对口型。不换配音。"
                              onClick={() =>
                                void renderEpisode(ep, { voicePath: "lipsync" })
                              }
                            >
                              {renderingId === ep.id &&
                              renderProgress?.message.includes("口型")
                                ? renderProgress
                                  ? `对口型 ${renderProgress.done}/${renderProgress.total}`
                                  : "对口型中…"
                                : "对口型"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {ep.shots.length > 0 && (
                        <>
                        <ol className="film-rail" aria-label="出片步骤">
                          {FILM_STEPS.map((step) => {
                            const current = inferFilmStep({
                              shots: ep.shots,
                              confirmed: ep.confirmed,
                              composed: Boolean(ep.video_url),
                            });
                            const ids = FILM_STEPS.map((row) => row.id);
                            const here = ids.indexOf(step.id);
                            const now = ids.indexOf(current);
                            const state =
                              here < now ? "done" : here === now ? "run" : "wait";
                            return (
                              <li
                                key={step.id}
                                className={`film-rail__item is-${state}`}
                              >
                                {step.label}
                              </li>
                            );
                          })}
                        </ol>
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
                            !ep.confirmed ||
                            sceneId === ep.id ||
                            renderingId === ep.id
                          }
                          onSpeakerChange={(shot, speakerId) => {
                            const person = characters.find((c) => c.id === speakerId);
                            const patched = ep.shots.map((row) =>
                              row.index === shot.index
                                ? {
                                    ...row,
                                    speakerId,
                                    speaker:
                                      speakerId === NARRATOR_SPEAKER_ID
                                        ? "旁白"
                                        : person?.name || "旁白",
                                    voiceId: undefined,
                                  }
                                : row,
                            );
                            const nextShots = lockEpisodeVoices(patched, {
                              speakMode,
                              narratorVoiceId: voiceId,
                              cast: characters.filter((c) =>
                                castIds.includes(c.id),
                              ),
                            });
                            void saveEpisode({ ...ep, shots: nextShots });
                          }}
                          onRegenShot={(shot, opts) =>
                            void generateScenes(ep, {
                              shotIndex: shot.index,
                              refShotIndex: opts?.refShotIndex,
                            })
                          }
                          onRewriteCopy={(shot, intent) => {
                            void (async () => {
                              setCopyBusy({
                                id: ep.id,
                                index: shot.index,
                                intent,
                              });
                              setError(null);
                              try {
                                const res = await fetch(
                                  `/api/articles/${articleId}/video-script/shot`,
                                  {
                                    method: "POST",
                                    headers: {
                                      "content-type": "application/json",
                                    },
                                    body: JSON.stringify({
                                      episodeId: ep.id,
                                      shotIndex: shot.index,
                                      intent,
                                    }),
                                  },
                                );
                                const data = (await res.json()) as {
                                  shots?: VideoShot[];
                                  error?: string;
                                };
                                if (!res.ok) {
                                  throw new Error(data.error || "重写失败");
                                }
                                if (data.shots) {
                                  setEpisodes((rows) =>
                                    rows.map((row) =>
                                      row.id === ep.id
                                        ? { ...row, shots: data.shots || row.shots }
                                        : row,
                                    ),
                                  );
                                }
                                setStatus(
                                  intent === "emotion"
                                    ? `第 ${shot.index} 镜已加情绪`
                                    : `第 ${shot.index} 镜已改词`,
                                );
                              } catch (err) {
                                setError(
                                  err instanceof Error ? err.message : "重写失败",
                                );
                              } finally {
                                setCopyBusy(null);
                              }
                            })();
                          }}
                          onPatchShot={(shot, patch) => {
                            const nextShots = ep.shots.map((row) => {
                              if (row.index !== shot.index) return row;
                              const next = { ...row, ...patch };
                              if (patch.plate && !platesEqual(row.plate, patch.plate)) {
                                return dirtyStillsKeepSpeech(next);
                              }
                              return next;
                            });
                            void saveEpisode({ ...ep, shots: nextShots });
                          }}
                          onDeleteShot={(shot) => {
                            if (ep.shots.length <= 1) return;
                            const nextShots = removeShot(ep.shots, shot.index);
                            void (async () => {
                              setError(null);
                              try {
                                await saveEpisode({
                                  ...ep,
                                  shots: nextShots,
                                  voiceover: voiceoverFromShots(
                                    nextShots,
                                    speakMode,
                                  ),
                                });
                                setStatus(`第 ${shot.index} 镜已删`);
                              } catch (err) {
                                setError(
                                  err instanceof Error ? err.message : "删除失败",
                                );
                              }
                            })();
                          }}
                          copyBusy={
                            copyBusy?.id === ep.id
                              ? {
                                  index: copyBusy.index,
                                  intent: copyBusy.intent,
                                }
                              : null
                          }
                          onApproveFrames={(shot) => {
                            const nextShots = ep.shots.map((row) =>
                              row.index === shot.index
                                ? { ...row, framesOk: true }
                                : row,
                            );
                            void saveEpisode({ ...ep, shots: nextShots });
                          }}
                          onSwapClip={(shot) => {
                            const alt = shot.clipAltUrl?.trim();
                            const cur = shot.clipUrl?.trim();
                            if (!alt || !cur) return;
                            const nextShots = ep.shots.map((row) =>
                              row.index === shot.index
                                ? {
                                    ...row,
                                    clipUrl: alt,
                                    rawClipUrl: alt,
                                    clipAltUrl: cur,
                                  }
                                : row,
                            );
                            void saveEpisode({ ...ep, shots: nextShots });
                          }}
                          onRegenClip={(shot) =>
                            void renderEpisode(ep, { shotIndex: shot.index })
                          }
                          onLipSync={
                            isShowStyle(hookStyle)
                              ? (shot) =>
                                  void renderEpisode(ep, {
                                    shotIndex: shot.index,
                                    voicePath: "lipsync",
                                  })
                              : undefined
                          }
                          onCompose={() =>
                            void renderEpisode(ep, { composeOnly: true })
                          }
                          composeDisabled={
                            !ep.confirmed ||
                            renderingId === ep.id ||
                            sceneId === ep.id ||
                            !videoReady ||
                            !clipsReady(ep.shots)
                          }
                          composeTitle={
                            renderingId === ep.id && clipsReady(ep.shots)
                              ? renderProgress
                                ? `合成 ${renderProgress.done}/${renderProgress.total}`
                                : "合成中…"
                              : !clipsReady(ep.shots)
                                ? `还差 ${ep.shots.filter((s) => !s.clipUrl).length} 镜才能合成`
                                : ep.video_url
                                  ? "重新合成成片"
                                  : "合成成片"
                          }
                          filmUrl={ep.video_url}
                          filmTitle={
                            renderingId === ep.id && renderProgress
                              ? renderProgress.message
                              : ep.video_status === "generating" ||
                                  renderingId === ep.id
                                ? "上一版，正在重出"
                                : "成片预览"
                          }
                          filmRegenerating={
                            ep.video_status === "generating" ||
                            renderingId === ep.id
                          }
                          onEditCaptions={
                            ep.video_url
                              ? () => setEditCaptionsId(ep.id)
                              : undefined
                          }
                        />
                        {editCaptionsId === ep.id ? (
                          <FilmCaptionEditor
                            articleId={articleId}
                            episodeId={ep.id}
                            seriesTitle={seriesName || series?.title || ""}
                            onClose={() => setEditCaptionsId(null)}
                            onApplied={(videoUrl) => {
                              setEpisodes((rows) =>
                                rows.map((row) =>
                                  row.id === ep.id
                                    ? { ...row, video_url: videoUrl }
                                    : row,
                                ),
                              );
                              setStatus(`第 ${ep.episode_no} 集字效已烧进成片`);
                            }}
                          />
                        ) : null}
                        </>
                      )}
                    </div>
                    {ep.video_error && (
                      <p className="text-xs text-[var(--danger)]">
                        {ep.video_error}
                      </p>
                    )}
                    </>
                    )}
                  </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
    <VideoMusicPanel
      articleId={articleId}
      hasScript={episodes.some((ep) => String(ep.voiceover || "").trim())}
      hasComposedVideo={episodes.some((ep) => String(ep.video_url || "").trim())}
      seriesTitle={seriesName || series?.title || title}
    />
    </div>
  );
}
