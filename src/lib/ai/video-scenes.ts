import { manhuaScenePrompt } from "@/lib/ai/manhua-look";
import {
  generateImageWithChat,
  loadImageRef,
  type ImageInlineRef,
} from "@/lib/ai/openai-image";
import type { VideoCharacterAngle, VideoCharacterPhoto, VideoShot } from "@/lib/types";

async function characterRefs(input: {
  angles?: VideoCharacterAngle[];
}): Promise<ImageInlineRef[]> {
  const urls: string[] = [];
  const front =
    input.angles?.find((a) => a.id === "front") ||
    input.angles?.find((a) => a.url);
  if (front?.url) urls.push(front.url);
  // 分镜只喂正面设定，避免旧的写实侧脸把画风拉回去。
  const refs: ImageInlineRef[] = [];
  for (const url of urls.slice(0, 3)) {
    const ref = await loadImageRef(url);
    if (ref) refs.push(ref);
  }
  return refs;
}

export type SceneGenProgress = {
  index: number;
  total: number;
  done: number;
  message: string;
  shot?: VideoShot;
};

export async function generateEpisodeScenes(input: {
  shots: VideoShot[];
  characterName?: string;
  photos?: VideoCharacterPhoto[];
  angles?: VideoCharacterAngle[];
  characters?: Array<{
    name?: string;
    photos?: VideoCharacterPhoto[];
    angles?: VideoCharacterAngle[];
  }>;
  force?: boolean;
  onlyIndexes?: number[];
  onProgress?: (event: SceneGenProgress) => void | Promise<void>;
}): Promise<VideoShot[]> {
  if (input.shots.length === 0) {
    throw new Error("这集还没有分镜，先写出剧本");
  }
  const only = (input.onlyIndexes || [])
    .map((n) => Math.round(Number(n)))
    .filter((n) => Number.isFinite(n) && n > 0);
  const targets = only.length > 0 ? new Set(only) : null;
  if (targets) {
    const missing = [...targets].filter(
      (index) => !input.shots.some((shot) => shot.index === index),
    );
    if (missing.length > 0) {
      throw new Error(`没有第 ${missing.join("、")} 镜，无法重出`);
    }
  }
  const people =
    input.characters && input.characters.length > 0
      ? input.characters
      : [
          {
            name: input.characterName,
            photos: input.photos,
            angles: input.angles,
          },
        ];
  const refs: ImageInlineRef[] = [];
  for (const person of people) {
    for (const ref of await characterRefs(person)) {
      refs.push(ref);
      if (refs.length >= 4) break;
    }
    if (refs.length >= 4) break;
  }
  const names = people
    .map((person) => person.name?.trim())
    .filter((name): name is string => Boolean(name));
  const who = names.join("、");
  const pending = input.shots.filter((shot) =>
    targets
      ? targets.has(shot.index)
      : input.force || !shot.sceneUrl?.trim(),
  );
  const total = pending.length || input.shots.length;
  const out: VideoShot[] = [];
  let done = 0;

  for (const shot of input.shots) {
    const redo = targets
      ? targets.has(shot.index)
      : input.force || !shot.sceneUrl?.trim();
    if (!redo) {
      out.push(shot);
      continue;
    }
    await input.onProgress?.({
      index: shot.index,
      total,
      done,
      message: targets
        ? `第 ${shot.index} 镜分镜重出中…`
        : `第 ${shot.index} 镜分镜生成中（${done + 1}/${total}）…`,
    });
    const prompt = manhuaScenePrompt({
      who: who
        ? names.map((n) => `「${n}」`).join("、")
        : "",
      visual: shot.visual,
      imagePrompt: shot.imagePrompt,
      voiceover: shot.voiceover,
    });
    const { url } = await generateImageWithChat(prompt, {
      aspectRatio: "9:16",
      references: refs.length ? refs : undefined,
    });
    const nextShot = { ...shot, sceneUrl: url };
    delete nextShot.clipUrl;
    out.push(nextShot);
    done += 1;
    await input.onProgress?.({
      index: shot.index,
      total,
      done,
      message: targets
        ? `第 ${shot.index} 镜分镜已就绪`
        : `第 ${shot.index} 镜分镜已就绪（${done}/${total}）`,
      shot: nextShot,
    });
  }
  return out;
}
