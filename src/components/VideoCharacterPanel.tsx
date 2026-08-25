"use client";

import { useState } from "react";
import Link from "next/link";
import type { VideoCharacterAngle, VideoCharacterPhoto } from "@/lib/types";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import { SearchSelect } from "@/components/SearchSelect";
import { VoiceSelect, type VoiceSelectOption } from "@/components/VoiceSelect";
import { characterHasLook } from "@/lib/ai/character-look";
import { rewritePublicMediaUrl } from "@/lib/content/media-urls";
import {
  DEFAULT_CHARACTER_VOICE,
  matchCastBySpeaker,
  resolveVoiceId,
} from "@/lib/ai/tts-voice-ids";
import { MAX_SERIES_CAST } from "@/lib/ai/video-script-styles";

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
  imageModelId?: string;
  onCastChange: (ids: string[]) => void | Promise<void>;
  onVoiceChange?: (id: string, voiceId: string) => void | Promise<void>;
  onLibraryRefresh?: (data?: {
    characters?: CastCharacter[];
    cast?: CastCharacter[];
  }) => Promise<void> | void;
};

function previewOf(person: CastCharacter): VideoCharacterAngle[] {
  return person.angles && person.angles.length > 0 ? person.angles : [];
}

function mediaSrc(url: string, stamp?: string | number) {
  const src = rewritePublicMediaUrl(url);
  if (!src || stamp == null || stamp === "") return src;
  const join = src.includes("?") ? "&" : "?";
  return `${src}${join}v=${encodeURIComponent(String(stamp))}`;
}

export function VideoCharacterPanel({
  articleId,
  library,
  cast,
  voices,
  disabled,
  hasScript,
  imageModelId,
  onCastChange,
  onVoiceChange,
  onLibraryRefresh,
}: Props) {
  const [briefs, setBriefs] = useState<ScriptBrief[]>([]);
  const [busy, setBusy] = useState<"extract" | "generate" | null>(null);
  const [generatingName, setGeneratingName] = useState("");
  const [generatingId, setGeneratingId] = useState("");
  const [lookRev, setLookRev] = useState<Record<string, number>>({});
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
      await onLibraryRefresh?.();
      setStatus(
        data.briefs?.length
          ? `剧本里有 ${data.briefs.length} 个角色，可以选用已有的，或按设定生成。`
          : cast.length
            ? "本剧角色都在，没有认出新人"
            : "没从剧本里看出角色",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "识别失败";
      if (cast.length && /没从剧本里看出角色/.test(message)) {
        setStatus("本剧角色都在，识别没有认出新人");
      } else {
        setError(message);
      }
    } finally {
      setBusy(null);
    }
  }

  async function generateFromBrief(brief: ScriptBrief) {
    if (castIds.length >= MAX_SERIES_CAST) {
      setError("本剧角色名单已满，先撤一个再加");
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
          imageModel: imageModelId,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        id?: string;
        reused?: boolean;
        characters?: CastCharacter[];
        cast?: CastCharacter[];
      };
      if (!res.ok) throw new Error(data.error || "生成失败");
      if (data.id && !castIds.includes(data.id)) {
        await onCastChange([...castIds, data.id]);
      }
      await onLibraryRefresh?.(data);
      setStatus(
        data.reused
          ? `「${brief.name}」已有角色图，已挂到本剧，没有再生成。`
          : `「${brief.name}」已进角色库，并加到本剧。`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setBusy(null);
      setGeneratingName("");
    }
  }

  async function regenerateLook(person: CastCharacter, look?: string) {
    setBusy("generate");
    setGeneratingId(person.id);
    setGeneratingName(person.name);
    setError(null);
    setStatus(`正在重出「${person.name}」的正面、侧前、侧面、背面…`);
    try {
      const res = await fetch(`/api/articles/${articleId}/video-character`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "regenerate",
          force: true,
          characterId: person.id,
          name: person.name,
          look: look || "",
          imageModel: imageModelId,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        characters?: CastCharacter[];
        cast?: CastCharacter[];
      };
      if (!res.ok) throw new Error(data.error || "重出失败");
      await onLibraryRefresh?.({
        characters: data.characters,
        cast: data.cast,
      });
      setLookRev((cur) => ({ ...cur, [person.id]: Date.now() }));
      setStatus(`「${person.name}」的角色图已重出。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重出失败");
    } finally {
      setBusy(null);
      setGeneratingId("");
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
    if (!id || castIds.includes(id) || castIds.length >= MAX_SERIES_CAST) return;
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
            人数按戏来。续写时剧本里新出现的人会自动认出来：角色库有同名就挂上，没有就按设定生成外形。人设卡锁身份，避免后集换脸。一镜最多钉 10 张参考（人+道具+尾帧），分镜超了会拆开，不要全员挤进同一张。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-ghost text-xs"
            disabled={disabled || busy !== null || !hasScript}
            title={hasScript ? "用模型读准稿，认出场上的人" : "先写出剧本再识别"}
            onClick={() => void extract()}
          >
            {busy === "extract" ? "识别中…" : "按剧本识别角色"}
          </button>
          <Link href="/characters" className="btn btn-ghost text-xs">
            去角色库
          </Link>
          <Link href="/voices" className="btn btn-ghost text-xs">
            克隆音色
          </Link>
        </div>
      </div>

      {cast.length > 0 && (
        <div className="mt-3 space-y-3">
          {cast.map((person, index) => {
            const preview = previewOf(person);
            const stamp = lookRev[person.id];
            return (
              <div
                key={person.id}
                className="rounded-md border border-[var(--line)] p-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {person.thumb ? (
                    <img
                      src={mediaSrc(person.thumb, stamp)}
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
                  <SearchSelect
                    className="max-w-[9rem] text-xs"
                    value={person.id}
                    items={library.map((c) => ({
                      id: c.id,
                      label: c.name || "未命名角色",
                      disabled: c.id !== person.id && castIds.includes(c.id),
                    }))}
                    disabled={disabled || busy !== null}
                    searchPlaceholder="搜角色"
                    onChange={(next) => replaceAt(index, next)}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    disabled={disabled || busy !== null}
                    title={
                      preview.length > 0
                        ? "按设定重出正面、侧前、侧面、背面"
                        : "按设定出正面、侧前、侧面、背面"
                    }
                    onClick={() => void regenerateLook(person)}
                  >
                    {busy === "generate" && generatingId === person.id
                      ? "重出中…"
                      : preview.length > 0
                        ? "重出角色图"
                        : "出角色图"}
                  </button>
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
                      <figure key={`${angle.id}-${stamp || angle.url}`} className="space-y-0.5">
                        <img
                          src={mediaSrc(angle.url, stamp)}
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
            const sameName = matchCastBySpeaker(brief.name, library);
            const already = sameName ? castIds.includes(sameName.id) : false;
            const hasLook = characterHasLook(sameName);
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
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-[var(--muted)]">
                          {hasLook ? "已有角色图" : "已选用"}
                        </span>
                        {sameName ? (
                          <button
                            type="button"
                            className="btn btn-ghost text-xs"
                            disabled={disabled || busy !== null}
                            onClick={() =>
                              void regenerateLook(sameName, brief.look)
                            }
                          >
                            {busy === "generate" && generatingId === sameName.id
                              ? "重出中…"
                              : "重出角色图"}
                          </button>
                        ) : null}
                      </div>
                    ) : hasLook && sameName ? (
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        disabled={disabled || busy !== null}
                        onClick={() => addFromLibrary(sameName.id)}
                      >
                        选用已有外形
                      </button>
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
                            disabled || busy !== null || castIds.length >= MAX_SERIES_CAST
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

      {castIds.length < MAX_SERIES_CAST && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {adding || unused.length > 0 ? (
            <SearchSelect
              className="max-w-[12rem] text-xs"
              value=""
              items={unused.map((c) => ({
                id: c.id,
                label: c.name || "未命名角色",
              }))}
              disabled={disabled || busy !== null}
              placeholder="从角色库添加…"
              searchPlaceholder="搜角色"
              onChange={(next) => addFromLibrary(next)}
            />
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
