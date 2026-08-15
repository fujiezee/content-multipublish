"use client";

import { useState } from "react";
import type { VideoShot, VideoSpeakMode } from "@/lib/types";
import {
  NARRATOR_SPEAKER_ID,
  resolveShotSpeakerId,
} from "@/lib/ai/tts-voice-ids";

export type SceneBoardProgress = {
  current: number;
  total: number;
  done: number;
  message: string;
  kind?: "scene" | "video";
};

type SpeakerOption = { id: string; name: string };

type Props = {
  shots: VideoShot[];
  speakers?: SpeakerOption[];
  speakMode?: VideoSpeakMode;
  progress?: SceneBoardProgress | null;
  onSpeakerChange?: (shot: VideoShot, speakerId: string) => void;
  onRegenShot?: (shot: VideoShot) => void;
  onRegenClip?: (shot: VideoShot) => void;
  regenDisabled?: boolean;
};

export function SceneShotBoard({
  shots,
  speakers,
  speakMode,
  progress,
  onSpeakerChange,
  onRegenShot,
  onRegenClip,
  regenDisabled,
}: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (shots.length === 0) return null;
  const open = openIndex == null ? null : shots.find((s) => s.index === openIndex) || null;

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

      <ol className="shot-board-strip">
        {shots.map((shot) => {
          const making =
            Boolean(progress) && progress?.current === shot.index;
          const sceneMaking = making && progress?.kind !== "video";
          const clipMaking = making && progress?.kind === "video";
          return (
            <li key={shot.index} className="shot-card">
              <button
                type="button"
                className={`shot-frame${making ? " is-making" : ""}${shot.sceneUrl ? "" : " is-empty"}`}
                onClick={() => {
                  if (shot.sceneUrl || shot.clipUrl) setOpenIndex(shot.index);
                }}
                disabled={!shot.sceneUrl && !shot.clipUrl}
              >
                {shot.sceneUrl ? (
                  <img src={shot.sceneUrl} alt={`第 ${shot.index} 镜`} />
                ) : (
                  <span className="shot-empty">
                    {sceneMaking ? "出图中" : "未出"}
                  </span>
                )}
                {making && shot.sceneUrl ? (
                  <span className="shot-making">
                    {clipMaking ? "出片中" : "重出中"}
                  </span>
                ) : null}
                <span className="shot-no">
                  {String(shot.index).padStart(2, "0")}
                </span>
                <span className="shot-dur">{shot.seconds}s</span>
                {shot.clipUrl ? <span className="shot-clip">片</span> : null}
                {shot.onScreen ? (
                  <span className="shot-flower">{shot.onScreen}</span>
                ) : null}
              </button>
              <p className="shot-visual">{shot.visual}</p>
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
              ) : null}
              {onRegenShot ? (
                <button
                  type="button"
                  className="shot-regen"
                  disabled={regenDisabled || sceneMaking}
                  onClick={() => onRegenShot(shot)}
                >
                  {sceneMaking
                    ? "重出中…"
                    : shot.sceneUrl
                      ? "重出此镜图"
                      : "出这一镜图"}
                </button>
              ) : null}
              {onRegenClip ? (
                <button
                  type="button"
                  className="shot-regen"
                  disabled={
                    regenDisabled || clipMaking || !shot.sceneUrl
                  }
                  onClick={() => onRegenClip(shot)}
                >
                  {clipMaking
                    ? "出片中…"
                    : shot.clipUrl
                      ? "重出此镜视频"
                      : "出此镜视频"}
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>

      {open && (
        <div
          className="shot-lightbox"
          role="dialog"
          aria-label={`第 ${open.index} 镜`}
          onClick={() => setOpenIndex(null)}
        >
          <div
            className="shot-lightbox-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shot-lightbox-frame">
              {open.clipUrl ? (
                <video
                  key={open.clipUrl}
                  src={open.clipUrl}
                  poster={open.sceneUrl}
                  controls
                  playsInline
                  preload="metadata"
                />
              ) : (
                <img src={open.sceneUrl} alt={`第 ${open.index} 镜`} />
              )}
              {progress?.current === open.index ? (
                <span className="shot-making">
                  {progress.kind === "video" ? "出片中" : "重出中"}
                </span>
              ) : null}
            </div>
            <div className="shot-lightbox-meta">
              <div className="shot-lightbox-kicker">
                第 {open.index} 镜 · {open.seconds} 秒
                {open.clipUrl ? " · 已有分镜视频" : ""}
              </div>
              {open.onScreen ? (
                <div className="shot-lightbox-flower">「{open.onScreen}」</div>
              ) : null}
              <p>{open.visual}</p>
              {open.voiceover ? (
                <p className="shot-lightbox-vo">{open.voiceover}</p>
              ) : null}
              <div className="shot-lightbox-actions">
                {onRegenShot ? (
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    disabled={
                      regenDisabled ||
                      (progress?.current === open.index &&
                        progress.kind !== "video")
                    }
                    onClick={() => onRegenShot(open)}
                  >
                    {progress?.current === open.index &&
                    progress.kind !== "video"
                      ? "重出中…"
                      : "重出这一镜图"}
                  </button>
                ) : null}
                {onRegenClip ? (
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    disabled={
                      regenDisabled ||
                      !open.sceneUrl ||
                      (progress?.current === open.index &&
                        progress.kind === "video")
                    }
                    onClick={() => onRegenClip(open)}
                  >
                    {progress?.current === open.index &&
                    progress.kind === "video"
                      ? "出片中…"
                      : open.clipUrl
                        ? "重出这一镜视频"
                        : "出这一镜视频"}
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
        </div>
      )}
    </div>
  );
}
