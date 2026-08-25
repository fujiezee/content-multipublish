"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { CharacterCatalogItem, VideoCharacterPhoto } from "@/lib/types";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import { VoiceSelect } from "@/components/VoiceSelect";
import {
  DEFAULT_CHARACTER_VOICE,
  resolveVoiceId,
} from "@/lib/ai/tts-voice-ids";
import {
  IMAGE_GEN_MODELS,
  readStoredImageModel,
  writeStoredImageModel,
  type ImageGenModelOption,
} from "@/lib/ai/image-gen-models-shared";
import { ModelPicker } from "@/components/ModelPicker";
import { useInfiniteList } from "@/components/useInfiniteList";
import { rewritePublicMediaUrl } from "@/lib/content/media-urls";

type VoiceOption = { id: string; label: string; hint?: string; group?: string };

export function CharacterCatalog() {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [name, setName] = useState("");
  const [createVoiceId, setCreateVoiceId] = useState(DEFAULT_CHARACTER_VOICE);
  const [imageModels, setImageModels] = useState<ImageGenModelOption[]>(
    IMAGE_GEN_MODELS,
  );
  const [imageModelId, setImageModelId] = useState(readStoredImageModel);
  const [photos, setPhotos] = useState<VideoCharacterPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [generatingId, setGeneratingId] = useState("");
  const [lookRev, setLookRev] = useState<Record<string, number>>({});
  const [metaReady, setMetaReady] = useState(false);

  function mediaSrc(url: string, stamp?: string | number) {
    const src = rewritePublicMediaUrl(url);
    if (!src || stamp == null || stamp === "") return src;
    const join = src.includes("?") ? "&" : "?";
    return `${src}${join}v=${encodeURIComponent(String(stamp))}`;
  }
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const fetchPage = useCallback(async (offset: number, limit: number) => {
    const res = await fetch(
      `/api/characters?limit=${limit}&offset=${offset}`,
      { cache: "no-store" },
    );
    const data = (await res.json()) as {
      items?: CharacterCatalogItem[];
      voices?: VoiceOption[];
      imageModels?: ImageGenModelOption[];
      nextOffset?: number | null;
      hasMore?: boolean;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error || "加载失败");
    if (offset === 0) {
      if (data.imageModels?.length) setImageModels(data.imageModels);
      setImageModelId(readStoredImageModel());
      if (data.voices?.length) {
        setVoices(data.voices);
        setCreateVoiceId((cur) => resolveVoiceId(cur) || data.voices![0].id);
      }
      setMetaReady(true);
    }
    return {
      items: data.items ?? [],
      nextOffset: data.nextOffset ?? null,
      hasMore: Boolean(data.hasMore),
    };
  }, []);

  const {
    items,
    setItems,
    booting,
    reload,
    sentinel,
  } = useInfiniteList<CharacterCatalogItem>(fetchPage);

  function voiceLabel(id?: string): string {
    if (!id) return "还没绑音色";
    return (
      voices.find((v) => v.id === resolveVoiceId(id))?.label || "已绑音色"
    );
  }

  async function saveName(id: string, nextName: string) {
    const name = nextName.trim().slice(0, 16);
    setError(null);
    setEditingId(null);
    try {
      const res = await fetch(`/api/characters/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "改名失败");
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, name } : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "改名失败");
    }
  }

  async function saveVoice(id: string, voice_id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/characters/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voice_id }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "保存音色失败");
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, voice_id } : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存音色失败");
    }
  }

  async function onPhoto(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "上传失败");
      setPhotos([{ url: data.url }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function generateFromPhoto() {
    if (photos.length === 0) {
      setError("先上传一张自己的照片");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus("正在按照片出角色设定（正面、侧前、侧面、背面）…大约一两分钟");
    try {
      const res = await fetch("/api/characters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          photos,
          voice_id: createVoiceId,
          generate: true,
          imageModel: imageModelId,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        id?: string;
      };
      if (!res.ok) throw new Error(data.error || "生成失败");
      await reload();
      setOpenId(data.id || null);
      setPhotos([]);
      setName("");
      setStatus("角色已生成，会出现在下面的角色库里，出片时也能用");
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function regenerateLook(id: string, name: string) {
    setBusy(true);
    setGeneratingId(id);
    setError(null);
    setStatus(`正在重出「${name || "这个人"}」的正面、侧前、侧面、背面…`);
    try {
      const res = await fetch(`/api/characters/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageModel: imageModelId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "重出失败");
      await reload();
      setLookRev((cur) => ({ ...cur, [id]: Date.now() }));
      setOpenId(id);
      setStatus(`「${name || "这个人"}」的角色图已重出。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重出失败");
    } finally {
      setBusy(false);
      setGeneratingId("");
    }
  }

  const ready = items.filter((item) => item.angles.length > 0);
  const drafts = items.filter((item) => item.angles.length === 0);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">角色</h1>
          <p className="mt-1 text-[var(--muted)]">
            一个人只建一次，比如傅介子，可以绑很多剧本。音色跟角色走，
            <Link href="/voices" className="underline">
              自己的音色
            </Link>
            也在这里选。
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/voices" className="btn btn-ghost">
            音色
          </Link>
          <Link href="/scripts" className="btn btn-ghost">
            剧本
          </Link>
          <Link href="/videos" className="btn btn-ghost">
            视频
          </Link>
        </div>
      </div>

      <div className="card space-y-3 p-5">
        <div>
          <h2 className="text-lg font-medium">用我的照片生成角色</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            一张正脸或半身即可。会出正面、侧前、侧面、背面，后面出片按这个人来。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            className="field min-w-[12rem] flex-1"
            value={name}
            placeholder="角色名（可选，比如傅介子）"
            onChange={(e) => setName(e.target.value)}
          />
          <VoiceSelect
            className="field w-52"
            value={createVoiceId}
            voices={voices}
            onChange={setCreateVoiceId}
          />
          <VoicePreviewButton voiceId={createVoiceId} disabled={busy} />
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <span>出图</span>
            <ModelPicker
              className="min-w-[12rem]"
              buttonClassName="field model-picker__btn w-52"
              title="选择出图模型"
              value={imageModelId}
              items={(imageModels.length ? imageModels : IMAGE_GEN_MODELS).map((m) => ({
                id: m.id,
                label: m.label,
                hint: m.hint,
                cost: m.cost,
                ready: m.ready !== false,
                badges: m.badges,
              }))}
              disabled={busy}
              onChange={(next) => {
                setImageModelId(next);
                writeStoredImageModel(next);
              }}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {photos.map((photo) => (
            <div key={photo.url} className="relative">
              <img
                src={rewritePublicMediaUrl(photo.url)}
                alt="参考"
                className="h-20 w-20 rounded-md object-cover ring-1 ring-[var(--line)]"
              />
              <button
                type="button"
                className="absolute -right-1 -top-1 rounded-full bg-white px-1 text-xs leading-none ring-1 ring-[var(--line)]"
                onClick={() => setPhotos([])}
              >
                ×
              </button>
            </div>
          ))}
          <label className="btn btn-ghost cursor-pointer text-xs">
            {uploading ? "上传中…" : photos.length ? "换一张" : "上传一张照片"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading || busy}
              onChange={(e) => {
                void onPhoto(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary text-xs"
            disabled={busy || uploading || photos.length === 0}
            onClick={() => void generateFromPhoto()}
          >
            {busy ? "生成角色中…" : "生成角色"}
          </button>
        </div>
        <p className="text-xs text-[var(--muted)]">
          照片只用来认人。设定图做成戏里的人，不要卡通，也不要证件照。分镜和出片都吃这套图。
        </p>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        {status && !error && (
          <p className="text-sm text-[var(--muted)]">{status}</p>
        )}
      </div>

      {booting && !metaReady ? (
        <p className="text-sm text-[var(--muted)]">正在载入角色库…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          还没有角色。上面传一张照片出设定，或到文章里按剧本生成。
        </p>
      ) : (
        <div className="space-y-4">
          {ready.length > 0 && (
            <ul className="grid gap-4 sm:grid-cols-2">
              {ready.map((item) => {
                const open = openId === item.id;
                const cover =
                  item.angles.find((a) => a.id === "front") || item.angles[0];
                const stamp = lookRev[item.id] || item.updated_at;
                return (
                  <li
                    key={item.id}
                    className="rounded-lg border border-[var(--line)] bg-white p-3"
                  >
                    <div
                      className="flex w-full cursor-pointer items-start gap-3 text-left"
                      onClick={() => setOpenId(open ? null : item.id)}
                    >
                      <img
                        src={mediaSrc(cover.url, stamp)}
                        alt={item.name || "角色"}
                        className="h-24 w-16 rounded-md object-cover ring-1 ring-[var(--line)]"
                      />
                      <div className="min-w-0 flex-1">
                        {editingId === item.id ? (
                          <input
                            className="field w-full py-1 text-sm"
                            value={editingName}
                            autoFocus
                            maxLength={16}
                            placeholder="角色名"
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={() => void saveName(item.id, editingName)}
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
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium">
                              {item.name || "未命名角色"}
                            </div>
                            <button
                              type="button"
                              className="text-xs underline text-[var(--muted)]"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenId(item.id);
                                setEditingId(item.id);
                                setEditingName(item.name || "");
                              }}
                            >
                              改名
                            </button>
                          </div>
                        )}
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {item.source === "script" ? "按剧本生成" : "按照片生成"}
                          {" · "}
                          {voiceLabel(item.voice_id)}
                          {(item.scripts?.length || 0)
                            ? ` · ${item.scripts.length} 个剧本在用`
                            : " · 还没绑剧本"}
                        </p>
                        {(item.scripts?.length || 0) > 0 && (
                          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
                            {item.scripts.map((script) => (
                              <Link
                                key={script.article_id}
                                href={`/scripts/${script.article_id}`}
                                className="text-xs underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {script.title}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {open && (
                      <div className="mt-3 space-y-3">
                      <label
                        className="flex items-center gap-2 text-xs text-[var(--muted)]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        音色
                        <span onClick={(e) => e.stopPropagation()}>
                          <VoiceSelect
                            className="field py-1 text-xs"
                            value={
                              resolveVoiceId(item.voice_id) ||
                              voices[0]?.id ||
                              DEFAULT_CHARACTER_VOICE
                            }
                            voices={voices}
                            onChange={(next) => void saveVoice(item.id, next)}
                          />
                        </span>
                        <VoicePreviewButton
                          voiceId={
                            resolveVoiceId(item.voice_id) ||
                            voices[0]?.id ||
                            ""
                          }
                        />
                      </label>
                      <div className="flex flex-wrap items-center justify-end">
                        <button
                          type="button"
                          className="btn btn-ghost text-xs"
                          disabled={busy}
                          title="按设定重出正面、侧前、侧面、背面"
                          onClick={(e) => {
                            e.stopPropagation();
                            void regenerateLook(item.id, item.name);
                          }}
                        >
                          {generatingId === item.id ? "重出中…" : "重出角色图"}
                        </button>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {item.angles.map((angle) => (
                          <figure key={`${angle.id}-${stamp}`} className="space-y-1">
                            <img
                              src={mediaSrc(angle.url, stamp)}
                              alt={angle.label}
                              className="aspect-[3/4] w-full rounded-md object-cover ring-1 ring-[var(--line)]"
                            />
                            <figcaption className="text-center text-xs text-[var(--muted)]">
                              {angle.label}
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {drafts.length > 0 && (
            <p className="text-xs text-[var(--muted)]">
              还有 {drafts.length} 个只传了照片、还没出多角度的，到角色库上面或任意剧本里出多角度。
            </p>
          )}
          {sentinel}
        </div>
      )}
    </div>
  );
}
