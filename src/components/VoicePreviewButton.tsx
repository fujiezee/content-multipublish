"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

let sharedAudio: HTMLAudioElement | null = null;
let sharedUrl = "";

type Props = {
  voiceId: string;
  disabled?: boolean;
};

export function VoicePreviewButton({ voiceId, disabled }: Props) {
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = useRef(false);

  useEffect(() => {
    return () => {
      if (mine.current && sharedAudio) {
        sharedAudio.pause();
        sharedAudio = null;
        if (sharedUrl) URL.revokeObjectURL(sharedUrl);
        sharedUrl = "";
      }
    };
  }, []);

  async function toggle(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!voiceId || disabled || loading) return;
    if (playing && sharedAudio && mine.current) {
      sharedAudio.pause();
      sharedAudio.currentTime = 0;
      setPlaying(false);
      mine.current = false;
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (sharedAudio) {
        sharedAudio.pause();
        sharedAudio = null;
      }
      if (sharedUrl) {
        URL.revokeObjectURL(sharedUrl);
        sharedUrl = "";
      }
      const res = await fetch(
        `/api/tts/preview?voice=${encodeURIComponent(voiceId)}`,
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "试听失败");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      sharedAudio = audio;
      sharedUrl = url;
      mine.current = true;
      audio.onended = () => {
        if (mine.current) setPlaying(false);
        mine.current = false;
      };
      audio.onpause = () => {
        if (mine.current && audio.paused) setPlaying(false);
      };
      await audio.play();
      setPlaying(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "试听失败");
      mine.current = false;
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        className="btn btn-ghost text-xs"
        disabled={disabled || loading || !voiceId}
        onClick={(e) => void toggle(e)}
      >
        {loading ? "生成中…" : playing ? "停" : "试听"}
      </button>
      {error ? <span className="text-xs text-[var(--danger)]">{error}</span> : null}
    </span>
  );
}
