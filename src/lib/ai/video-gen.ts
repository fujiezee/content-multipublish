import {
  dubExistingEpisodeVideo,
  generateArkEpisodeVideo,
  listArkVideoModels,
  listArkVideoPresets,
  resolveArkVideoConfig,
  type VideoGenProgress,
} from "@/lib/ai/ark-video";
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
  force?: boolean;
  onlyIndexes?: number[];
  composeOnly?: boolean;
};

export type EpisodeVideoResult = {
  url: string | null;
  model: string;
  shots?: VideoShot[];
  composed?: boolean;
};

export function videoGenConfigured(): boolean {
  return resolveArkVideoConfig() !== null;
}

export function videoGenPresets() {
  return listArkVideoPresets();
}

export function videoGenModels() {
  return listArkVideoModels();
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
      "还没配方舟。在提及检测页填入火山方舟 API Key，或在 .env.local 设置 ARK_API_KEY",
    );
  }
  return generateArkEpisodeVideo(input, onProgress);
}
