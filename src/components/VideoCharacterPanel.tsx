"use client";

import { useState } from "react";
import Link from "next/link";
import type { VideoCharacterAngle, VideoCharacterPhoto } from "@/lib/types";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import { VoiceSelect, type VoiceSelectOption } from "@/components/VoiceSelect";
import { DEFAULT_CHARACTER_VOICE, resolveVoiceId } from "@/lib/ai/tts-voice-ids";

export type CastCharacter = {
  id: string;
  name: string;
  thumb?: string;
  voice_id?: string;
  angles?: VideoCharacterAngle[];
  photos?: VideoCharacterPhoto[];
};

type ScriptBrief = {
  name: string;
  look: string;
  role?: string;
};

type Props = {
  articleId: string;
  library: CastCharacter[];
  cast: CastCharacter[];
  voices?: VoiceSelectOption[];
  disabled?: boolean;
  hasScript?: boolean;
  onCastChange: (ids: string[]) => void | Promise<void>;
  onVoiceChange?: (id: string, voiceId: string) => void | Promise<void>;
  onLibraryRefresh?: () => Promise<void> | void;
};

function previewOf(person: CastCharacter): VideoCharacterAngle[] {
  return person.angles && person.angles.length > 0 ? person.angles : [];
}

export function VideoCharacterPanel({
  articleId,
  library,
  cast,
  voices,
  disabled,
  hasScript,
  onCastChange,
  onVoiceChange,
  onLibraryRefresh,
}: Props) {
  const [briefs, setBriefs] = useState<ScriptBrief[]>([]);
  const [busy, setBusy] = useState<"extract" | "generate" | null>(null);
  const [generatingName, setGeneratingName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const castIds = cast.map((c) => c.id);
  const unused = library.filter((c) => !castIds.includes(c.id));

  async function extract() {
    setBusy("extract");
    setError(null);
    setStatus("正在从剧本里认角色…");
    try {
      const res = await fetch(`/api/articles/${articleId}/video-character`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "extract" }),
      });
      const data = (await res.json()) as {
        error?: string;
        briefs?: ScriptBrief[];
      };
      if (!res.ok) throw new Error(data.error || "识别失败");
      setBriefs(data.briefs || []);
      setAdding(true);
      setStatus(
        data.briefs?.length
          ? `剧本里有 ${data.briefs.length} 个角色，可以选用已有的，或按设定生成。`
          : "没从剧本里看出角色",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "识别失败");
    } finally {
      setBusy(null);
    }
  }

  async function generateFromBrief(brief: ScriptBrief) {
    if (castIds.length >= 4) {
      setError("一本剧最多 4 个角色");
      return;
    }
    setBusy("generate");
    setGeneratingName(brief.name);
    setError(null);
    setStatus(`正在按剧本生成「${brief.name}」的正面、侧前、侧面、背面…`);
    try {
      const res = await fetch(`/api/articles/${articleId}/video-character`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          name: brief.name,
          look: brief.look,
        }),
      });
      const data = (await res.json()) as { error?: string; id?: string };
      if (!res.ok) throw new Error(data.error || "生成失败");
      if (data.id && !castIds.includes(data.id)) {
        await onCastChange([...castIds, data.id].slice(0, 4));
      }
      await onLibraryRefresh?.();
      setStatus(`「${brief.name}」已进角色库，并加到本剧。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setBusy(null);
      setGeneratingName("");
    }
  }

  async function saveName(id: string, nextName: string) {
    const name = nextName.trim().slice(0, 16);
    setEditingId(null);
    setError(null);
    try {
      const res = await fetch(`/api/characters/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "改名失败");
      await onLibraryRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "改名失败");
    }
  }

  function addFromLibrary(id: string) {
    if (!id || castIds.includes(id) || castIds.length >= 4) return;
    onCastChange([...castIds, id]);
    setAdding(false);
  }

  function replaceAt(index: number, id: string) {
    if (!id) {
      onCastChange(castIds.filter((_, i) => i !== index));
      return;
    }
    const next = [...castIds];
    next[index] = id;
    onCastChange([...new Set(next)]);
  }

  return (
    <div className="rounded-lg border border-[var(--line)] bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">本剧角色</h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            一本剧可以挂几个人。每人既能从角色库选，也能按剧本识别后再生成外形。上面选了傅介子，下面还能再加匈奴使者。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-ghost text-xs"
            disabled={disabled || busy !== null || !hasScript}
            title={hasScript ? "从口播和分镜里认出有几个人" : "先写出剧本再识别"}
            onClick={() => void extract()}
          >
            {busy === "extract" ? "识别中…" : "按剧本识别角色"}
          </button>
          <Link href="/characters" className="btn btn-ghost text-xs">
            去角色库
          </Link>
        </div>
      </div>

      {cast.length > 0 && (
        <div className="mt-3 space-y-3">
          {cast.map((person, index) => {
            const preview = previewOf(person);
            return (
              <div
                key={person.id}
                className="rounded-md border border-[var(--line)] p-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {person.thumb ? (
                    <img
                      src={person.thumb}
                      alt=""
                      className="h-10 w-10 rounded-md object-cover ring-1 ring-[var(--line)]"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-md bg-[var(--bg)] ring-1 ring-[var(--line)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    {editingId === person.id ? (
                      <input
                        className="field w-full py-1 text-sm"
                        value={editingName}
                        autoFocus
                        maxLength={16}
                        placeholder="角色名"
                        disabled={disabled || busy !== null}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => void saveName(person.id, editingName)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setEditingId(null);
                          }
                        }}
                      />
                    ) : (
                      <p className="text-sm font-medium">
                        {person.name || "未命名角色"}
                        <button
                          type="button"
                          className="ml-2 text-xs font-normal underline text-[var(--muted)]"
                          disabled={disabled || busy !== null}
                          onClick={() => {
                            setEditingId(person.id);
                            setEditingName(person.name || "");
                          }}
                        >
                          改名
                        </button>
                      </p>
                    )}
                    <p className="text-xs text-[var(--muted)]">
                      {index === 0 ? "主角 · 角色库" : "角色库"}
                    </p>
                  </div>
                  {onVoiceChange ? (
                    <span className="inline-flex items-center gap-1">
                      <VoiceSelect
                        className="field cast-voice-field py-1 text-xs"
                        value={resolveVoiceId(
                          person.voice_id,
                          DEFAULT_CHARACTER_VOICE,
                        )}
                        voices={voices}
                        disabled={disabled || busy !== null}
                        title="这个人的配音"
                        onChange={(next) => void onVoiceChange(person.id, next)}
                      />
                      <VoicePreviewButton
                        voiceId={resolveVoiceId(
                          person.voice_id,
                          DEFAULT_CHARACTER_VOICE,
                        )}
                        disabled={disabled || busy !== null}
                      />
                    </span>
                  ) : null}
                  <select
                    className="field max-w-[9rem] py-1 text-xs"
                    value={person.id}
                    disabled={disabled || busy !== null}
                    onChange={(e) => replaceAt(index, e.target.value)}
                  >
                    {library.map((c) => (
                      <option
                        key={c.id}
                        value={c.id}
                        disabled={c.id !== person.id && castIds.includes(c.id)}
                      >
                        {c.name || "未命名角色"}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    disabled={disabled || busy !== null}
                    onClick={() =>
                      onCastChange(castIds.filter((id) => id !== person.id))
                    }
                  >
                    移除
                  </button>
                </div>
                {preview.length > 0 ? (
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    {preview.slice(0, 4).map((angle) => (
                      <figure key={angle.id} className="space-y-0.5">
                        <img
                          src={angle.url}
                          alt={angle.label}
                          className="aspect-[3/4] w-full rounded object-cover ring-1 ring-[var(--line)]"
                        />
                        <figcaption className="text-center text-[10px] text-[var(--muted)]">
                          {angle.label}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    这个人还没有多角度，去角色库补上。
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {briefs.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-[var(--muted)]">剧本里的人</p>
          {briefs.map((brief) => {
            const sameName = library.find((c) => c.name === brief.name);
            const already = sameName ? castIds.includes(sameName.id) : false;
            return (
              <div
                key={`${brief.name}-${brief.role || ""}`}
                className="rounded-md bg-[var(--bg)] px-2 py-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {brief.name}
                      {brief.role ? (
                        <span className="ml-1 text-xs font-normal text-[var(--muted)]">
                          {brief.role}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {brief.look}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {already ? (
                      <span className="text-xs text-[var(--muted)]">已选用</span>
                    ) : (
                      <>
                        {sameName && (
                          <button
                            type="button"
                            className="btn btn-ghost text-xs"
                            disabled={disabled || busy !== null}
                            onClick={() => addFromLibrary(sameName.id)}
                          >
                            选用已有
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost text-xs"
                          disabled={
                            disabled || busy !== null || castIds.length >= 4
                          }
                          onClick={() => void generateFromBrief(brief)}
                        >
                          {busy === "generate" && generatingName === brief.name
                            ? "生成中…"
                            : "按设定生成"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {castIds.length < 4 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {adding || unused.length > 0 ? (
            <select
              className="field max-w-[12rem] py-1 text-xs"
              value=""
              disabled={disabled || busy !== null}
              onChange={(e) => addFromLibrary(e.target.value)}
            >
              <option value="">从角色库添加…</option>
              {unused.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || "未命名角色"}
                </option>
              ))}
            </select>
          ) : null}
          {!adding && (
            <button
              type="button"
              className="btn btn-ghost text-xs"
              disabled={disabled || busy !== null}
              onClick={() => setAdding(true)}
            >
              + 添加角色
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
      {status && !error && (
        <p className="mt-2 text-xs text-[var(--muted)]">{status}</p>
      )}
    </div>
  );
}
