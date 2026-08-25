"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicPodcast } from "@/lib/ai/podcast-shared";
import type { PodcastTurn } from "@/lib/types";

function formatClock(sec: number) {
  const n = Math.max(0, Math.round(sec));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PodcastListen({ podcast }: { podcast: PublicPodcast }) {
  const turns = podcast.turns || [];
  const [currentTurn, setCurrentTurn] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const turnsRef = useRef<PodcastTurn[]>(turns);
  turnsRef.current = turns;

  useEffect(() => {
    setCurrentTurn(0);
  }, [podcast.id, podcast.audioUrl]);

  const duration =
    podcast.durationSec ||
    turns.reduce((sum, row) => sum + (row.durationSec || 0), 0);

  function playFrom(index: number) {
    const turn = turnsRef.current[index];
    const stitched = podcast.audioUrl;
    const el = audioRef.current;
    if (!el) return;
    if (stitched && index === 0) {
      setCurrentTurn(0);
      el.src = stitched;
      void el.play().catch(() => undefined);
      return;
    }
    if (!turn?.audioUrl) return;
    setCurrentTurn(index);
    el.src = turn.audioUrl;
    void el.play().catch(() => undefined);
  }

  function onEnded() {
    if (podcast.audioUrl) {
      setCurrentTurn(0);
      return;
    }
    const next = currentTurn + 1;
    if (next < turnsRef.current.length) playFrom(next);
    else setCurrentTurn(-1);
  }

  if (turns.length === 0 && !podcast.audioUrl) return null;

  const coverUrl = String(podcast.coverUrl || "").trim();

  return (
    <div className="podcast-player">
      <div className={`podcast-player__hero${coverUrl ? " has-cover" : ""}`}>
        {coverUrl ? (
          <div className="podcast-player__cover">
            <img src={coverUrl} alt={podcast.title || "播客封面"} />
          </div>
        ) : null}
        <div className="podcast-player__info">
          <div className="podcast-player__stage-head">
            <div className="podcast-player__stage-title">
              <p className="video-music-lead__kicker">正在听</p>
              <h2 className="podcast-player__title">
                {podcast.title || "未命名对谈"}
              </h2>
            </div>
            {podcast.audioUrl ? (
              <a
                className="btn btn-ghost text-xs"
                href={podcast.audioUrl}
                download
                target="_blank"
                rel="noreferrer"
              >
                下载
              </a>
            ) : null}
          </div>
          <p className="podcast-player__meta">
            {[
              podcast.mode === "solo" ? "口播" : "问答",
              turns.length ? `${turns.length} 轮` : "",
              duration ? formatClock(duration) : "",
              podcast.audioUrl ? "" : "按轮播放",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="podcast-player__audio-wrap">
            <audio
              ref={audioRef}
              className="podcast-player__audio"
              controls
              src={podcast.audioUrl || turns[0]?.audioUrl || undefined}
              onEnded={onEnded}
              onPlay={() => {
                if (podcast.audioUrl) setCurrentTurn(0);
              }}
            />
          </div>
        </div>
      </div>
      {turns.length > 0 ? (
        <ol className="podcast-turns">
          {turns.map((turn, i) => (
            <li
              key={`${turn.index}-${i}`}
              className={
                currentTurn === i ? "podcast-turn is-current" : "podcast-turn"
              }
            >
              <button
                type="button"
                className="podcast-turn__who"
                disabled={!turn.audioUrl && !podcast.audioUrl}
                onClick={() => playFrom(i)}
              >
                {turn.name}
              </button>
              <p>{turn.text}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
