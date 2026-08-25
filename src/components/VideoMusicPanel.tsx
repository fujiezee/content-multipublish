"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ModelPicker } from "@/components/ModelPicker";
import { MusicStylePicker } from "@/components/MusicStylePicker";
import type {
  MusicGenOption,
  SeriesMusicState,
} from "@/lib/ai/video-music";
import { musicNeedsCoverFill } from "@/lib/ai/music-cover-fill";
import {
  COVER_IMAGE_GEN_MODEL,
  IMAGE_GEN_MODELS,
} from "@/lib/ai/image-gen-models-shared";

type CoverModelOption = {
  id: string;
  label: string;
  hint: string;
  ready: boolean;
  badges?: Array<"recommended" | "hot" | "new">;
};

type LyricsModelOption = {
  id: string;
  label: string;
  hint: string;
  cost: string;
  ready: boolean;
  badges?: Array<"recommended" | "hot" | "new">;
};

type MusicResponse = {
  lyrics?: string;
  music?: SeriesMusicState;
  models?: MusicGenOption[];
  lyricsModels?: LyricsModelOption[];
  coverModels?: CoverModelOption[];
  ready?: boolean;
  hasScript?: boolean;
  hasComposedVideo?: boolean;
  error?: string;
  coverError?: string;
};

function parseResponseJson(text: string, status: number): MusicResponse {
  if (!text.trim()) {
    throw new Error(
      status >= 500 ? `出歌失败（${status}）` : "服务没有返回内容，请再试一次",
    );
  }
  try {
    return JSON.parse(text) as MusicResponse;
  } catch {
    throw new Error(`出歌失败（${status}）`);
  }
}

type Props = {
  articleId: string;
  seriesTitle?: string;
  hasScript?: boolean;
  hasComposedVideo?: boolean;
};

const FALLBACK_MODELS: MusicGenOption[] = [
  {
    id: "suno-v5-5",
    label: "Suno V5.5",
    hint: "可指定时长（约 90 秒）· 汽水上架更稳",
    cost: "",
    ready: true,
    providerModel: "V5_5",
    badges: ["recommended"],
  },
  {
    id: "suno-v5",
    label: "Suno V5",
    hint: "完整成曲约 90 秒起（汽水至少 1 分钟）",
    cost: "",
    ready: true,
    providerModel: "V5",
  },
];

const FALLBACK_LYRICS: LyricsModelOption[] = [
  {
    id: "deepseek-reasoner",
    label: "DeepSeek 思考",
    hint: "按文章写歌词",
    cost: "",
    ready: true,
    badges: ["recommended"],
  },
];

export function VideoMusicPanel({
  articleId,
  hasScript,
  hasComposedVideo,
}: Props) {
  const [lyrics, setLyrics] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [style, setStyle] = useState("");
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [styleExtra, setStyleExtra] = useState("");
  const [lyricsSource, setLyricsSource] = useState<"article" | "script">(
    "article",
  );
  const [modelId, setModelId] = useState("suno-v5-5");
  const [lyricsModelId, setLyricsModelId] = useState("deepseek-reasoner");
  const [vocal, setVocal] = useState<"m" | "f">("m");
  const [coverWanted, setCoverWanted] = useState(true);
  const [coverModelId, setCoverModelId] = useState(COVER_IMAGE_GEN_MODEL);
  const [coverModels, setCoverModels] = useState<CoverModelOption[]>(
    IMAGE_GEN_MODELS.map((m) => ({
      id: m.id,
      label: m.label,
      hint: m.hint,
      ready: true,
      badges: m.badges,
    })),
  );
  const [models, setModels] = useState<MusicGenOption[]>(FALLBACK_MODELS);
  const [lyricsModels, setLyricsModels] =
    useState<LyricsModelOption[]>(FALLBACK_LYRICS);
  const [music, setMusic] = useState<SeriesMusicState | null>(null);
  const [scriptReady, setScriptReady] = useState(Boolean(hasScript));
  const [composedVideo, setComposedVideo] = useState(
    Boolean(hasComposedVideo),
  );
  const [ready, setReady] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [errorScope, setErrorScope] = useState<"lyrics" | "music" | "">("");
  const [thinking, setThinking] = useState("");
  const [showThink, setShowThink] = useState(true);
  const lyricsBoxRef = useRef<HTMLTextAreaElement>(null);
  const thinkBoxRef = useRef<HTMLPreElement>(null);

  const apply = useCallback(
    (data: {
      lyrics?: string;
      songTitle?: string;
      music?: SeriesMusicState;
      models?: MusicGenOption[];
      lyricsModels?: LyricsModelOption[];
      coverModels?: CoverModelOption[];
      ready?: boolean;
      hasScript?: boolean;
      hasComposedVideo?: boolean;
      error?: string;
      coverError?: string;
    }) => {
      if (typeof data.lyrics === "string") setLyrics(data.lyrics);
      if (typeof data.songTitle === "string") {
        setSongTitle(data.songTitle);
      }
      if (data.music) {
        setMusic(data.music);
        if (data.music.model) setModelId(data.music.model);
        if (data.music.style) setStyle(data.music.style);
        if (data.music.vocal) setVocal(data.music.vocal);
        if (data.music.styleTags) setStyleTags(data.music.styleTags);
        if (typeof data.music.styleExtra === "string") {
          setStyleExtra(data.music.styleExtra);
        }
        if (data.music.lyricsModel) setLyricsModelId(data.music.lyricsModel);
        if (typeof data.music.songTitle === "string" && data.music.songTitle) {
          setSongTitle(data.music.songTitle);
        }
        if (typeof data.music.coverWanted === "boolean") {
          setCoverWanted(data.music.coverWanted);
        }
        if (data.music.coverModel) setCoverModelId(data.music.coverModel);
      }
      if (data.models?.length) setModels(data.models);
      if (data.coverModels?.length) setCoverModels(data.coverModels);
      if (data.lyricsModels?.length) {
        setLyricsModels(data.lyricsModels);
        setLyricsModelId((cur) => {
          const pick = data.music?.lyricsModel || cur;
          const ready = data.lyricsModels?.find((m) => m.id === pick && m.ready);
          return (
            ready?.id ||
            data.lyricsModels?.find((m) => m.ready)?.id ||
            data.lyricsModels?.[0]?.id ||
            pick
          );
        });
      }
      if (typeof data.ready === "boolean") setReady(data.ready);
      if (typeof data.hasScript === "boolean") setScriptReady(data.hasScript);
      if (typeof data.hasComposedVideo === "boolean") {
        setComposedVideo(data.hasComposedVideo);
      }
      if (data.error) {
        setError(data.error);
        setErrorScope("music");
      } else if (data.coverError) {
        setError(`歌已开始出；封面失败：${data.coverError}`);
        setErrorScope("music");
      }
    },
    [],
  );

  const load = useCallback(async () => {
    const res = await fetch(`/api/articles/${articleId}/video-music`);
    const data = parseResponseJson(await res.text(), res.status);
    apply(data);
  }, [articleId, apply]);

  useEffect(() => {
    void load();
  }, [load, hasScript, hasComposedVideo]);

  useEffect(() => {
    setComposedVideo(Boolean(hasComposedVideo));
  }, [hasComposedVideo]);

  const waitingSuno =
    music?.status === "pending" || music?.status === "processing";
  const waitingCovers = music ? musicNeedsCoverFill(music) : false;

  useEffect(() => {
    if (!waitingSuno && !waitingCovers) return;
    const timer = window.setInterval(() => {
      void load();
    }, waitingSuno ? 4000 : 2500);
    return () => window.clearInterval(timer);
  }, [waitingSuno, waitingCovers, load]);

  const fitLyricsBox = useCallback(() => {
    const box = lyricsBoxRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  }, []);

  useEffect(() => {
    fitLyricsBox();
  }, [lyrics, fitLyricsBox]);

  useEffect(() => {
    if (busy !== "lyrics" && busy !== "lyrics-free") return;
    const box = lyricsBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
    const think = thinkBoxRef.current;
    if (think) think.scrollTop = think.scrollHeight;
  }, [lyrics, thinking, busy]);

  async function run(
    action: "lyrics" | "lyrics-free" | "generate" | "cover",
    nextStyle?: {
      style: string;
      styleTags: string[];
      styleExtra: string;
    },
    trackId?: string,
  ) {
    setError("");
    setErrorScope(
      action === "generate" || action === "cover" ? "music" : "lyrics",
    );
    setBusy(action === "cover" && trackId ? `cover:${trackId}` : action);
    if (action !== "generate" && action !== "cover") {
      setThinking("");
      setShowThink(true);
    }
    try {
      const res = await fetch(`/api/articles/${articleId}/video-music`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          lyrics,
          songTitle,
          style: nextStyle?.style ?? style,
          styleTags: nextStyle?.styleTags ?? styleTags,
          styleExtra: nextStyle?.styleExtra ?? styleExtra,
          model: modelId,
          lyricsModel: lyricsModelId,
          vocal,
          coverWanted,
          coverModel: coverModelId,
          ...(trackId ? { trackId } : {}),
        }),
      });
      const kind = res.headers.get("content-type") || "";
      if (kind.includes("ndjson")) {
        if (!res.ok || !res.body) {
          const data = parseResponseJson(await res.text(), res.status);
          throw new Error(data.error || "写歌词失败");
        }
        setLyrics("");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamed = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let event: {
              type?: string;
              delta?: string;
              lyrics?: string;
              songTitle?: string;
              message?: string;
              music?: SeriesMusicState;
              models?: MusicGenOption[];
              lyricsModels?: LyricsModelOption[];
              ready?: boolean;
              hasScript?: boolean;
              error?: string;
            };
            try {
              event = JSON.parse(trimmed) as typeof event;
            } catch {
              continue;
            }
            if (event.type === "thinking" && event.delta) {
              setThinking((prev) => prev + event.delta);
            } else if (event.type === "content" && event.delta) {
              streamed += event.delta;
              setLyrics((prev) => prev + event.delta);
            } else if (event.type === "done") {
              if (event.lyrics?.trim()) {
                streamed = event.lyrics;
                apply(event);
              }
              if (typeof event.songTitle === "string") {
                setSongTitle(event.songTitle);
              }
            } else if (event.type === "error") {
              throw new Error(event.message || event.error || "写歌词失败");
            }
          }
        }
        if (!streamed.trim()) {
          throw new Error("写歌词没写出内容，换个模型或再试一次");
        }
        return;
      }
      const data = parseResponseJson(await res.text(), res.status);
      if (!res.ok) throw new Error(data.error || "失败");
      apply(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "失败");
    } finally {
      setBusy("");
    }
  }

  async function save(patch?: {
    lyrics?: string;
    songTitle?: string;
    selectedTrackId?: string;
    mixIntoVideo?: boolean;
    style?: string;
    styleTags?: string[];
    styleExtra?: string;
    lyricsModel?: string;
    coverWanted?: boolean;
    coverModel?: string;
  }) {
    await fetch(`/api/articles/${articleId}/video-music`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lyrics: patch?.lyrics ?? lyrics,
        songTitle: patch?.songTitle ?? songTitle,
        style: patch?.style ?? style,
        styleTags: patch?.styleTags ?? styleTags,
        styleExtra: patch?.styleExtra ?? styleExtra,
        model: modelId,
        lyricsModel: patch?.lyricsModel ?? lyricsModelId,
        vocal,
        selectedTrackId: patch?.selectedTrackId,
        mixIntoVideo: patch?.mixIntoVideo,
        coverWanted: patch?.coverWanted ?? coverWanted,
        coverModel: patch?.coverModel ?? coverModelId,
      }),
    });
  }

  function applyStyle(next: {
    tagIds: string[];
    extra: string;
    prompt: string;
  }) {
    setStyleTags(next.tagIds);
    setStyleExtra(next.extra);
    setStyle(next.prompt);
    return next;
  }

  const writing = busy === "lyrics" || busy === "lyrics-free";
  const generating =
    music?.status === "pending" || music?.status === "processing";
  const tracks = music?.tracks?.filter((row) => row.url || row.streamUrl) || [];
  const mixOn = music?.mixIntoVideo !== false;
  const hasLyrics = Boolean(lyrics.trim());
  const lyricsReady = hasLyrics && !writing;
  const lyricsError = errorScope === "lyrics" ? error : "";
  const musicError =
    errorScope === "music" ? error || music?.error || "" : music?.error || "";

  function writeLyrics() {
    if (lyricsSource === "script") {
      void run("lyrics");
      return;
    }
    void run("lyrics-free");
  }

  return (
    <div className="video-music-split">
      <header className="video-music-lead">
        <p className="video-music-lead__kicker">生成歌曲</p>
        <h2>把你的文案生成歌曲，让传播更优雅</h2>
        <p>先按文章或剧本写出能唱的词，改好后再出歌。</p>
      </header>
      <section className="card video-music-split__card video-music-sheet">
        <h2>
          <span className="video-music-split__step">第一步</span>
          歌词
        </h2>
        <div className="video-music-deck">
          <div className="video-music-deck__cell">
            <span className="video-music-deck__label">根据</span>
            <div className="video-music-deck__pills" role="group" aria-label="歌词来源">
              <button
                type="button"
                className={`video-music-deck__chip${lyricsSource === "article" ? " is-on" : ""}`}
                disabled={writing}
                onClick={() => setLyricsSource("article")}
              >
                文章
              </button>
              <button
                type="button"
                className={`video-music-deck__chip${lyricsSource === "script" ? " is-on" : ""}`}
                disabled={writing || !scriptReady}
                title={scriptReady ? "按剧本对白写" : "还没有剧本对白"}
                onClick={() => setLyricsSource("script")}
              >
                剧本
              </button>
            </div>
          </div>
          <div className="video-music-deck__cell">
            <span className="video-music-deck__label">曲风</span>
            <MusicStylePicker
              tagIds={styleTags}
              extra={styleExtra}
              vocal={vocal}
              disabled={writing}
              onChange={(next) => {
                applyStyle(next);
                void save({
                  style: next.prompt,
                  styleTags: next.tagIds,
                  styleExtra: next.extra,
                });
              }}
            />
          </div>
          <div className="video-music-deck__cell">
            <span className="video-music-deck__label">模型</span>
            <ModelPicker
              className="video-music-deck__model"
              buttonClassName="field model-picker__btn"
              title="选择写歌词模型"
              value={lyricsModelId}
              items={lyricsModels}
              disabled={writing}
              onChange={(next) => {
                setLyricsModelId(next);
                void save({ lyricsModel: next });
              }}
            />
          </div>
          <div className="video-music-deck__cell video-music-deck__cell--go">
            <span className="video-music-deck__label" aria-hidden="true">
              &nbsp;
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={writing}
              onClick={writeLyrics}
            >
              {writing ? "生成中…" : hasLyrics ? "重新生成" : "生成歌词"}
            </button>
          </div>
        </div>
        {lyricsError ? (
          <p className="video-music-sheet__note video-music-sheet__note--err">
            {lyricsError}
          </p>
        ) : null}
      </section>
      <section className="card video-music-split__card video-music-lyrics">
        {writing || thinking ? (
          <div className="video-music-lyrics__think">
            <button
              type="button"
              className="video-music-lyrics__think-toggle"
              onClick={() => setShowThink((cur) => !cur)}
            >
              <span>{writing && !hasLyrics ? "正在思索" : "思索过程"}</span>
              <span className="video-music-lyrics__think-meta">
                {writing && !thinking
                  ? "连接模型…"
                  : showThink
                    ? "收起"
                    : "展开"}
              </span>
            </button>
            {showThink ? (
              <pre ref={thinkBoxRef} className="video-music-lyrics__think-body">
                {thinking || "先想结构和情绪，再把能唱的词写下来。"}
              </pre>
            ) : null}
          </div>
        ) : null}
        <label className="video-music-lyrics__title">
          <span className="video-music-lyrics__title-label">歌名</span>
          <input
            className="video-music-lyrics__title-input"
            value={songTitle}
            disabled={writing}
            placeholder="未名曲"
            maxLength={16}
            onChange={(e) => setSongTitle(e.target.value)}
            onBlur={() => {
              if (!writing) void save({ songTitle });
            }}
          />
          <span className="video-music-lyrics__title-hint">
            写歌词时会一起起，也可自己改
          </span>
        </label>
        <textarea
          ref={lyricsBoxRef}
          className="field video-music-lyrics__body"
          placeholder={
            writing
              ? thinking
                ? "想完就会开始写词…"
                : "正在生成…"
              : "生成的歌词会出现在这里，也可以直接写。"
          }
          value={lyrics}
          readOnly={writing}
          onChange={(e) => {
            setLyrics(e.target.value);
            requestAnimationFrame(fitLyricsBox);
          }}
          onBlur={() => {
            if (!writing) void save();
          }}
        />
      </section>

      {lyricsReady ? (
      <section className="card video-music-split__card video-music-sheet">
        <h2>
          <span className="video-music-split__step">第二步</span>
          出歌
        </h2>
        <div
          className={`video-music-deck video-music-deck--music${composedVideo ? " is-mix" : ""}${coverWanted ? " is-cover" : ""}`}
        >
          <div className="video-music-deck__cell">
            <span className="video-music-deck__label">人声</span>
            <div className="video-music-deck__pills" role="group" aria-label="人声">
              <button
                type="button"
                className={`video-music-deck__chip${vocal === "m" ? " is-on" : ""}`}
                disabled={Boolean(busy)}
                onClick={() => setVocal("m")}
              >
                男声
              </button>
              <button
                type="button"
                className={`video-music-deck__chip${vocal === "f" ? " is-on" : ""}`}
                disabled={Boolean(busy)}
                onClick={() => setVocal("f")}
              >
                女声
              </button>
            </div>
          </div>
          <div className="video-music-deck__cell">
            <span className="video-music-deck__label">封面</span>
            <div className="video-music-deck__pills" role="group" aria-label="封面">
              <button
                type="button"
                className={`video-music-deck__chip${coverWanted ? " is-on" : ""}`}
                disabled={Boolean(busy)}
                onClick={() => {
                  setCoverWanted(true);
                  void save({ coverWanted: true });
                }}
              >
                生成
              </button>
              <button
                type="button"
                className={`video-music-deck__chip${!coverWanted ? " is-on" : ""}`}
                disabled={Boolean(busy)}
                onClick={() => {
                  setCoverWanted(false);
                  void save({ coverWanted: false });
                }}
              >
                不生成
              </button>
            </div>
          </div>
          <div className="video-music-deck__cell video-music-deck__cell--models">
            <span className="video-music-deck__label">出歌模型</span>
            <ModelPicker
              className="video-music-deck__model"
              buttonClassName="field model-picker__btn"
              title="选择音乐模型"
              value={modelId}
              items={models.map((m) => ({
                id: m.id,
                label: m.label,
                hint: m.hint,
                cost: m.cost,
                ready: m.ready,
                badges: m.badges,
              }))}
              disabled={Boolean(busy)}
              onChange={setModelId}
            />
            {coverWanted ? (
              <>
                <span className="video-music-deck__label">封面模型</span>
                <ModelPicker
                  className="video-music-deck__model"
                  buttonClassName="field model-picker__btn"
                  title="选择封面模型"
                  value={coverModelId}
                  items={coverModels.map((m) => ({
                    id: m.id,
                    label: m.label,
                    hint: m.hint,
                    ready: m.ready,
                    badges: m.badges,
                  }))}
                  disabled={Boolean(busy)}
                  onChange={(id) => {
                    setCoverModelId(id);
                    void save({ coverModel: id });
                  }}
                />
              </>
            ) : null}
          </div>
          {composedVideo ? (
            <div className="video-music-deck__cell">
              <span className="video-music-deck__label">成片</span>
              <button
                type="button"
                className={`video-music-deck__chip${mixOn ? " is-on" : ""}`}
                disabled={Boolean(busy) || tracks.length === 0}
                title="再合成成片时，把选定的歌叠进视频，对白仍在上面"
                onClick={() => {
                  const next = !mixOn;
                  setMusic((cur) =>
                    cur ? { ...cur, mixIntoVideo: next } : cur,
                  );
                  void save({ mixIntoVideo: next });
                }}
              >
                合成进成片
              </button>
            </div>
          ) : null}
          <div className="video-music-deck__cell video-music-deck__cell--go">
            <span className="video-music-deck__label" aria-hidden="true">
              &nbsp;
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={Boolean(busy) || generating || !ready || !hasLyrics}
              title={
                !hasLyrics
                  ? "先写歌词再出歌"
                  : ready
                    ? "用当前歌词出歌"
                    : "还没配音乐生成"
              }
              onClick={() => void run("generate")}
            >
              {generating || busy === "generate" ? "出歌中…" : "生成音乐"}
            </button>
          </div>
        </div>
        {!ready ? (
          <p className="video-music-sheet__note">音乐通道未配置</p>
        ) : null}
        {musicError ? (
          <p className="text-sm text-[var(--danger)]">{musicError}</p>
        ) : null}
        {generating ? (
          <p className="video-music-sheet__note">
            正在出歌，大约一两分钟。出好后可以直接在下面听。
          </p>
        ) : null}
        {waitingCovers ? (
          <p className="video-music-sheet__note">
            歌已经好了，封面还在出，每首歌各一张。
          </p>
        ) : null}
        {tracks.length > 0 ? (
          <div className="video-music-takes">
            <div className="video-music-takes__head">
              <p className="video-music-sheet__note">
                已出 {tracks.length} 首
              </p>
              <Link
                href={`/music?article=${articleId}`}
                className="btn btn-ghost text-xs"
              >
                在音乐页听
              </Link>
            </div>
            <ul className="video-music-takes__list">
              {tracks.map((track, index) => {
                const src = (track.url || track.streamUrl || "").trim();
                const chosen =
                  track.id ===
                  (music?.selectedTrackId || tracks[0]?.id || "");
                const covering =
                  busy === `cover:${track.id}` ||
                  (waitingCovers && !track.coverUrl);
                return (
                  <li
                    key={track.id || index}
                    className={
                      chosen
                        ? "video-music-takes__item is-on"
                        : "video-music-takes__item"
                    }
                  >
                    <div className="video-music-takes__row">
                      <div className="video-music-takes__art">
                        {track.coverUrl ? (
                          <img
                            src={track.coverUrl}
                            alt={
                              track.title ||
                              music?.songTitle ||
                              `版本 ${index + 1}`
                            }
                            className="video-music-takes__cover"
                          />
                        ) : (
                          <div className="video-music-takes__cover is-empty" />
                        )}
                        {coverWanted ? (
                          <button
                            type="button"
                            className="btn btn-ghost text-xs"
                            disabled={
                              Boolean(busy) || !hasLyrics || covering
                            }
                            onClick={() => void run("cover", undefined, track.id)}
                          >
                            {covering
                              ? "出封面中…"
                              : track.coverUrl
                                ? "重出封面"
                                : "补封面"}
                          </button>
                        ) : null}
                      </div>
                      <div className="video-music-takes__main">
                        <div className="video-music-takes__meta">
                          <strong>
                            {track.title ||
                              music?.songTitle ||
                              `版本 ${index + 1}`}
                          </strong>
                          <button
                            type="button"
                            className={
                              chosen
                                ? "video-music-deck__chip is-on"
                                : "video-music-deck__chip"
                            }
                            disabled={Boolean(busy)}
                            onClick={() => {
                              setMusic((cur) =>
                                cur
                                  ? { ...cur, selectedTrackId: track.id }
                                  : cur,
                              );
                              void save({ selectedTrackId: track.id });
                            }}
                          >
                            {chosen ? "合成用这首" : "选这首合成"}
                          </button>
                        </div>
                        {src ? (
                          <audio controls src={src} preload="metadata" />
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </section>
      ) : null}
    </div>
  );
}
