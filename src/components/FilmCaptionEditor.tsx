"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { CaptionCue } from "@/lib/ai/caption-reveal";
import {
  FILM_COLOR_PRESETS,
  FILM_FONT_OPTIONS,
  cueAtTime,
  clampLayerPos,
  defaultFilmCaptionStyle,
  filmFontMeta,
  formatFilmTitle,
  layerLimits,
  type FilmCaptionCues,
  type FilmCaptionStyle,
  type FilmLayerId,
  type FilmLayerStyle,
} from "@/lib/ai/film-caption-style";

type Props = {
  articleId: string;
  episodeId: string;
  seriesTitle: string;
  onClose: () => void;
  onApplied: (videoUrl: string) => void;
};

const LAYERS: Array<{ id: FilmLayerId; label: string }> = [
  { id: "title", label: "片头" },
  { id: "caption", label: "字幕" },
  { id: "flower", label: "花字" },
];

const ZOOM_MIN = 1;
const ZOOM_MAX = 16;

type FeIconName =
  | "close"
  | "save"
  | "export"
  | "play"
  | "pause"
  | "eye"
  | "eyeOff"
  | "title"
  | "caption"
  | "flower"
  | "minus"
  | "plus"
  | "fit"
  | "toStart";

function FeIcon({ name }: { name: FeIconName }) {
  const path =
    name === "close" ? (
      <path d="M6 6 18 18M18 6 6 18" />
    ) : name === "save" ? (
      <>
        <path d="M5.5 5.5h10.2L18.5 8.3V18.5h-13z" />
        <path d="M8 5.5v4.2h7.2V5.5M8 18.5v-5.4h8V18.5" />
      </>
    ) : name === "export" ? (
      <>
        <path d="M12 14.5V5.5M8.5 8.5 12 5l3.5 3.5" />
        <path d="M6 13.5v5h12v-5" />
      </>
    ) : name === "play" ? (
      <path d="M8.5 6.5v11L18 12z" fill="currentColor" stroke="none" />
    ) : name === "pause" ? (
      <path d="M8 6.5h3v11H8zM13 6.5h3v11h-3z" fill="currentColor" stroke="none" />
    ) : name === "eye" ? (
      <>
        <path d="M3.5 12s3.2-6 8.5-6 8.5 6 8.5 6-3.2 6-8.5 6-8.5-6-8.5-6z" />
        <circle cx="12" cy="12" r="2.3" />
      </>
    ) : name === "eyeOff" ? (
      <>
        <path d="M4 5.5 19.5 19M9.4 9.2A3.2 3.2 0 0 0 12 15.2M7 8.2C5 9.5 3.7 11.3 3.5 12c0 0 3.2 6 8.5 6 1.5 0 2.9-.4 4.1-1.1M16.7 14.6C18.4 13.4 19.7 12 20.5 12c0 0-3.2-6-8.5-6-.8 0-1.6.1-2.3.3" />
      </>
    ) : name === "title" ? (
      <path d="M6 7.2h12M12 7.2v10M8.2 17.2h7.6" />
    ) : name === "caption" ? (
      <>
        <rect x="4" y="6.5" width="16" height="11" rx="1.6" />
        <path d="M7.2 12.8h3.4M13.4 12.8h3.4" />
      </>
    ) : name === "flower" ? (
      <path d="M12 4.8 13.4 9l4.6.4-3.5 3 1.2 4.5L12 14.6 8.3 16.9l1.2-4.5-3.5-3L10.6 9z" />
    ) : name === "minus" ? (
      <path d="M6.5 12h11" />
    ) : name === "plus" ? (
      <path d="M12 6.5v11M6.5 12h11" />
    ) : name === "fit" ? (
      <path d="M8 6.5H5.5V9M16 6.5h2.5V9M8 17.5H5.5V15M16 17.5h2.5V15M8.5 10.5h7v3h-7z" />
    ) : (
      <path d="M7 12h10M10.2 8.4 6.6 12l3.6 3.6" />
    );

  return (
    <svg className="film-edit-svg" viewBox="0 0 24 24" aria-hidden="true">
      {path}
    </svg>
  );
}

function layerText(
  layer: FilmLayerId,
  style: FilmCaptionStyle,
  caption: CaptionCue | null,
  flower: CaptionCue | null,
): string {
  if (layer === "title") return formatFilmTitle(style.title.text);
  if (layer === "caption") return caption?.line || "";
  return flower?.line || "";
}

function timecode(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const whole = Math.floor(r);
  const frac = Math.floor((r - whole) * 10);
  return `${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${frac}`;
}

function clampZoom(value: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

function niceStep(raw: number) {
  const safe = Math.max(0.1, raw);
  const pow = 10 ** Math.floor(Math.log10(safe));
  const n = safe / pow;
  const base = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return base * pow;
}

function rulerMarks(span: number, zoom: number) {
  const step = niceStep(span / Math.max(zoom, 1) / 8);
  const marks: Array<{ t: number; label: string }> = [];
  for (let t = 0; t <= span + 1e-6; t += step) {
    marks.push({ t: Number(t.toFixed(3)), label: timecode(t) });
  }
  return marks;
}

function suggestZoom(span: number, cues: CaptionCue[], viewW: number) {
  const durs = cues.map((cue) => cue.end - cue.start).filter((d) => d > 0.08);
  const shortest = Math.min(...durs, span);
  if (!viewW || !Number.isFinite(shortest) || shortest <= 0) return 2;
  return clampZoom((88 * span) / (viewW * shortest));
}

export function FilmCaptionEditor({
  articleId,
  episodeId,
  seriesTitle,
  onClose,
  onApplied,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<FilmLayerId | null>(null);
  const zoomRef = useRef(2);
  const spanRef = useRef(0.2);
  const zoomReady = useRef(false);
  const timeRaf = useRef(0);
  const timeHold = useRef(0);
  const [style, setStyle] = useState<FilmCaptionStyle>(() =>
    defaultFilmCaptionStyle(seriesTitle),
  );
  const [cues, setCues] = useState<FilmCaptionCues>({
    captions: [],
    flowers: [],
  });
  const [previewUrl, setPreviewUrl] = useState("");
  const [scale, setScale] = useState(1);
  const [layer, setLayer] = useState<FilmLayerId>("caption");
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [dragging, setDragging] = useState<FilmLayerId | null>(null);
  const [zoom, setZoom] = useState(2);

  zoomRef.current = zoom;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let last = 0;
    const sync = () => {
      const next = Math.max(0.35, el.clientWidth / 720);
      if (Math.abs(next - last) < 0.015) return;
      last = next;
      setScale(next);
    };
    sync();
    const obs = new ResizeObserver(sync);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/articles/${articleId}/video-script/captions?episodeId=${encodeURIComponent(episodeId)}`,
          { signal: ac.signal, cache: "no-store" },
        );
        const data = (await res.json()) as {
          error?: string;
          style?: FilmCaptionStyle;
          cues?: FilmCaptionCues;
          sourceUrl?: string | null;
          videoUrl?: string | null;
          title?: string;
          canRestitch?: boolean;
        };
        if (!res.ok) throw new Error(data.error || "打不开编辑");
        if (ac.signal.aborted) return;
        setStyle(data.style || defaultFilmCaptionStyle(data.title || seriesTitle));
        setCues(data.cues || { captions: [], flowers: [] });
        const ready = data.sourceUrl || data.videoUrl || "";
        if (!ready) throw new Error("还没有成片，先合成再编辑");
        setPreviewUrl(ready);
        setLoading(false);
        setHint("画布上按住文字拖。时间轴可缩放。改完点导出。");
        if (data.sourceUrl || !data.canRestitch) return;
        const prep = await fetch(
          `/api/articles/${articleId}/video-script/captions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ episodeId, prepare: true }),
            signal: ac.signal,
          },
        );
        const plate = (await prep.json()) as {
          error?: string;
          sourceUrl?: string;
        };
        if (ac.signal.aborted) return;
        if (prep.ok && plate.sourceUrl) setPreviewUrl(plate.sourceUrl);
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "打不开编辑");
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [articleId, episodeId, seriesTitle]);

  const caption = useMemo(
    () => cueAtTime(cues.captions, time),
    [cues.captions, time],
  );
  const flower = useMemo(
    () => cueAtTime(cues.flowers, time),
    [cues.flowers, time],
  );
  const current = style[layer];
  const limits = layerLimits(layer);
  const activeCue = layer === "caption" ? caption : flower;
  const span = Math.max(
    duration,
    ...cues.captions.map((cue) => cue.end),
    ...cues.flowers.map((cue) => cue.end),
    0.2,
  );
  spanRef.current = span;
  const marks = useMemo(() => rulerMarks(span, zoom), [span, zoom]);

  const patchLayer = (patch: Partial<FilmLayerStyle>) => {
    setStyle((prev) => ({
      ...prev,
      [layer]: { ...prev[layer], ...patch },
    }));
  };

  const seekTo = (sec: number) => {
    const el = videoRef.current;
    const next = Math.max(0, Math.min(span, sec));
    if (el) el.currentTime = next;
    setTime(next);
  };

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => setPlaying(false));
      return;
    }
    el.pause();
  };

  const firstCue = (id: FilmLayerId) =>
    id === "caption" ? cues.captions[0] : id === "flower" ? cues.flowers[0] : null;

  const moveLayer = (id: FilmLayerId, clientX: number, clientY: number) => {
    const box = stageRef.current?.getBoundingClientRect();
    if (!box || box.width < 8 || box.height < 8) return;
    const next = clampLayerPos(
      id,
      ((clientX - box.left) / box.width) * 100,
      ((clientY - box.top) / box.height) * 100,
    );
    setStyle((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...next },
    }));
  };

  const selectLayer = (id: FilmLayerId) => {
    setLayer(id);
    const currentCue = id === "caption" ? caption : id === "flower" ? flower : null;
    if (id !== "title" && !currentCue) {
      const next = firstCue(id);
      if (next) seekTo(next.start + 0.05);
    }
  };

  const patchCurrentText = (text: string) => {
    if (layer === "title") {
      patchLayer({ text: text.replace(/[《》]/g, "").slice(0, 16) });
      return;
    }
    const key = layer === "caption" ? "captions" : "flowers";
    if (!activeCue) return;
    setCues((prev) => ({
      ...prev,
      [key]: prev[key].map((row) =>
        row.start === activeCue.start && row.end === activeCue.end
          ? { ...row, line: text }
          : row,
      ),
    }));
  };

  const seekFromRail = (event: MouseEvent<HTMLElement>, rail: HTMLElement) => {
    const box = rail.getBoundingClientRect();
    if (box.width < 8) return;
    seekTo(((event.clientX - box.left) / box.width) * span);
  };

  const applyZoom = (next: number, pinPlayhead = false) => {
    const el = scrollRef.current;
    const prev = zoomRef.current;
    const z = clampZoom(next);
    const mid = el ? el.scrollLeft + el.clientWidth / 2 : 0;
    const at = el && prev > 0 ? mid / (el.clientWidth * prev) : 0.5;
    setZoom(z);
    requestAnimationFrame(() => {
      const rail = scrollRef.current;
      if (!rail) return;
      if (pinPlayhead) {
        const x = (time / spanRef.current) * rail.clientWidth * z;
        rail.scrollLeft = x - rail.clientWidth / 2;
        return;
      }
      rail.scrollLeft = at * rail.clientWidth * z - rail.clientWidth / 2;
    });
  };

  const save = async (burn: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/articles/${articleId}/video-script/captions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            episodeId,
            style,
            cues,
            burn,
          }),
        },
      );
      const data = (await res.json()) as {
        error?: string;
        videoUrl?: string;
      };
      if (!res.ok) throw new Error(data.error || "保存失败");
      if (burn && data.videoUrl) {
        onApplied(data.videoUrl);
        onClose();
        return;
      }
      setHint("样式已记下。画布就是效果，导出后成片文件才会换。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (zoomReady.current) return;
    const el = scrollRef.current;
    if (!el || cues.captions.length < 1 || span < 0.3) return;
    if (el.clientWidth < 40) return;
    const next = suggestZoom(span, cues.captions, el.clientWidth);
    setZoom(next);
    zoomReady.current = true;
  }, [cues.captions, span]);

  useEffect(() => {
    if (!playing) return;
    const el = scrollRef.current;
    if (!el) return;
    const inner = el.clientWidth * zoom;
    const x = (time / span) * inner;
    const left = el.scrollLeft;
    const right = left + el.clientWidth;
    if (x < left + 56 || x > right - 56) {
      el.scrollLeft = x - el.clientWidth * 0.35;
    }
  }, [time, playing, zoom, span]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursor = event.clientX - rect.left + el.scrollLeft;
      const inner = el.clientWidth * zoomRef.current;
      const at = (cursor / Math.max(inner, 1)) * spanRef.current;
      const next = clampZoom(
        zoomRef.current * (event.deltaY > 0 ? 0.82 : 1.22),
      );
      setZoom(next);
      requestAnimationFrame(() => {
        const nextInner = el.clientWidth * next;
        el.scrollLeft = (at / spanRef.current) * nextInner - (event.clientX - rect.left);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.code === "Space") {
        event.preventDefault();
        const el = videoRef.current;
        if (!el) return;
        if (el.paused) {
          void el.play().catch(() => setPlaying(false));
          return;
        }
        el.pause();
        return;
      }
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        setZoom(clampZoom(zoomRef.current * 1.22));
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoom(clampZoom(zoomRef.current / 1.22));
      }
      if (event.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timeRaf.current) cancelAnimationFrame(timeRaf.current);
    };
  }, []);

  const body = (
    <div className="film-edit" role="dialog" aria-label="编辑成片">
      <div className="film-edit-card">
        <header className="film-edit-head">
          <button
            type="button"
            className="film-edit-icon"
            onClick={onClose}
            disabled={busy}
            title="关闭"
            aria-label="关闭"
          >
            <FeIcon name="close" />
          </button>
          <div className="film-edit-brand">
            <strong>字效</strong>
            <span>{seriesTitle ? `《${seriesTitle}》` : "成片"}</span>
          </div>
          <div className="film-edit-clock" aria-hidden>
            {timecode(time)}
            <em>/</em>
            {timecode(span)}
          </div>
          <div className="film-edit-head-acts">
            <button
              type="button"
              className="film-edit-icon"
              onClick={() => void save(false)}
              disabled={busy || loading}
              title="记下样式"
              aria-label="记下样式"
            >
              <FeIcon name="save" />
            </button>
            <button
              type="button"
              className="film-edit-export"
              onClick={() => void save(true)}
              disabled={busy || loading}
            >
              <FeIcon name="export" />
              {busy ? "导出中…" : "导出成片"}
            </button>
          </div>
        </header>

        <div className="film-edit-body">
          <section className="film-edit-viewer">
            <div className="film-edit-stage-wrap">
              <div className="film-edit-stage" ref={stageRef}>
                {previewUrl ? (
                  <video
                    ref={videoRef}
                    src={previewUrl}
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(event) => {
                      setDuration(event.currentTarget.duration || 0);
                      const first = cues.captions[0] || cues.flowers[0];
                      if (first) seekTo(first.start + 0.05);
                    }}
                    onTimeUpdate={(event) => {
                      timeHold.current = event.currentTarget.currentTime;
                      if (timeRaf.current) return;
                      timeRaf.current = requestAnimationFrame(() => {
                        timeRaf.current = 0;
                        setTime(timeHold.current);
                      });
                    }}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={() => setPlaying(false)}
                  >
                    <track kind="captions" srcLang="zh" label="字幕" />
                  </video>
                ) : (
                  <span className="film-edit-empty">
                    {error || (loading ? "正在打开预览…" : "没有可预览的成片")}
                  </span>
                )}
                {previewUrl
                  ? LAYERS.map((row) => {
                      const item = style[row.id];
                      const text = layerText(row.id, style, caption, flower);
                      if (!item.on || !text) return null;
                      return (
                        <div
                          key={row.id}
                          className={`film-layer${layer === row.id ? " is-on" : ""}${
                            dragging === row.id ? " is-drag" : ""
                          }`}
                          style={{
                            left: `${item.x ?? 50}%`,
                            top: `${item.y}%`,
                            color: item.color,
                            fontFamily: filmFontMeta(item.font).css,
                            fontSize: `${Math.max(14, item.size * scale)}px`,
                            textShadow: [
                              `-2px -2px 0 ${item.stroke}`,
                              `2px -2px 0 ${item.stroke}`,
                              `-2px 2px 0 ${item.stroke}`,
                              `2px 2px 0 ${item.stroke}`,
                              "0 3px 8px rgba(0,0,0,.4)",
                            ].join(","),
                          }}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            event.currentTarget.setPointerCapture(event.pointerId);
                            dragRef.current = row.id;
                            setDragging(row.id);
                            setLayer(row.id);
                            moveLayer(row.id, event.clientX, event.clientY);
                          }}
                          onPointerMove={(event) => {
                            if (dragRef.current !== row.id) return;
                            moveLayer(row.id, event.clientX, event.clientY);
                          }}
                          onPointerUp={() => {
                            dragRef.current = null;
                            setDragging(null);
                          }}
                          onPointerCancel={() => {
                            dragRef.current = null;
                            setDragging(null);
                          }}
                        >
                          {text}
                        </div>
                      );
                    })
                  : null}
              </div>
            </div>
            <div className="film-edit-transport">
              <button
                type="button"
                className="film-edit-play"
                onClick={() => seekTo(0)}
                disabled={!previewUrl}
                title="回到开头"
                aria-label="回到开头"
              >
                <FeIcon name="toStart" />
              </button>
              <button
                type="button"
                className="film-edit-play is-main"
                onClick={togglePlay}
                disabled={!previewUrl}
                title={playing ? "暂停" : "播放"}
                aria-label={playing ? "暂停" : "播放"}
              >
                <FeIcon name={playing ? "pause" : "play"} />
              </button>
              <span>{timecode(time)}</span>
              <input
                type="range"
                min={0}
                max={span}
                step={0.05}
                value={Math.min(time, span)}
                onChange={(event) => seekTo(Number(event.target.value))}
                disabled={!previewUrl}
              />
              <span>{timecode(span)}</span>
            </div>
          </section>

          <aside className="film-edit-side">
            <div className="film-edit-side-kicker">图层</div>
            <div className="film-edit-layers">
              {LAYERS.map((row) => (
                <div
                  key={row.id}
                  className={`film-edit-layer${layer === row.id ? " is-on" : ""}`}
                >
                  <button
                    type="button"
                    className="film-edit-layer-pick"
                    onClick={() => selectLayer(row.id)}
                  >
                    <i className={`film-edit-swatch-dot is-${row.id}`} />
                    <FeIcon name={row.id} />
                    <strong>{row.label}</strong>
                  </button>
                  <button
                    type="button"
                    className={`film-edit-eye${style[row.id].on ? "" : " is-off"}`}
                    title={style[row.id].on ? "隐藏" : "显示"}
                    aria-label={style[row.id].on ? `隐藏${row.label}` : `显示${row.label}`}
                    onClick={() =>
                      setStyle((prev) => ({
                        ...prev,
                        [row.id]: { ...prev[row.id], on: !prev[row.id].on },
                      }))
                    }
                  >
                    <FeIcon name={style[row.id].on ? "eye" : "eyeOff"} />
                  </button>
                </div>
              ))}
            </div>

            <div className="film-edit-side-kicker">属性</div>
            <div className="film-edit-pane">
              <label className="film-edit-field is-wide">
                <span>
                  {layer === "title"
                    ? "文本"
                    : activeCue
                      ? `${timecode(activeCue.start)} – ${timecode(activeCue.end)}`
                      : "当前没有字"}
                </span>
                <textarea
                  rows={2}
                  value={
                    layer === "title"
                      ? current.text
                      : layerText(layer, style, caption, flower)
                  }
                  disabled={
                    layer !== "title" &&
                    !layerText(layer, style, caption, flower)
                  }
                  onChange={(event) => patchCurrentText(event.target.value)}
                  placeholder={
                    layer === "title"
                      ? "剧本名"
                      : layer === "caption"
                        ? "这一秒的对白"
                        : "这一秒的花字"
                  }
                />
              </label>
              <label className="film-edit-field">
                <span>字体</span>
                <select
                  value={current.font}
                  onChange={(event) =>
                    patchLayer({
                      font: event.target.value as FilmLayerStyle["font"],
                    })
                  }
                >
                  {FILM_FONT_OPTIONS.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="film-edit-field">
                <span>颜色</span>
                <div className="film-edit-swatches">
                  {FILM_COLOR_PRESETS.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className={`film-edit-chip${
                        current.color === row.value ? " is-on" : ""
                      }`}
                      style={{ background: row.value }}
                      title={row.label}
                      onClick={() => patchLayer({ color: row.value })}
                    />
                  ))}
                  <input
                    type="color"
                    value={current.color}
                    onChange={(event) =>
                      patchLayer({ color: event.target.value })
                    }
                  />
                </div>
              </div>
              <label className="film-edit-field">
                <span>字号 {current.size}</span>
                <input
                  type="range"
                  min={limits.size[0]}
                  max={limits.size[1]}
                  value={current.size}
                  onChange={(event) =>
                    patchLayer({ size: Number(event.target.value) })
                  }
                />
              </label>
              <label className="film-edit-field">
                <span>X {Math.round(current.x ?? 50)}</span>
                <input
                  type="range"
                  min={limits.x[0]}
                  max={limits.x[1]}
                  value={current.x ?? 50}
                  onChange={(event) =>
                    patchLayer({ x: Number(event.target.value) })
                  }
                />
              </label>
              <label className="film-edit-field">
                <span>Y {Math.round(current.y)}</span>
                <input
                  type="range"
                  min={limits.y[0]}
                  max={limits.y[1]}
                  value={current.y}
                  onChange={(event) =>
                    patchLayer({ y: Number(event.target.value) })
                  }
                />
              </label>
            </div>
            <p className={error ? "film-edit-error" : "film-edit-hint"}>
              {error || hint || "画布上按住文字拖。时间轴可缩放。"}
            </p>
          </aside>
        </div>

        <section className="film-edit-timeline">
          <div className="film-edit-tl-row">
            <div className="film-edit-tl-gutter">
              <div className="film-edit-ruler-spacer" />
              {LAYERS.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`film-edit-track-name${layer === row.id ? " is-on" : ""}`}
                  onClick={() => selectLayer(row.id)}
                >
                  <FeIcon name={row.id} />
                  {row.label}
                </button>
              ))}
            </div>
            <div className="film-edit-tl-scroll" ref={scrollRef}>
              <div
                className="film-edit-tl-inner"
                style={{ width: `${zoom * 100}%` }}
              >
                <div className="film-edit-ruler" aria-hidden>
                  {marks.map((mark) => (
                    <span
                      key={`mark-${mark.t}`}
                      style={{ left: `${(mark.t / span) * 100}%` }}
                    >
                      {mark.label}
                    </span>
                  ))}
                </div>
                {LAYERS.map((row) => {
                  const blocks =
                    row.id === "title"
                      ? style.title.on && style.title.text
                        ? [
                            {
                              start: 0,
                              end: span,
                              line: formatFilmTitle(style.title.text),
                            },
                          ]
                        : []
                      : row.id === "caption"
                        ? cues.captions
                        : cues.flowers;
                  return (
                    <div
                      key={row.id}
                      className={`film-edit-rail${layer === row.id ? " is-on" : ""}`}
                      role="slider"
                      tabIndex={0}
                      aria-label={`${row.label}时间轴`}
                      aria-valuemin={0}
                      aria-valuemax={span}
                      aria-valuenow={time}
                      onClick={(event) =>
                        seekFromRail(event, event.currentTarget)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "ArrowLeft") seekTo(time - 0.2);
                        if (event.key === "ArrowRight") seekTo(time + 0.2);
                        if (event.key === "Home") seekTo(0);
                        if (event.key === "End") seekTo(span);
                      }}
                    >
                      {blocks.map((cue) => (
                        <button
                          key={`${row.id}-${cue.start}-${cue.end}-${cue.line}`}
                          type="button"
                          className={`film-edit-clip is-${row.id}${
                            layer === row.id &&
                            (row.id === "title" ||
                              (activeCue?.start === cue.start &&
                                activeCue?.end === cue.end))
                              ? " is-on"
                              : ""
                          }`}
                          style={{
                            left: `${(cue.start / span) * 100}%`,
                            width: `${Math.max(0.8, ((cue.end - cue.start) / span) * 100)}%`,
                          }}
                          title={cue.line}
                          onClick={(event) => {
                            event.stopPropagation();
                            setLayer(row.id);
                            seekTo(cue.start + 0.05);
                          }}
                        >
                          {cue.line}
                        </button>
                      ))}
                      <i
                        className="film-edit-head-line"
                        style={{
                          left: `${Math.min(100, (time / span) * 100)}%`,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="film-edit-tl-zoom">
            <button
              type="button"
              className="film-edit-icon is-tiny"
              onClick={() => applyZoom(zoom / 1.25)}
              title="缩小"
              aria-label="缩小时间轴"
            >
              <FeIcon name="minus" />
            </button>
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={0.1}
              value={zoom}
              onChange={(event) => applyZoom(Number(event.target.value))}
              aria-label="时间轴缩放"
            />
            <button
              type="button"
              className="film-edit-icon is-tiny"
              onClick={() => applyZoom(zoom * 1.25)}
              title="放大"
              aria-label="放大时间轴"
            >
              <FeIcon name="plus" />
            </button>
            <button
              type="button"
              className="film-edit-icon is-tiny"
              onClick={() => applyZoom(1, true)}
              title="看全片"
              aria-label="时间轴适应窗口"
            >
              <FeIcon name="fit" />
            </button>
            <em>{zoom.toFixed(1)}×</em>
            <span>滚轮平移 · ⌘/Ctrl + 滚轮缩放</span>
          </div>
        </section>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(body, document.body);
}
