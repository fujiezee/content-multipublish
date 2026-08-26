import {
  dubExistingEpisodeVideo,
  generateArkEpisodeVideo,
  listArkVideoModels,
  listArkVideoModelsWithOpen,
  listArkVideoPresets,
  resolveArkVideoConfig,
  type VideoGenProgress,
} from "@/lib/ai/ark-video";
import { hasCloudflareAiReady } from "@/lib/ai/model-catalog/cloudflare-seed";
import type { VideoShot, VideoSpeakMode } from "@/lib/types";

export type { VideoGenProgress };

export type EpisodeVideoInput = {
  seriesTitle: string;
  episodeNo: number;
  title: string;
  hook: string;
  voiceover: string;
  onScreen: string;
  durationSec: number;
  shots: VideoShot[];
  aspectRatio: "9:16";
  characterName?: string;
  characterAngles?: { id: string; label: string; url: string }[];
  presetId?: string;
  speakMode?: VideoSpeakMode;
  voiceId?: string;
  cast?: Array<{ id: string; name: string; voice_id?: string }>;
  stanceNotes?: string;
  force?: boolean;
  onlyIndexes?: number[];
  composeOnly?: boolean;
  /** native=模型自己出声；lipsync=用成片声音对口型；tts=另配音再对口型 */
  voicePath?: "native" | "tts" | "lipsync";
  innerVoice?: "off" | "low" | "mid" | "high";
  lookStyle?: string | null;
  hookStyle?: string | null;
  director?: import("@/lib/ai/director-lock").ShotAgentLock | null;
  bedMusic?: boolean;
  bedSongUrl?: string;
};

export type EpisodeVideoResult = {
  url: string | null;
  sourceUrl?: string | null;
  subtitleUrl?: string | null;
  captionCues?: {
    captions: { start: number; end: number; line: string }[];
    flowers: { start: number; end: number; line: string }[];
  };
  model: string;
  shots?: VideoShot[];
  composed?: boolean;
};

export function videoGenConfigured(): boolean {
  return resolveArkVideoConfig() !== null || hasCloudflareAiReady();
}

export function videoGenPresets() {
  return listArkVideoPresets();
}

export function videoGenModels() {
  return listArkVideoModels();
}

export async function videoGenModelsWithOpen() {
  return listArkVideoModelsWithOpen();
}

export async function dubEpisodeVideo(
  input: {
    videoUrl: string;
    voiceover: string;
    voiceId?: string;
  },
  onProgress?: (event: VideoGenProgress) => void | Promise<void>,
): Promise<EpisodeVideoResult> {
  return dubExistingEpisodeVideo(input, onProgress);
}

export async function generateEpisodeVideo(
  input: EpisodeVideoInput,
  onProgress?: (event: VideoGenProgress) => void | Promise<void>,
): Promise<EpisodeVideoResult> {
  if (!videoGenConfigured()) {
    throw new Error(
      "还没配方舟。请设置 ARK_API_KEY",
    );
  }
  return generateArkEpisodeVideo(input, onProgress);
}
