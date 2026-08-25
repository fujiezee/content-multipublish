"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import { useConfirm } from "@/components/ConfirmDialog";
import { useInfiniteList } from "@/components/useInfiniteList";
import type { StudioVoice } from "@/lib/types";
import {
  VOICE_CLONE_CHECK_LINE,
  VOICE_CLONE_READ_LINE,
} from "@/lib/ai/voice-lines";

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function VoiceCatalog() {
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<{
    ctx: AudioContext;
    chunks: Float32Array[];
    stop: () => void;
  } | null>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [justClonedId, setJustClonedId] = useState<string | null>(null);

  const fetchPage = useCallback(async (offset: number, limit: number) => {
    const res = await fetch(`/api/voices`, { cache: "no-store" });
    const data = (await res.json()) as { items?: StudioVoice[]; error?: string };
    if (!res.ok) throw new Error(data.error || "加载失败");
    const items = data.items ?? [];
    const page = items.slice(offset, offset + limit);
    return {
      items: page,
      nextOffset: offset + page.length < items.length ? offset + page.length : null,
      hasMore: offset + page.length < items.length,
    };
  }, []);

  const { items, setItems, booting, reload, sentinel } =
    useInfiniteList<StudioVoice>(fetchPage);

  async function startRecord() {
    setError(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    const chunks: Float32Array[] = [];
    processor.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination);
    const started = Date.now();
    const tick = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000));
    }, 250);
    recRef.current = {
      ctx,
      chunks,
      stop: () => {
        window.clearInterval(tick);
        processor.disconnect();
        source.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        void ctx.close();
      },
    };
    setSeconds(0);
    setRecording(true);
  }

  function stopRecord() {
    const rec = recRef.current;
    recRef.current = null;
    setRecording(false);
    if (!rec) return;
    const sampleRate = rec.ctx.sampleRate || 44100;
    rec.stop();
    const total = rec.chunks.reduce((n, row) => n + row.length, 0);
    const samples = new Float32Array(total);
    let offset = 0;
    for (const row of rec.chunks) {
      samples.set(row, offset);
      offset += row.length;
    }
    const wav = encodeWav(samples, sampleRate);
    const next = new File([wav], "voice.wav", { type: "audio/wav" });
    setFile(next);
    if (seconds < 5) {
      setError("至少录 5 秒。再按一次录音，把上面那句读完。");
    }
  }

  async function clone() {
    if (!file) {
      setError("先录音或上传一段自己的声音");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus("正在克隆音色…大约十几秒");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("name", name.trim());
      const res = await fetch("/api/voices", { method: "POST", body: form });
      const data = (await res.json()) as { item?: StudioVoice; error?: string };
      if (!res.ok) throw new Error(data.error || "克隆失败");
      setName("");
      setFile(null);
      setSeconds(0);
      if (fileRef.current) fileRef.current.value = "";
      if (data.item) {
        setItems((prev) => [
          data.item as StudioVoice,
          ...prev.filter((row) => row.id !== data.item?.id),
        ]);
      }
      await reload();
      if (data.item) {
        setItems((prev) => {
          if (prev.some((row) => row.id === data.item?.id)) return prev;
          return [data.item as StudioVoice, ...prev];
        });
        setJustClonedId(data.item.id);
      }
      setStatus("克隆好了。正在用你的嗓子读另一段话，不是刚才录的那句。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "克隆失败");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function saveName(id: string, nextName: string) {
    setEditingId(null);
    const trimmed = nextName.trim().slice(0, 24);
    try {
      const res = await fetch(`/api/voices/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "改名失败");
      setItems((prev) =>
        prev.map((row) => (row.id === id ? { ...row, name: trimmed } : row)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "改名失败");
    }
  }

  async function remove(row: StudioVoice) {
    const ok = await confirm({
      title: `删掉「${row.name || "这条音色"}」？`,
      detail: "角色如果绑了它，配音会改回系统音色。",
      confirmLabel: "删掉",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/voices/${row.id}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "删除失败");
      setItems((prev) => prev.filter((item) => item.id !== row.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">音色</h1>
          <p className="mt-1 text-[var(--muted)]">
            上传或录一段自己的声音，克隆成配音。角色绑上它，出片就用这条嗓子。
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/characters" className="btn btn-ghost">
            角色
          </Link>
          <Link href="/scripts" className="btn btn-ghost">
            剧本
          </Link>
        </div>
      </div>

      <div className="card space-y-3 p-5">
        <div>
          <h2 className="text-lg font-medium">克隆我的声音</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            安静环境，单人干声，5 到 20 秒。先念下面这句用来取样；克隆完成后会读另一段给你听。
          </p>
        </div>
        <p className="rounded-md bg-[var(--accent-soft)] px-3 py-2 text-sm leading-relaxed">
          {VOICE_CLONE_READ_LINE}
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="field min-w-[12rem] flex-1"
            value={name}
            placeholder="名字（可选，比如我自己、旁白）"
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className={`btn ${recording ? "btn-primary" : "btn-ghost"}`}
            disabled={busy}
            onClick={() => {
              if (recording) stopRecord();
              else void startRecord().catch((err) => {
                setError(err instanceof Error ? err.message : "打不开麦克风");
              });
            }}
          >
            {recording ? `停止 ${seconds}s` : "录音"}
          </button>
          <label className="btn btn-ghost cursor-pointer">
            {file ? file.name : "上传音频"}
            <input
              ref={fileRef}
              type="file"
              accept="audio/wav,audio/mpeg,audio/mp4,audio/x-m4a,.wav,.mp3,.m4a"
              className="hidden"
              onChange={(e) => {
                const next = e.target.files?.[0] || null;
                setFile(next);
                setError(null);
              }}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !file}
            onClick={() => void clone()}
          >
            {busy ? "克隆中…" : "克隆音色"}
          </button>
        </div>
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        {status ? <p className="text-sm text-[var(--muted)]">{status}</p> : null}
      </div>

      {booting ? (
        <p className="text-sm text-[var(--muted)]">正在载入音色库…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          还没有自己的音色。上面录一段或传一段 wav / mp3。
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((row) => (
            <li key={row.id} className="card flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-[10rem] flex-1">
                {editingId === row.id ? (
                  <input
                    className="field"
                    value={editingName}
                    autoFocus
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => void saveName(row.id, editingName)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveName(row.id, editingName);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="text-left font-medium"
                    onClick={() => {
                      setEditingId(row.id);
                      setEditingName(row.name);
                    }}
                  >
                    {row.name || "未命名音色"}
                  </button>
                )}
                <p className="text-xs text-[var(--muted)]">
                  {justClonedId === row.id
                    ? "正在读另一段话，不是录音原声"
                    : "自己克隆的 · 试听读的是另一段，不是原声"}
                </p>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-[var(--muted)]">
                  「{VOICE_CLONE_CHECK_LINE}」
                </p>
              </div>
              <VoicePreviewButton
                voiceId={row.provider_voice_id}
                model={row.provider_model}
                autoPlay={justClonedId === row.id}
                label="试听另一段"
              />
              <button
                type="button"
                className="btn btn-ghost text-xs"
                onClick={() => void remove(row)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
      {sentinel}
    </div>
  );
}
