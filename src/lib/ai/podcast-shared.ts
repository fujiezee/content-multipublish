import { rewritePublicMediaUrl } from "@/lib/content/media-urls";
import { DEFAULT_TTS_SPEECH_MODEL, resolveTtsSpeechModel } from "@/lib/ai/tts-voice-ids";
import type {
  ArticlePodcast,
  PodcastMode,
  PodcastSpeaker,
  PodcastTurn,
} from "@/lib/types";

export const DEFAULT_PODCAST_HOST_VOICE = "zh_male_shenyeboke_uranus_bigtts";
export const DEFAULT_PODCAST_GUEST_VOICE = "zh_female_xiaohe_uranus_bigtts";

export const PODCAST_HOST_NAME = "问";
export const PODCAST_GUEST_NAME = "答";
export const PODCAST_SOLO_NAME = "口播";
/** 播客默认走表现力，口播/对谈才带得上情绪 */
export const DEFAULT_PODCAST_TTS_MODEL = "seed-tts-2.0-expressive";

export function podcastSpeakerName(
  speaker: PodcastSpeaker,
  mode: PodcastMode,
): string {
  if (mode === "solo") return PODCAST_SOLO_NAME;
  return speaker === "guest" ? PODCAST_GUEST_NAME : PODCAST_HOST_NAME;
}

export function normalizePodcastMode(raw?: string | null): PodcastMode {
  return raw === "solo" ? "solo" : "dialogue";
}

export function podcastTone(
  speaker: PodcastSpeaker,
  mode: PodcastMode,
  feel?: string,
): string {
  const act = String(feel || "").replace(/\s+/g, " ").trim().slice(0, 24);
  if (mode === "solo") {
    return act
      ? `你可以用特别${act}的语气说话吗？像跟身边的人说一件真事。`
      : "你可以用特别着急、又想把人留住的语气说话吗？像跟身边的人说一件真事。";
  }
  if (speaker === "guest") {
    return act
      ? `你可以用特别${act}的语气说话吗？揭那一层时声音加重。`
      : "你可以用特别认真、又有点心疼的语气说话吗？揭那一层时声音加重。";
  }
  return act
    ? `你可以用特别${act}的语气说话吗？像被人戳了一下才问出口。`
    : "你可以用特别着急、不服气的语气说话吗？像被人戳了一下才问出口。";
}

export function podcastCotTag(
  speaker: PodcastSpeaker,
  mode: PodcastMode,
  feel?: string,
): string {
  const t = String(feel || "");
  if (/笑|开心|乐/.test(t)) return "开心";
  if (/无奈|心疼|痛/.test(t)) return "无奈";
  if (/收住|金句|郑重/.test(t)) return "郑重";
  if (/揭|认真/.test(t)) return "认真";
  if (/急|慌|追|不服|冲|钩|停住/.test(t)) return "着急";
  if (speaker === "guest") return "认真";
  return mode === "solo" ? "着急" : "着急";
}

/** 豆包 2.0 表现力：句子外包 cot 标签，配音才跟得上情绪 */
export function wrapPodcastCot(
  text: string,
  speaker: PodcastSpeaker,
  mode: PodcastMode,
  feel?: string,
): string {
  const spoken = String(text || "").replace(/\s+/g, " ").trim();
  if (!spoken) return spoken;
  const tag = podcastCotTag(speaker, mode, feel);
  return `<cot text=${tag}>${spoken}</cot>`;
}

export function podcastAudioEmotion(
  speaker: PodcastSpeaker,
  mode: PodcastMode,
  feel?: string,
): string | undefined {
  const tag = podcastCotTag(speaker, mode, feel);
  if (tag === "开心") return "happy";
  if (tag === "无奈") return "sad";
  if (tag === "着急") return "angry";
  if (tag === "郑重") return "surprised";
  return undefined;
}

export function parsePodcastTurns(raw?: string | null): PodcastTurn[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row, i) => {
        const rec =
          row && typeof row === "object" ? (row as Record<string, unknown>) : {};
        const speaker: PodcastSpeaker =
          rec.speaker === "guest" ? "guest" : "host";
        const text = String(rec.text || "").trim();
        if (!text) return null;
        return {
          index: Number(rec.index) || i + 1,
          speaker,
          name: String(
            rec.name || (speaker === "guest" ? PODCAST_GUEST_NAME : PODCAST_HOST_NAME),
          ),
          text,
          audioUrl: String(rec.audioUrl || "").trim(),
          durationSec: Math.max(0, Number(rec.durationSec) || 0),
          feel: String(rec.feel || rec.emotion || "").trim().slice(0, 36) || undefined,
        } satisfies PodcastTurn;
      })
      .filter((row): row is PodcastTurn => Boolean(row));
  } catch {
    return [];
  }
}

export type PublicPodcast = {
  id: string;
  articleId: string;
  title: string;
  mode: PodcastMode;
  hostVoice: string;
  guestVoice: string;
  ttsModel: string;
  status: ArticlePodcast["status"];
  error: string | null;
  audioUrl: string | null;
  coverUrl: string | null;
  durationSec: number;
  turns: PodcastTurn[];
  createdAt: string;
  updatedAt: string;
};

export function publicPodcast(
  row: ArticlePodcast | undefined | null,
): PublicPodcast | null {
  if (!row) return null;
  const turns = parsePodcastTurns(row.turns_json);
  return {
    id: row.id,
    articleId: row.article_id,
    title: row.title,
    mode: normalizePodcastMode(row.mode),
    hostVoice: row.host_voice,
    guestVoice: row.guest_voice,
    ttsModel: resolveTtsSpeechModel(row.tts_model) || DEFAULT_TTS_SPEECH_MODEL,
    status: row.status,
    error: row.error,
    audioUrl: row.audio_url,
    coverUrl: rewritePublicMediaUrl(String(row.cover_url || "").trim()) || null,
    durationSec: row.duration_sec,
    turns,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
