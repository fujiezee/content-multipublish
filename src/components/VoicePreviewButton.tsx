"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

let sharedAudio: HTMLAudioElement | null = null;
let sharedUrl = "";

type Props = {
  voiceId: string;
  disabled?: boolean;
  autoPlay?: boolean;
  label?: string;
  model?: string;
  ttsModel?: string;
  kind?: "podcast";
  speaker?: "host" | "guest";
  mode?: "dialogue" | "solo";
};

export function VoicePreviewButton({
  voiceId,
  disabled,
  autoPlay,
  label = "试听",
  model,
  ttsModel,
  kind,
  speaker,
  mode,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = useRef(false);
  const didAuto = useRef(false);

  async function playClip() {
    if (!voiceId || disabled || loading) return;
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
      const params = new URLSearchParams({ voice: voiceId, v: "clone-check" });
      if (model) params.set("model", model);
      if (ttsModel) params.set("ttsModel", ttsModel);
      if (kind) params.set("kind", kind);
      if (speaker) params.set("speaker", speaker);
      if (mode) params.set("mode", mode);
      const res = await fetch(`/api/tts/preview?${params.toString()}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "试听失败");
      }
      const blob = await res.blob();
      if (blob.size < 64 || /json|text|html/i.test(blob.type)) {
        const raw = await blob.text();
        let message = "试听失败";
        try {
          message =
            (JSON.parse(raw) as { error?: string }).error || message;
        } catch {
          if (raw.trim()) message = raw.slice(0, 180);
        }
        throw new Error(message);
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.preload = "auto";
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

  useEffect(() => {
    if (!autoPlay || !voiceId || disabled || didAuto.current) return;
    didAuto.current = true;
    void playClip();
    // playClip is stable enough for one-shot autoplay on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, voiceId, disabled, ttsModel, kind, speaker, mode]);

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
    await playClip();
  }

  return (
    <span className="inline-flex max-w-xs flex-col items-start gap-1">
      <button
        type="button"
        className="btn btn-ghost voice-preview-btn"
        disabled={disabled || loading || !voiceId}
        title={error || (loading ? "正在生成试听" : playing ? "停止试听" : label)}
        onClick={(e) => void toggle(e)}
      >
        {loading ? "生成中" : playing ? "停止" : label}
      </button>
      {error ? (
        <span className="text-xs leading-snug text-[var(--danger)]">{error}</span>
      ) : null}
    </span>
  );
}
