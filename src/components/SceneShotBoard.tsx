"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { captionSource, revealCaption } from "@/lib/ai/caption-reveal";
import {
  JOIN_LABEL,
  SHOT_BEATS,
  SOUND_ROLE_LABEL,
  inferSoundRole,
  type ShotEmotionBeat,
} from "@/lib/ai/emotion-beat";
import {
  SHOT_JOINS,
  SHOT_SOUND_ROLES,
  defaultRefShotIndex,
  shotEndUrl,
  shotHasKeyframes,
  shotStartUrl,
  SHOT_ANGLES,
  SHOT_SIZES,
  shotCanLipSync,
  shotFramesApproved,
  type ShotPlate,
  type VideoShot,
  type VideoSpeakMode,
} from "@/lib/types";
import { inferShotPlate } from "@/lib/ai/shot-plate";
import { reviewShotPullSheet, shotQaLabel } from "@/lib/ai/shot-qa";
import {
  NARRATOR_SPEAKER_ID,
  resolveShotSpeakerId,
} from "@/lib/ai/tts-voice-ids";

export type SceneBoardProgress = {
  current: number;
  total: number;
  done: number;
  message: string;
  kind?: "scene" | "speech" | "video";
};

type SpeakerOption = { id: string; name: string };

function videoInFullscreen(el: HTMLVideoElement | null) {
  if (!el) return false;
  if (document.fullscreenElement === el) return true;
  const webkit = el as HTMLVideoElement & {
    webkitDisplayingFullscreen?: boolean;
  };
  return Boolean(webkit.webkitDisplayingFullscreen);
}

function enterVideoFullscreen(el: HTMLVideoElement | null) {
  if (!el || videoInFullscreen(el)) return;
  const any = el as HTMLVideoElement & {
    requestFullscreen?: () => Promise<void>;
    webkitEnterFullscreen?: () => void;
  };
  if (typeof any.requestFullscreen === "function") {
    void any.requestFullscreen().catch(() => {
      any.webkitEnterFullscreen?.();
    });
    return;
  }
  any.webkitEnterFullscreen?.();
}

type Props = {
  shots: VideoShot[];
  speakers?: SpeakerOption[];
  speakMode?: VideoSpeakMode;
  progress?: SceneBoardProgress | null;
  onSpeakerChange?: (shot: VideoShot, speakerId: string) => void;
  onRegenShot?: (
    shot: VideoShot,
    opts?: { refShotIndex?: number },
  ) => void;
  onRegenClip?: (shot: VideoShot) => void;
  onApproveFrames?: (shot: VideoShot) => void;
  onSwapClip?: (shot: VideoShot) => void;
  onLipSync?: (shot: VideoShot) => void;
  onRewriteCopy?: (shot: VideoShot, intent: "visual" | "emotion") => void;
  onPatchShot?: (
    shot: VideoShot,
    patch: Partial<
      Pick<
        VideoShot,
        | "beat"
        | "look"
        | "visual"
        | "onScreen"
        | "soundRole"
        | "delivery"
        | "join"
        | "plate"
      >
    >,
  ) => void;
  onDeleteShot?: (shot: VideoShot) => void;
  copyBusy?: { index: number; intent: "visual" | "emotion" } | null;
  onCompose?: () => void;
  composeDisabled?: boolean;
  composeTitle?: string;
  regenDisabled?: boolean;
  filmUrl?: string | null;
  filmTitle?: string;
  filmRegenerating?: boolean;
  onEditCaptions?: () => void;
};

function shotLine(shot: VideoShot) {
  if (!shot.voiceover) return "";
  if (shot.speaker && shot.speaker !== "旁白") {
    return shot.delivery === "inner"
      ? `${shot.speaker}（内心${shot.innerLevel === "high" ? "·炸" : shot.innerLevel === "mid" ? "·震" : shot.innerLevel === "low" ? "·压" : ""}）：${shot.voiceover}`
      : `${shot.speaker}：${shot.voiceover}`;
  }
  return shot.voiceover;
}

const BEAT_META: Record<
  ShotEmotionBeat,
  { icon: ShotIconName; title: string }
> = {
  钩: { icon: "hook", title: "钩：开场扎人" },
  共: { icon: "resonate", title: "共：这就是我" },
  顶: { icon: "clash", title: "顶：对手压他" },
  打: { icon: "hit", title: "打：反转打脸" },
  停: { icon: "hold", title: "停：反应留白" },
};

type ShotIconName =
  | "hook"
  | "resonate"
  | "clash"
  | "hit"
  | "hold"
  | "rewrite"
  | "emotion"
  | "image"
  | "video"
  | "lipsync"
  | "delete";

function ShotIcon({ name }: { name: ShotIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "hook" ? (
        <>
          <path d="M14.2 4.8v9.4a3.4 3.4 0 1 1-3.4-3.4" />
          <circle cx="14.2" cy="4.8" r="1.15" fill="currentColor" stroke="none" />
        </>
      ) : null}
      {name === "resonate" ? (
        <>
          <circle cx="9" cy="8.4" r="2.4" />
          <circle cx="15" cy="8.4" r="2.4" />
          <path d="M5.6 18.6c.7-2.8 2.5-4.2 4.2-4.2.9 0 1.7.4 2.2 1 .5-.6 1.3-1 2.2-1 1.7 0 3.5 1.4 4.2 4.2" />
        </>
      ) : null}
      {name === "clash" ? (
        <>
          <path d="M12 4.8v8.2" />
          <path d="M8.2 9.2 12 4.8l3.8 4.4" />
          <path d="M6 19h12" />
        </>
      ) : null}
      {name === "hit" ? (
        <>
          <path d="M12 3.8v3.6M12 16.6v3.6M3.8 12h3.6M16.6 12h3.6" />
          <path d="M6.6 6.6l2.2 2.2M15.2 15.2l2.2 2.2M17.4 6.6l-2.2 2.2M6.6 17.4l2.2-2.2" />
        </>
      ) : null}
      {name === "hold" ? <path d="M9 7v10M15 7v10" /> : null}
      {name === "rewrite" ? (
        <>
          <rect x="3.6" y="6" width="11.6" height="11.2" rx="1.4" />
          <path d="M15.2 13.2 19.8 8.6 21 9.8l-4.6 4.6H15.2v-1.2z" />
        </>
      ) : null}
      {name === "emotion" ? (
        <path d="M12 19.2S5.4 14.6 5.4 10.2A3.8 3.8 0 0 1 12 8.4a3.8 3.8 0 0 1 6.6 1.8c0 4.4-6.6 9-6.6 9z" />
      ) : null}
      {name === "image" ? (
        <>
          <rect x="4" y="6" width="16" height="12" rx="1.5" />
          <circle cx="9" cy="10.2" r="1.35" />
          <path d="M5.6 16.4 9.4 12l2.8 2.2 3-3.4 3.8 5.6" />
        </>
      ) : null}
      {name === "video" ? (
        <>
          <rect x="3.6" y="6" width="16.8" height="12" rx="1.5" />
          <path
            d="M10 9.3 15.1 12 10 14.7V9.3z"
            fill="currentColor"
            stroke="none"
          />
        </>
      ) : null}
      {name === "lipsync" ? (
        <>
          <ellipse cx="12" cy="13.2" rx="5.2" ry="3.4" />
          <path d="M7.4 13.2h9.2" />
          <path d="M9.2 8.6c.8-1.4 1.8-2.1 2.8-2.1s2 .7 2.8 2.1" />
        </>
      ) : null}
      {name === "delete" ? (
        <>
          <path d="M5 8h14" />
          <path d="M9.2 8V6.4A1.4 1.4 0 0 1 10.6 5h2.8a1.4 1.4 0 0 1 1.4 1.4V8" />
          <path d="M7.4 8h9.2l-.7 10.2A1.4 1.4 0 0 1 14.5 19.5h-5a1.4 1.4 0 0 1-1.4-1.3L7.4 8z" />
        </>
      ) : null}
    </svg>
  );
}

function ShotCaption({ text }: { text: string }) {
  if (!text) return null;
  const prev = text.slice(0, -1);
  const last = text.slice(-1);
  return (
    <p className="shot-cap">
      {prev}
      <span className="shot-cap-pop" key={text}>
        {last}
      </span>
    </p>
  );
}

function ShotCopyTip({
  shot,
  line,
  compact,
  regenDisabled,
  copyBusy,
  onRewriteCopy,
  onPatchShot,
  onRegenShot,
  onDeleteShot,
  canDelete,
}: {
  shot: VideoShot;
  line: string;
  compact?: boolean;
  regenDisabled?: boolean;
  copyBusy?: { index: number; intent: "visual" | "emotion" } | null;
  onRewriteCopy?: (shot: VideoShot, intent: "visual" | "emotion") => void;
  onPatchShot?: (
    shot: VideoShot,
    patch: Partial<
      Pick<
        VideoShot,
        | "beat"
        | "look"
        | "visual"
        | "onScreen"
        | "soundRole"
        | "delivery"
        | "join"
        | "plate"
      >
    >,
  ) => void;
  onRegenShot?: (shot: VideoShot) => void;
  onDeleteShot?: (shot: VideoShot) => void;
  canDelete?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 320, flip: false });
  const [fresh, setFresh] = useState(false);
  const wasBusy = useRef<"visual" | "emotion" | "">("");
  const busy =
    copyBusy?.index === shot.index
      ? copyBusy.intent === "emotion"
        ? "加情绪中…"
        : "改词中…"
      : "";

  const joinLabel = shot.join ? JOIN_LABEL[shot.join] : "";
  const soundLabel = SOUND_ROLE_LABEL[inferSoundRole(shot)];
  const plate = inferShotPlate(shot);
  const plateLabel = [plate.size, plate.angle, plate.motion]
    .filter(Boolean)
    .join(" · ");
  const canTune = Boolean(
    onPatchShot || onRewriteCopy || onDeleteShot || (compact && onRegenShot),
  );

  const place = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 340), 460);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    const flip = r.bottom + 420 > window.innerHeight && r.top > 420;
    setPos({
      top: flip ? r.top - 8 : r.bottom + 6,
      left,
      width,
      flip,
    });
  };

  const openTip = () => {
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (copyBusy?.index === shot.index) {
      wasBusy.current = copyBusy.intent;
      return;
    }
    if (!wasBusy.current) return;
    wasBusy.current = "";
    setFresh(true);
    openTip();
    const timer = window.setTimeout(() => setFresh(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copyBusy, shot.index]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (wrapRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onResize = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, 340), 460);
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      const flip = r.bottom + 420 > window.innerHeight && r.top > 420;
      setPos({
        top: flip ? r.top - 8 : r.bottom + 6,
        left,
        width,
        flip,
      });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const popover =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popRef}
            className={`shot-tip-pop${pos.flip ? " is-flip" : ""}`}
            role="dialog"
            aria-label={`第 ${shot.index} 镜全文`}
            style={{
              top: pos.top,
              left: pos.left,
              width: pos.width,
              transform: pos.flip ? "translateY(-100%)" : undefined,
            }}
          >
            <div className="shot-tip-kicker">
              第 {shot.index} 镜
              {shot.beat ? ` · ${shot.beat}` : ""}
              {` · ${SOUND_ROLE_LABEL[inferSoundRole(shot)]}`}
              {shot.join ? ` · ${JOIN_LABEL[shot.join]}` : ""}
              {shot.delivery === "inner"
                ? shot.innerLevel === "high"
                  ? " · 内心炸"
                  : shot.innerLevel === "mid"
                    ? " · 内心震"
                    : shot.innerLevel === "low"
                      ? " · 内心压"
                      : " · 内心"
                : ""}
              {shot.look ? ` · ${shot.look}` : ""}
            </div>
            {shot.visual ? <p className="shot-tip-visual">{shot.visual}</p> : null}
            {line ? <p className="shot-tip-line">{line}</p> : null}
            {shot.onScreen ? (
              <p className="shot-tip-flower">花字：{shot.onScreen}</p>
            ) : null}
            {canTune ? (
              <div className="shot-tip-edit">
                {onPatchShot ? (
                  <>
                    <fieldset className="shot-tip-set">
                      <legend>节拍</legend>
                      <div className="shot-edit-beats">
                        {SHOT_BEATS.map((beat) => {
                          const meta = BEAT_META[beat];
                          return (
                            <button
                              key={beat}
                              type="button"
                              className={`shot-edit-beat${
                                shot.beat === beat ? " is-on" : ""
                              }`}
                              data-beat={beat}
                              disabled={Boolean(busy)}
                              title={meta.title}
                              aria-label={meta.title}
                              aria-pressed={shot.beat === beat}
                              onClick={() => onPatchShot(shot, { beat })}
                            >
                              <ShotIcon name={meta.icon} />
                              <span className="shot-edit-label">{beat}</span>
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                    <fieldset className="shot-tip-set">
                      <legend>怎么接</legend>
                      <div className="shot-edit-beats">
                        {SHOT_JOINS.map((join) => (
                          <button
                            key={join}
                            type="button"
                            className={`shot-edit-beat${
                              shot.join === join ? " is-on" : ""
                            }`}
                            disabled={Boolean(busy)}
                            title={JOIN_LABEL[join]}
                            aria-label={JOIN_LABEL[join]}
                            aria-pressed={shot.join === join}
                            onClick={() => onPatchShot(shot, { join })}
                          >
                            <span className="shot-edit-label">
                              {JOIN_LABEL[join]}
                            </span>
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset className="shot-tip-set">
                      <legend>声音</legend>
                      <div className="shot-edit-beats">
                        {SHOT_SOUND_ROLES.map((role) => (
                          <button
                            key={role}
                            type="button"
                            className={`shot-edit-beat${
                              inferSoundRole(shot) === role ? " is-on" : ""
                            }`}
                            disabled={Boolean(busy)}
                            title={SOUND_ROLE_LABEL[role]}
                            aria-label={SOUND_ROLE_LABEL[role]}
                            aria-pressed={inferSoundRole(shot) === role}
                            onClick={() =>
                              onPatchShot(shot, {
                                soundRole: role,
                                delivery:
                                  role === "inner"
                                    ? "inner"
                                    : role === "speak"
                                      ? "line"
                                      : shot.delivery,
                              })
                            }
                          >
                            <span className="shot-edit-label">
                              {SOUND_ROLE_LABEL[role]}
                            </span>
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset className="shot-tip-set">
                      <legend>七要素</legend>
                      <div className="shot-plate-grid">
                        <label>
                          景别
                          <select
                            className="field"
                            value={inferShotPlate(shot).size}
                            disabled={Boolean(busy)}
                            onChange={(e) =>
                              onPatchShot(shot, {
                                plate: {
                                  ...inferShotPlate(shot),
                                  size: e.target.value as ShotPlate["size"],
                                },
                              })
                            }
                          >
                            {SHOT_SIZES.map((size) => (
                              <option key={size} value={size}>
                                {size}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          角度
                          <select
                            className="field"
                            value={inferShotPlate(shot).angle}
                            disabled={Boolean(busy)}
                            onChange={(e) =>
                              onPatchShot(shot, {
                                plate: {
                                  ...inferShotPlate(shot),
                                  angle: e.target.value as ShotPlate["angle"],
                                },
                              })
                            }
                          >
                            {SHOT_ANGLES.map((angle) => (
                              <option key={angle} value={angle}>
                                {angle}
                              </option>
                            ))}
                          </select>
                        </label>
                        {(
                          [
                            ["framing", "构图", "谁占画、看哪里"],
                            ["light", "光影", "怎么打光"],
                            ["grade", "色调", "什么颜色"],
                            ["motion", "动势", "已在说 / 停"],
                          ] as const
                        ).map(([key, label, hint]) => (
                          <label
                            key={key}
                            className={key === "framing" ? "is-wide" : undefined}
                          >
                            {label}
                            <input
                              className="field"
                              value={inferShotPlate(shot)[key]}
                              disabled={Boolean(busy)}
                              placeholder={hint}
                              onChange={(e) =>
                                onPatchShot(shot, {
                                  plate: {
                                    ...inferShotPlate(shot),
                                    [key]: e.target.value,
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </>
                ) : null}
                <div className="shot-tip-actions">
                  {onRewriteCopy ? (
                    <button
                      type="button"
                      className={`shot-edit-act${
                        busy && copyBusy?.intent === "visual" ? " is-busy" : ""
                      }`}
                      disabled={Boolean(busy)}
                      title={
                        busy && copyBusy?.intent === "visual"
                          ? "正在改这一镜怎么拍的文字"
                          : "只改怎么拍的文字，头尾图不会变。要换图再点出图。"
                      }
                      aria-label="改词"
                      onClick={() => onRewriteCopy(shot, "visual")}
                    >
                      <ShotIcon name="rewrite" />
                      <span className="shot-edit-label">改词</span>
                    </button>
                  ) : null}
                  {onRewriteCopy ? (
                    <button
                      type="button"
                      className={`shot-edit-act${
                        busy && copyBusy?.intent === "emotion" ? " is-busy" : ""
                      }`}
                      disabled={Boolean(busy)}
                      title={
                        busy && copyBusy?.intent === "emotion"
                          ? "加情绪中"
                          : "加情绪"
                      }
                      aria-label="加情绪"
                      onClick={() => onRewriteCopy(shot, "emotion")}
                    >
                      <ShotIcon name="emotion" />
                      <span className="shot-edit-label">情绪</span>
                    </button>
                  ) : null}
                  {compact && onRegenShot ? (
                    <button
                      type="button"
                      className="shot-edit-act"
                      disabled={regenDisabled}
                      title={shotHasKeyframes(shot) ? "重出图" : "出图"}
                      aria-label={shotHasKeyframes(shot) ? "重出图" : "出图"}
                      onClick={() => onRegenShot(shot)}
                    >
                      <ShotIcon name="image" />
                      <span className="shot-edit-label">出图</span>
                    </button>
                  ) : null}
                  {onDeleteShot ? (
                    <button
                      type="button"
                      className="shot-edit-act is-danger"
                      disabled={!canDelete || Boolean(busy)}
                      title={canDelete ? "删这一镜" : "至少留一镜"}
                      aria-label="删这一镜"
                      onClick={() => {
                        setOpen(false);
                        onDeleteShot(shot);
                      }}
                    >
                      <ShotIcon name="delete" />
                      <span className="shot-edit-label">删除</span>
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={wrapRef} className="shot-tip">
      <div className="shot-tip-text">
        {compact ? (
          <>
            <p className="shot-review-line">
              {line || shot.visual || "这一镜还没有对白"}
            </p>
            {shot.beat || joinLabel || plateLabel ? (
              <p className="shot-review-meta">
                {[shot.beat, joinLabel, soundLabel, plateLabel]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className="shot-marks">
              {shot.beat ? (
                <span className="shot-beat" data-beat={shot.beat}>
                  {shot.beat}
                </span>
              ) : null}
              {joinLabel ? <span className="shot-join">{joinLabel}</span> : null}
              <span className="shot-sound">{soundLabel}</span>
              {shot.look ? <span className="shot-look">{shot.look}</span> : null}
              {plateLabel ? <span className="shot-plate">{plateLabel}</span> : null}
              {shot.props?.length ? (
                <span className="shot-props">
                  {shot.props.map((name) => (
                    <em key={name}>{name}</em>
                  ))}
                </span>
              ) : null}
            </div>
            <p className={`shot-visual${fresh ? " is-fresh" : ""}`}>
              {shot.visual || " "}
            </p>
            <p className="shot-line">{line || " "}</p>
          </>
        )}
        <button
          type="button"
          className="shot-tip-hit"
          aria-expanded={open}
          aria-label={canTune ? "打开这一镜" : "看这一镜全文"}
          onClick={(e) => {
            e.stopPropagation();
            if (open) setOpen(false);
            else openTip();
          }}
        />
      </div>
      {popover}
    </div>
  );
}

function ReviewIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function SceneShotBoard({
  shots,
  speakers,
  speakMode,
  progress,
  onSpeakerChange,
  onRegenShot,
  onRegenClip,
  onApproveFrames,
  onSwapClip,
  onLipSync,
  onRewriteCopy,
  onPatchShot,
  onDeleteShot,
  copyBusy,
  onCompose,
  composeDisabled,
  composeTitle,
  regenDisabled,
  filmUrl,
  filmTitle,
  filmRegenerating,
  onEditCaptions,
}: Props) {
  const ordered = useMemo(
    () => [...shots].sort((a, b) => a.index - b.index),
    [shots],
  );
  const qaByIndex = useMemo(() => {
    const map = new Map<number, ReturnType<typeof reviewShotPullSheet>[number]>();
    for (const row of reviewShotPullSheet(ordered)) map.set(row.index, row);
    return map;
  }, [ordered]);
  const clips = useMemo(
    () => ordered.filter((shot) => shot.clipUrl?.trim()),
    [ordered],
  );
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [refPick, setRefPick] = useState<Record<number, number>>({});
  const [playing, setPlaying] = useState(false);
  const [shotCap, setShotCap] = useState("");
  const [openCap, setOpenCap] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const openRef = useRef<HTMLVideoElement>(null);
  const stripRef = useRef<HTMLOListElement>(null);
  const advancingRef = useRef(false);
  const keepFsRef = useRef(false);
  const selected = ordered.find((shot) => shot.index === activeIndex);
  const active =
    selected?.clipUrl?.trim()
      ? selected
      : clips.find((shot) => shot.index === activeIndex) ||
        clips[clips.length - 1] ||
        selected ||
        null;
  const clipUrl = active?.clipUrl?.trim() ?? "";
  const clipPos = clips.findIndex((shot) => shot.index === active?.index);
  const shotKey = ordered.map((shot) => shot.index).join(",");
  const clipSig = clips
    .map((shot) => `${shot.index}\t${shot.clipUrl?.trim() || ""}`)
    .join("\n");
  const prevClipSig = useRef("");

  useEffect(() => {
    const el = videoRef.current;
    const line = active ? captionSource(active) : "";
    if (!el || !line) {
      setShotCap("");
      return;
    }
    const tick = () => {
      const dur = el.duration;
      const p = Number.isFinite(dur) && dur > 0 ? el.currentTime / dur : 0;
      setShotCap(revealCaption(line, p));
    };
    tick();
    el.addEventListener("timeupdate", tick);
    el.addEventListener("seeked", tick);
    el.addEventListener("play", tick);
    el.addEventListener("loadedmetadata", tick);
    return () => {
      el.removeEventListener("timeupdate", tick);
      el.removeEventListener("seeked", tick);
      el.removeEventListener("play", tick);
      el.removeEventListener("loadedmetadata", tick);
    };
  }, [active, clipUrl]);

  useEffect(() => {
    const el = openRef.current;
    const shot = openIndex != null ? ordered.find((row) => row.index === openIndex) : null;
    const line = shot ? captionSource(shot) : "";
    if (!el || !line) {
      setOpenCap("");
      return;
    }
    const tick = () => {
      const dur = el.duration;
      const p = Number.isFinite(dur) && dur > 0 ? el.currentTime / dur : 0;
      setOpenCap(revealCaption(line, p));
    };
    tick();
    el.addEventListener("timeupdate", tick);
    el.addEventListener("seeked", tick);
    el.addEventListener("play", tick);
    el.addEventListener("loadedmetadata", tick);
    return () => {
      el.removeEventListener("timeupdate", tick);
      el.removeEventListener("seeked", tick);
      el.removeEventListener("play", tick);
      el.removeEventListener("loadedmetadata", tick);
    };
  }, [openIndex, ordered]);

  useEffect(() => {
    const parse = (raw: string) =>
      new Map(
        raw
          ? raw.split("\n").map((line) => {
              const split = line.indexOf("\t");
              return [
                Number(line.slice(0, split)),
                line.slice(split + 1),
              ] as const;
            })
          : [],
      );
    const prev = parse(prevClipSig.current);
    const next = parse(clipSig);
    const firstMount = !prevClipSig.current;
    prevClipSig.current = clipSig;
    if (firstMount) {
      if (activeIndex > 0 && (next.has(activeIndex) || shotKey.includes(String(activeIndex)))) {
        return;
      }
      const first = next.keys().next().value || 0;
      if (first && first !== activeIndex) setActiveIndex(first);
      return;
    }
    let changed = 0;
    for (const [index, url] of next) {
      if (url && prev.get(index) !== url) changed = index;
    }
    if (changed > 0) {
      setActiveIndex(changed);
      return;
    }
    const exists = shotKey
      .split(",")
      .map((n) => Number(n))
      .includes(activeIndex);
    if (activeIndex > 0 && exists) return;
    const first = next.keys().next().value || 0;
    if (first && first !== activeIndex) setActiveIndex(first);
  }, [activeIndex, clipSig, shotKey]);

  useEffect(() => {
    const review = videoRef.current;
    const enlarged = openRef.current;
    const target = openIndex != null && enlarged ? enlarged : review;
    const other = target === enlarged ? review : enlarged;
    if (other) other.pause();
    if (!target || !clipUrl) return;
    if (playing) {
      void target.play().catch(() => setPlaying(false));
      if (keepFsRef.current) {
        enterVideoFullscreen(target);
        keepFsRef.current = false;
      }
      advancingRef.current = false;
      return;
    }
    target.pause();
  }, [clipUrl, playing, activeIndex, openIndex]);

  useEffect(() => {
    const card = stripRef.current?.querySelector(
      `[data-shot="${active?.index || 0}"]`,
    );
    const strip = stripRef.current;
    if (!strip || !(card instanceof HTMLElement)) return;
    const left = card.offsetLeft - (strip.clientWidth - card.clientWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [active?.index]);

  useEffect(() => {
    if (openIndex == null) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Escape") {
        setOpenIndex(null);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const pos = ordered.findIndex((shot) => shot.index === openIndex);
      const next = ordered[pos + (event.key === "ArrowRight" ? 1 : -1)];
      if (!next) return;
      event.preventDefault();
      setActiveIndex(next.index);
      setOpenIndex(next.index);
      if (!next.clipUrl?.trim()) setPlaying(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, ordered]);

  if (ordered.length === 0) return null;
  const open =
    openIndex == null
      ? null
      : ordered.find((shot) => shot.index === openIndex) || null;

  const selectShot = (shot: VideoShot, playClip: boolean) => {
    setActiveIndex(shot.index);
    if (shot.clipUrl?.trim()) {
      setOpenIndex((cur) => (cur == null ? null : shot.index));
      setPlaying(playClip);
      return;
    }
    setPlaying(false);
    if (shotStartUrl(shot) || shotEndUrl(shot)) setOpenIndex(shot.index);
  };

  const goToClip = (next: VideoShot) => {
    const playingEl = openIndex != null ? openRef.current : videoRef.current;
    keepFsRef.current = videoInFullscreen(playingEl);
    advancingRef.current = true;
    setActiveIndex(next.index);
    setOpenIndex((cur) => (cur == null ? null : next.index));
    setPlaying(true);
  };

  const playAll = () => {
    const first = clips[0];
    if (!first) return;
    const el = openIndex != null ? openRef.current : videoRef.current;
    if (activeIndex === first.index && el) {
      el.currentTime = 0;
      setPlaying(true);
      void el.play().catch(() => setPlaying(false));
      return;
    }
    goToClip(first);
  };

  const jumpClip = (delta: number) => {
    if (clipPos < 0) return;
    const next = clips[clipPos + delta];
    if (!next) return;
    goToClip(next);
  };

  const openPos = open
    ? ordered.findIndex((shot) => shot.index === open.index)
    : -1;
  const prevOpen = openPos > 0 ? ordered[openPos - 1] : null;
  const nextOpen =
    openPos >= 0 && openPos < ordered.length - 1 ? ordered[openPos + 1] : null;
  const goOpenShot = (shot: VideoShot) => {
    setActiveIndex(shot.index);
    setOpenIndex(shot.index);
    if (!shot.clipUrl?.trim()) setPlaying(false);
  };

  const refChoices = (shot: VideoShot) =>
    ordered.filter(
      (row) =>
        row.index !== shot.index &&
        (shotStartUrl(row) || shotEndUrl(row)),
    );
  const refIndexOf = (shot: VideoShot) => {
    const choices = refChoices(shot);
    const picked = refPick[shot.index] ?? defaultRefShotIndex(ordered, shot.index);
    if (picked && choices.some((row) => row.index === picked)) return picked;
    return choices[0]?.index;
  };
  const regenShot = (shot: VideoShot) =>
    onRegenShot?.(shot, { refShotIndex: refIndexOf(shot) });

  return (
    <div className="shot-board">
      {progress && (
        <div className="shot-board-progress">
          <div className="shot-board-progress-row">
            <span>{progress.message}</span>
            <span>
              {progress.done}/{progress.total}
            </span>
          </div>
          <div className="shot-board-bar">
            <div
              className="shot-board-bar-fill"
              style={{
                width: `${Math.min(
                  100,
                  Math.round(
                    (progress.done / Math.max(1, progress.total)) * 100,
                  ),
                )}%`,
              }}
            />
          </div>
        </div>
      )}

      <div className="shot-board-row">
      {clips.length > 0 && active ? (
        <div className="shot-review">
          <div className="shot-review-frame">
            {clipUrl ? (
              <video
                ref={videoRef}
                src={clipUrl}
                poster={shotStartUrl(active) || undefined}
                controls
                playsInline
                preload="auto"
                onEnded={() => {
                  if (clipPos >= 0 && clipPos + 1 < clips.length) {
                    goToClip(clips[clipPos + 1]);
                    return;
                  }
                  setPlaying(false);
                }}
                onPlay={() => setPlaying(true)}
                onPause={(event) => {
                  if (advancingRef.current || event.currentTarget.ended) return;
                  setPlaying(false);
                }}
              />
            ) : shotStartUrl(active) ? (
              <img src={shotStartUrl(active)} alt={`第 ${active.index} 镜`} />
            ) : (
              <span className="shot-empty">这一镜还没出片</span>
            )}
            <ShotCaption text={shotCap} />
          </div>
          <div className="shot-review-copy">
            <div className="shot-review-kicker">
              第 {active.index} 镜 · {Math.max(clipPos, 0) + 1}/{clips.length}
              {clips.length < ordered.length
                ? ` · 还差 ${ordered.length - clips.length}`
                : ""}
            </div>
            <ShotCopyTip
              shot={active}
              line={shotLine(active)}
              compact
            />
            <div className="shot-review-actions">
              <button
                type="button"
                className="shot-review-icon is-primary"
                title={playing && clipPos === 0 ? "重头连播" : "按镜连播"}
                aria-label={playing && clipPos === 0 ? "重头连播" : "按镜连播"}
                onClick={playAll}
              >
                {playing && clipPos === 0 ? (
                  <ReviewIcon>
                    <path d="M7 7.5v9" />
                    <path d="M10 8.2 18 12l-8 3.8V8.2z" fill="currentColor" stroke="none" />
                  </ReviewIcon>
                ) : (
                  <ReviewIcon>
                    <path d="M8 7.2 17.2 12 8 16.8V7.2z" fill="currentColor" stroke="none" />
                  </ReviewIcon>
                )}
              </button>
              <button
                type="button"
                className="shot-review-icon"
                title={playing ? "暂停" : "继续"}
                aria-label={playing ? "暂停" : "继续"}
                disabled={!clipUrl}
                onClick={() => setPlaying((on) => !on)}
              >
                {playing ? (
                  <ReviewIcon>
                    <path d="M9 7.5v9M15 7.5v9" />
                  </ReviewIcon>
                ) : (
                  <ReviewIcon>
                    <path d="M9 7.2 16.5 12 9 16.8V7.2z" fill="currentColor" stroke="none" />
                  </ReviewIcon>
                )}
              </button>
              <button
                type="button"
                className="shot-review-icon"
                title="上一镜"
                aria-label="上一镜"
                disabled={clipPos <= 0}
                onClick={() => jumpClip(-1)}
              >
                <ReviewIcon>
                  <path d="M7 7.5v9" />
                  <path d="M17 7.5 10 12l7 4.5V7.5z" fill="currentColor" stroke="none" />
                </ReviewIcon>
              </button>
              <button
                type="button"
                className="shot-review-icon"
                title={openIndex == null ? "放大看" : "已在放大"}
                aria-label={openIndex == null ? "放大看" : "已在放大"}
                disabled={!active}
                onClick={() => {
                  if (!active) return;
                  setOpenIndex(active.index);
                }}
              >
                <ReviewIcon>
                  <path d="M8 8h3.2M8 8v3.2M16 8h-3.2M16 8v3.2M8 16h3.2M8 16v-3.2M16 16h-3.2M16 16v-3.2" />
                </ReviewIcon>
              </button>
              <button
                type="button"
                className="shot-review-icon"
                title="下一镜"
                aria-label="下一镜"
                disabled={clipPos < 0 || clipPos >= clips.length - 1}
                onClick={() => jumpClip(1)}
              >
                <ReviewIcon>
                  <path d="M17 7.5v9" />
                  <path d="M7 7.5 14 12l-7 4.5V7.5z" fill="currentColor" stroke="none" />
                </ReviewIcon>
              </button>
              {onCompose ? (
                <button
                  type="button"
                  className="shot-review-icon is-primary"
                  title={
                    composeTitle ||
                    (clips.length < ordered.length
                      ? `还差 ${ordered.length - clips.length} 镜才能合成`
                      : "合成成片")
                  }
                  aria-label={composeTitle || "合成成片"}
                  disabled={
                    composeDisabled ||
                    regenDisabled ||
                    clips.length < ordered.length
                  }
                  onClick={onCompose}
                >
                  <ReviewIcon>
                    <rect x="4.5" y="8" width="8" height="9" rx="1.2" />
                    <rect x="11.5" y="6" width="8" height="9" rx="1.2" />
                  </ReviewIcon>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <ol className="shot-board-strip" ref={stripRef}>
        {ordered.map((shot) => {
          const making =
            Boolean(progress) && progress?.current === shot.index;
          const sceneMaking =
            making && progress?.kind !== "video" && progress?.kind !== "speech";
          const clipMaking = making && progress?.kind === "video";
          const current = active?.index === shot.index;
          const startUrl = shotStartUrl(shot);
          const endUrl = shotEndUrl(shot);
          const hasFrame = Boolean(startUrl || endUrl || shot.clipUrl);
          return (
            <li
              key={shot.index}
              data-shot={shot.index}
              className={`shot-card${current ? " is-current" : ""}`}
            >
              <button
                type="button"
                className={`shot-frame is-pair${making ? " is-making" : ""}${
                  hasFrame ? "" : " is-empty"
                }`}
                onClick={() => {
                  if (!hasFrame) return;
                  selectShot(shot, Boolean(shot.clipUrl));
                }}
                disabled={!hasFrame}
              >
                <span className="shot-kf-row">
                  <span className="shot-kf">
                    {startUrl ? (
                      <img src={startUrl} alt={`第 ${shot.index} 镜开头`} />
                    ) : (
                      <span className="shot-empty">
                        {sceneMaking ? "出头" : "头"}
                      </span>
                    )}
                    <span className="shot-kf-label">头</span>
                  </span>
                  <span className="shot-kf">
                    {endUrl ? (
                      <img src={endUrl} alt={`第 ${shot.index} 镜结尾`} />
                    ) : (
                      <span className="shot-empty">
                        {sceneMaking ? "出尾" : "尾"}
                      </span>
                    )}
                    <span className="shot-kf-label">尾</span>
                  </span>
                </span>
                {making && hasFrame ? (
                  <span className="shot-making">
                    {clipMaking
                      ? progress?.message.includes("口型")
                        ? "对口型中"
                        : "出片中"
                      : "重出中"}
                  </span>
                ) : null}
                <span className="shot-no">
                  {String(shot.index).padStart(2, "0")}
                </span>
                <span className="shot-dur">{shot.seconds}s</span>
                {shot.framesOk ? <span className="shot-clip">过</span> : null}
                {shot.clipUrl ? <span className="shot-clip">片</span> : null}
                {shot.clipAltUrl ? <span className="shot-clip">2</span> : null}
                {shot.onScreen ? (
                  <span className="shot-flower">{shot.onScreen}</span>
                ) : null}
              </button>
              <div className="shot-copy">
                <ShotCopyTip
                  shot={shot}
                  line={shotLine(shot)}
                  regenDisabled={regenDisabled}
                  copyBusy={copyBusy}
                  onRewriteCopy={onRewriteCopy}
                  onPatchShot={onPatchShot}
                  onRegenShot={onRegenShot ? regenShot : undefined}
                  onDeleteShot={
                    onDeleteShot
                      ? (row) => {
                          if (openIndex === row.index) setOpenIndex(null);
                          onDeleteShot(row);
                        }
                      : undefined
                  }
                  canDelete={ordered.length > 1}
                />
                {qaByIndex.get(shot.index)?.flags.length ? (
                  <p className="shot-qa">
                    {qaByIndex.get(shot.index)?.flags.map((flag) => (
                      <span key={flag}>{shotQaLabel(flag)}</span>
                    ))}
                  </p>
                ) : null}
                <div className="shot-toolbar">
                  {onSpeakerChange && speakers && speakers.length > 0 ? (
                    <select
                      className="shot-speaker"
                      value={resolveShotSpeakerId(shot, speakers, speakMode)}
                      disabled={regenDisabled}
                      title="这镜谁在说话"
                      onChange={(e) => onSpeakerChange(shot, e.target.value)}
                    >
                      {speakers.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.id === NARRATOR_SPEAKER_ID
                            ? "旁白"
                            : person.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="shot-speaker is-spacer" aria-hidden />
                  )}
                  <div className="shot-actions">
                    {onRegenShot && refChoices(shot).length > 0 ? (
                      <select
                        className="shot-ref"
                        value={refIndexOf(shot) || ""}
                        disabled={regenDisabled || sceneMaking}
                        title="重出图时参考哪一镜"
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setRefPick((cur) => ({
                            ...cur,
                            [shot.index]: next,
                          }));
                        }}
                      >
                        {refChoices(shot).map((row) => (
                          <option key={row.index} value={row.index}>
                            参考第{row.index}镜
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {onRegenShot ? (
                      <button
                        type="button"
                        className={`shot-regen${sceneMaking ? " is-busy" : ""}`}
                        disabled={regenDisabled || sceneMaking}
                        title={
                          sceneMaking
                            ? "出图中"
                            : shotHasKeyframes(shot)
                              ? "按上面的描述重出头尾图"
                              : "按上面的描述出头尾图"
                        }
                        aria-label={
                          sceneMaking
                            ? "出图中"
                            : shotHasKeyframes(shot)
                              ? "重出图"
                              : "出图"
                        }
                        onClick={() => regenShot(shot)}
                      >
                        <ShotIcon name="image" />
                        <span className="shot-edit-label">出图</span>
                      </button>
                    ) : null}
                    {onApproveFrames && shotHasKeyframes(shot) ? (
                      <button
                        type="button"
                        className={`shot-regen${shot.framesOk ? " is-on" : ""}`}
                        disabled={regenDisabled || shot.framesOk}
                        title={
                          shot.framesOk
                            ? "这镜头尾已过片"
                            : "头尾图没问题，过片后才能出视频"
                        }
                        aria-label={shot.framesOk ? "已过片" : "过片"}
                        onClick={() => onApproveFrames(shot)}
                      >
                        <span className="shot-edit-label">
                          {shot.framesOk ? "已过片" : "过片"}
                        </span>
                      </button>
                    ) : null}
                    {onRegenClip ? (
                      <button
                        type="button"
                        className={`shot-regen${clipMaking ? " is-busy" : ""}`}
                        disabled={
                          regenDisabled ||
                          clipMaking ||
                          !shotFramesApproved(shot)
                        }
                        title={
                          clipMaking
                            ? "出片中"
                            : !shotHasKeyframes(shot)
                              ? "先出头尾图"
                              : !shot.framesOk
                                ? "先过片再出视频"
                                : shot.clipUrl
                                  ? "重出视频（两条）"
                                  : "出视频（两条）"
                        }
                        aria-label={
                          clipMaking
                            ? "出片中"
                            : shot.clipUrl
                              ? "重出视频"
                              : "出视频"
                        }
                        onClick={() => onRegenClip(shot)}
                      >
                        <ShotIcon name="video" />
                        <span className="shot-edit-label">出片</span>
                      </button>
                    ) : null}
                    {onSwapClip && shot.clipAltUrl ? (
                      <button
                        type="button"
                        className="shot-regen"
                        disabled={regenDisabled || clipMaking}
                        title="换成同镜另一条"
                        aria-label="换一条"
                        onClick={() => onSwapClip(shot)}
                      >
                        <span className="shot-edit-label">换一条</span>
                      </button>
                    ) : null}
                    {onLipSync ? (
                      <button
                        type="button"
                        className={`shot-regen${clipMaking ? " is-busy" : ""}`}
                        disabled={
                          regenDisabled ||
                          clipMaking ||
                          !shotCanLipSync(shot)
                        }
                        title={
                          clipMaking && progress?.message.includes("口型")
                            ? "对口型中"
                            : shot.delivery === "inner"
                              ? "内心独白不用对口型"
                              : shot.clipUrl
                                ? "用成片声音对口型，不换配音"
                                : "先出片再对口型"
                        }
                        aria-label="对口型"
                        onClick={() => onLipSync(shot)}
                      >
                        <ShotIcon name="lipsync" />
                        <span className="shot-edit-label">对口型</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {filmUrl ? (
        <div className="shot-film">
          <div className="shot-review-frame">
            <video
              key={filmUrl}
              src={filmUrl}
              controls
              playsInline
              preload="metadata"
            />
            {filmRegenerating ? (
              <span className="shot-making">上一版，正在重出</span>
            ) : null}
          </div>
          <div className="shot-review-copy">
            <div className="shot-review-kicker">{filmTitle || "成片预览"}</div>
            {onEditCaptions ? (
              <button
                type="button"
                className="btn btn-ghost text-xs"
                onClick={onEditCaptions}
              >
                编辑
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      </div>

      {open && (
        <div
          className="shot-lightbox"
          role="dialog"
          aria-label={`第 ${open.index} 镜`}
          onClick={() => setOpenIndex(null)}
        >
          <button
            type="button"
            className="shot-lightbox-side is-prev"
            disabled={!prevOpen}
            title={prevOpen ? `上一镜，第 ${prevOpen.index} 镜` : "已经是第一镜"}
            aria-label="上一镜"
            onClick={(e) => {
              e.stopPropagation();
              if (prevOpen) goOpenShot(prevOpen);
            }}
          >
            上一镜
          </button>
          <div
            className="shot-lightbox-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shot-lightbox-frame">
              {open.clipUrl ? (
                <video
                  ref={openRef}
                  src={open.clipUrl}
                  poster={shotStartUrl(open) || undefined}
                  controls
                  playsInline
                  preload="auto"
                  onEnded={() => {
                    const pos = clips.findIndex(
                      (shot) => shot.index === open.index,
                    );
                    if (pos >= 0 && pos + 1 < clips.length) {
                      goToClip(clips[pos + 1]);
                      return;
                    }
                    setPlaying(false);
                  }}
                  onPlay={() => setPlaying(true)}
                  onPause={(event) => {
                    if (advancingRef.current || event.currentTarget.ended)
                      return;
                    setPlaying(false);
                  }}
                />
              ) : (
                <div className="shot-lightbox-pair">
                  {shotStartUrl(open) ? (
                    <img
                      src={shotStartUrl(open)}
                      alt={`第 ${open.index} 镜开头`}
                    />
                  ) : null}
                  {shotEndUrl(open) ? (
                    <img
                      src={shotEndUrl(open)}
                      alt={`第 ${open.index} 镜结尾`}
                    />
                  ) : null}
                </div>
              )}
              <ShotCaption text={openCap} />
              {progress?.current === open.index ? (
                <span className="shot-making">
                  {progress.kind === "video"
                    ? progress.message.includes("口型")
                      ? "对口型中"
                      : "出片中"
                    : "重出中"}
                </span>
              ) : null}
            </div>
            <div className="shot-lightbox-meta">
              <div className="shot-lightbox-kicker">
                <button
                  type="button"
                  className="shot-lightbox-step"
                  disabled={!prevOpen}
                  title={prevOpen ? `上一镜，第 ${prevOpen.index} 镜` : "已经是第一镜"}
                  aria-label="上一镜"
                  onClick={() => prevOpen && goOpenShot(prevOpen)}
                >
                  上一镜
                </button>
                <span>
                  第 {open.index} 镜 · {open.seconds} 秒 · {openPos + 1}/
                  {ordered.length}
                  {open.clipUrl ? " · 已有分镜视频" : ""}
                </span>
                <button
                  type="button"
                  className="shot-lightbox-step"
                  disabled={!nextOpen}
                  title={nextOpen ? `下一镜，第 ${nextOpen.index} 镜` : "已经是最后一镜"}
                  aria-label="下一镜"
                  onClick={() => nextOpen && goOpenShot(nextOpen)}
                >
                  下一镜
                </button>
              </div>
              {open.onScreen ? (
                <div className="shot-lightbox-flower">「{open.onScreen}」</div>
              ) : null}
              <p>{open.visual}</p>
              {open.voiceover ? (
                <p className="shot-lightbox-vo">{open.voiceover}</p>
              ) : null}
              <div className="shot-lightbox-actions">
                {onRewriteCopy ? (
                  <button
                    type="button"
                    className={`shot-edit-act${
                      copyBusy?.index === open.index &&
                      copyBusy.intent === "visual"
                        ? " is-busy"
                        : ""
                    }`}
                    disabled={regenDisabled || copyBusy?.index === open.index}
                    title={
                      copyBusy?.index === open.index &&
                      copyBusy.intent === "visual"
                        ? "正在改这一镜怎么拍的文字"
                        : "只改怎么拍的文字，头尾图不会变"
                    }
                    aria-label="改词"
                    onClick={() => onRewriteCopy(open, "visual")}
                  >
                    <ShotIcon name="rewrite" />
                    <span className="shot-edit-label">改词</span>
                  </button>
                ) : null}
                {onRewriteCopy ? (
                  <button
                    type="button"
                    className={`shot-edit-act${
                      copyBusy?.index === open.index &&
                      copyBusy.intent === "emotion"
                        ? " is-busy"
                        : ""
                    }`}
                    disabled={regenDisabled || copyBusy?.index === open.index}
                    title={
                      copyBusy?.index === open.index &&
                      copyBusy.intent === "emotion"
                        ? "加情绪中"
                        : "加情绪"
                    }
                    aria-label="加情绪"
                    onClick={() => onRewriteCopy(open, "emotion")}
                  >
                    <ShotIcon name="emotion" />
                    <span className="shot-edit-label">情绪</span>
                  </button>
                ) : null}
                {onRegenShot && refChoices(open).length > 0 ? (
                  <select
                    className="shot-ref"
                    value={refIndexOf(open) || ""}
                    disabled={
                      regenDisabled ||
                      (progress?.current === open.index &&
                        progress.kind !== "video")
                    }
                    title="重出图时参考哪一镜"
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setRefPick((cur) => ({
                        ...cur,
                        [open.index]: next,
                      }));
                    }}
                  >
                    {refChoices(open).map((row) => (
                      <option key={row.index} value={row.index}>
                        参考第{row.index}镜
                      </option>
                    ))}
                  </select>
                ) : null}
                {onRegenShot ? (
                  <button
                    type="button"
                    className={`shot-edit-act${
                      progress?.current === open.index &&
                      progress.kind !== "video"
                        ? " is-busy"
                        : ""
                    }`}
                    disabled={
                      regenDisabled ||
                      (progress?.current === open.index &&
                        progress.kind !== "video")
                    }
                    title={
                      progress?.current === open.index &&
                      progress.kind !== "video"
                        ? "出图中"
                        : "重出图"
                    }
                    aria-label="重出图"
                    onClick={() => regenShot(open)}
                  >
                    <ShotIcon name="image" />
                    <span className="shot-edit-label">出图</span>
                  </button>
                ) : null}
                {onApproveFrames && shotHasKeyframes(open) ? (
                  <button
                    type="button"
                    className="shot-edit-act"
                    disabled={regenDisabled || open.framesOk}
                    title={
                      open.framesOk
                        ? "这镜头尾已过片"
                        : "头尾图没问题，过片后才能出视频"
                    }
                    aria-label={open.framesOk ? "已过片" : "过片"}
                    onClick={() => onApproveFrames(open)}
                  >
                    <span className="shot-edit-label">
                      {open.framesOk ? "已过片" : "过片"}
                    </span>
                  </button>
                ) : null}
                {onRegenClip ? (
                  <button
                    type="button"
                    className={`shot-edit-act${
                      progress?.current === open.index &&
                      progress.kind === "video"
                        ? " is-busy"
                        : ""
                    }`}
                    disabled={
                      regenDisabled ||
                      !shotFramesApproved(open) ||
                      (progress?.current === open.index &&
                        progress.kind === "video")
                    }
                    title={
                      progress?.current === open.index &&
                      progress.kind === "video"
                        ? "出片中"
                        : !open.framesOk
                          ? "先过片再出视频"
                          : open.clipUrl
                            ? "重出视频（两条）"
                            : "出视频（两条）"
                    }
                    aria-label={open.clipUrl ? "重出视频" : "出视频"}
                    onClick={() => onRegenClip(open)}
                  >
                    <ShotIcon name="video" />
                    <span className="shot-edit-label">出片</span>
                  </button>
                ) : null}
                {onSwapClip && open.clipAltUrl ? (
                  <button
                    type="button"
                    className="shot-edit-act"
                    disabled={regenDisabled}
                    title="换成同镜另一条"
                    onClick={() => onSwapClip(open)}
                  >
                    <span className="shot-edit-label">换一条</span>
                  </button>
                ) : null}
                {onLipSync ? (
                  <button
                    type="button"
                    className={`shot-edit-act${
                      progress?.current === open.index &&
                      progress.kind === "video" &&
                      progress.message.includes("口型")
                        ? " is-busy"
                        : ""
                    }`}
                    disabled={
                      regenDisabled ||
                      !shotCanLipSync(open) ||
                      (progress?.current === open.index &&
                        progress.kind === "video")
                    }
                    title={
                      progress?.current === open.index &&
                      progress.kind === "video" &&
                      progress.message.includes("口型")
                        ? "对口型中"
                        : open.delivery === "inner"
                          ? "内心独白不用对口型"
                          : open.clipUrl
                            ? "用成片声音对口型，不换配音"
                            : "先出片再对口型"
                    }
                    aria-label="对口型"
                    onClick={() => onLipSync(open)}
                  >
                    <ShotIcon name="lipsync" />
                    <span className="shot-edit-label">对口型</span>
                  </button>
                ) : null}
                {onDeleteShot ? (
                  <button
                    type="button"
                    className="shot-edit-act is-danger"
                    disabled={ordered.length <= 1}
                    title={ordered.length <= 1 ? "至少留一镜" : "删这一镜"}
                    aria-label="删这一镜"
                    onClick={() => {
                      const stay = nextOpen || prevOpen;
                      onDeleteShot(open);
                      if (stay) goOpenShot(stay);
                      else setOpenIndex(null);
                    }}
                  >
                    <ShotIcon name="delete" />
                    <span className="shot-edit-label">删除</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost text-xs"
                  onClick={() => setOpenIndex(null)}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="shot-lightbox-side is-next"
            disabled={!nextOpen}
            title={nextOpen ? `下一镜，第 ${nextOpen.index} 镜` : "已经是最后一镜"}
            aria-label="下一镜"
            onClick={(e) => {
              e.stopPropagation();
              if (nextOpen) goOpenShot(nextOpen);
            }}
          >
            下一镜
          </button>
        </div>
      )}
    </div>
  );
}
