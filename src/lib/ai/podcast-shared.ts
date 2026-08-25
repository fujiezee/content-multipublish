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
  const act = String(feel || "").replace(/\s+/g, " ").trim().slice(0, 36);
  if (mode === "solo") {
    return act
      ? `你可以用「${act}」的语气说话吗？像吸引力口播当面把一件事说破，有轻重和气口，钩子加重，段尾像还没说完。不要匀速念稿，不要播音腔，不要短剧喊麦。`
      : "你可以用又近又狠的语气说话吗？像吸引力口播，第一句就要停住听的人，有轻重，段尾像还没说完。不要匀速念稿，不要播音腔，不要短剧喊麦。";
  }
  if (speaker === "guest") {
    return act
      ? `你可以用「${act}」的语气说话吗？对谈里认真答，但带着劲，揭那一层时加重，话尾像还没说完。不要老师念答案，不要匀速，不要播音腔。`
      : "你可以用恨铁不成钢、又要把一层纸揭开的语气说话吗？认真答，揭穿时加重，话尾像还没说完。不要念稿，不要播音腔。";
  }
  return act
    ? `你可以用「${act}」的语气说话吗？你是听的人在追问，急、短、不服，问号顶上去。不要客客气气，不要报幕，不要播音腔。`
    : "你可以用又急又不服的语气说话吗？像被戳到才问出口，问号顶上去，短、冲。不要客客气气，不要播音腔。";
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
