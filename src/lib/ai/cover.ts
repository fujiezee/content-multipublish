import { generateGeminiStill, generateImageWithChat } from "@/lib/ai/openai-image";
import { resolveCoverImageModelId } from "@/lib/ai/image-gen-models";

/** Common feed / article cover sizes we actually generate. */
export const COVER_PRESETS = {
  /** 文章页默认封面：头条/百家号/多数媒体头图都是 16:9 */
  article: { aspectRatio: "16:9", pixels: "1920×1080" },
  /** 抖音图文/文章信息流封面，主页卡片也按这个裁 */
  douyin_cover: { aspectRatio: "3:4", pixels: "1080×1440" },
  /** 抖音/头条类文章头图，铺在正文顶上 */
  douyin_header: { aspectRatio: "16:9", pixels: "1920×1080" },
  /** 汽水/抖音曲库专辑封面 */
  music_album: { aspectRatio: "1:1", pixels: "1400×1400" },
  /** 播客封面：小宇宙/播客客户端方图 */
  podcast: { aspectRatio: "1:1", pixels: "1400×1400" },
} as const;

export type CoverPreset = keyof typeof COVER_PRESETS;

function excerptOf(text: string, max = 90): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

export async function generateArticleCover(input: {
  title: string;
  bodyText?: string;
  preset: CoverPreset;
}): Promise<{ url: string; model: string; aspectRatio: string }> {
  const spec = COVER_PRESETS[input.preset];
  const title = input.title.trim().slice(0, 28) || "封面";
  const excerpt = excerptOf(input.bodyText || "", 90);
  const vertical = spec.aspectRatio === "3:4" || spec.aspectRatio === "9:16";
  const prompt = [
    `直接生成一张图片，不要用文字解释。`,
    `${vertical ? "竖版" : "横版"}中文文章封面，比例 ${spec.aspectRatio}，约 ${spec.pixels}。`,
    `画面中央大号中文标题：「${title}」。`,
    excerpt ? `主题：${excerpt}` : "",
    "高对比、少文字、无水印、无二维码、无网址、无 logo。",
  ]
    .filter(Boolean)
    .join("\n");

  const out = await generateGeminiStill(prompt, {
    aspectRatio: spec.aspectRatio,
  });
  return { ...out, aspectRatio: spec.aspectRatio };
}

/** 歌曲专辑封面：1:1，可选模型（Seedream / Gemini）。 */
export async function generateMusicCover(input: {
  songTitle: string;
  lyrics?: string;
  style?: string;
  model?: string;
  /** 同批多首歌时区分画面，避免每张一样 */
  variant?: string;
}): Promise<{ url: string; model: string; aspectRatio: string }> {
  const spec = COVER_PRESETS.music_album;
  const title = input.songTitle.trim().slice(0, 16) || "未名曲";
  const mood = excerptOf(input.lyrics || "", 80);
  const style = excerptOf(input.style || "中文流行", 40);
  const variant = excerptOf(input.variant || "", 40);
  const prompt = [
    `直接生成一张图片，不要用文字解释。`,
    `正方形音乐专辑封面，比例 1:1，约 ${spec.pixels}。`,
    `歌曲名氛围：「${title}」。`,
    style ? `曲风：${style}。` : "",
    mood ? `情绪与画面暗示：${mood}` : "",
    variant ? `这一版的独特视觉：${variant}。` : "",
    "像可上架汽水/抖音曲库的专辑封面：氛围感强、构图干净、高对比。",
    "不要水印、二维码、网址、平台 logo；少字或无字，不要大段歌词。",
    "同一首歌的不同版本封面要明显不同，换构图、色调和主体。",
  ]
    .filter(Boolean)
    .join("\n");

  const modelId = String(input.model || "").trim() || resolveCoverImageModelId();
  const out = await generateImageWithChat(prompt, {
    aspectRatio: spec.aspectRatio,
    model: modelId,
  });
  return { ...out, aspectRatio: spec.aspectRatio };
}

/** 文章播客封面：1:1。单人近景口播，问答两人面对面。 */
export async function generatePodcastCover(input: {
  title: string;
  mode: "dialogue" | "solo";
  excerpt?: string;
  lines?: string;
  pains?: string;
  model?: string;
}): Promise<{ url: string; model: string; aspectRatio: string }> {
  const spec = COVER_PRESETS.podcast;
  const title = input.title.trim().slice(0, 18) || "对谈";
  const excerpt = excerptOf(input.excerpt || "", 90);
  const lines = excerptOf(input.lines || "", 80);
  const pains = excerptOf(input.pains || "", 50);
  const dialogue = input.mode !== "solo";
  const staging = dialogue
    ? "画面必须是两个人在问答：一问一答、面对面或隔桌对坐，各一支麦克风。像访谈播客，不要演唱会，不要专辑，不要群像，不要只有一个人。"
    : "画面必须只有一个人出镜：近景口播，一支麦克风，像单人电台。不要第二个人，不要访谈桌，不要对坐。";
  const prompt = [
    `直接生成一张图片，不要用文字解释。`,
    `正方形播客节目封面，比例 1:1，约 ${spec.pixels}。`,
    staging,
    `节目名氛围：「${title}」。`,
    excerpt ? `内容主题：${excerpt}` : "",
    pains ? `对准的痛点：${pains}` : "",
    lines ? `对白气味：${lines}` : "",
    "像能上小宇宙的节目封面：氛围清楚、构图干净、高对比。",
    "可以有短标题，不要大段字、水印、二维码、网址、平台 logo。",
  ]
    .filter(Boolean)
    .join("\n");

  const modelId = String(input.model || "").trim() || resolveCoverImageModelId();
  const out = await generateImageWithChat(prompt, {
    aspectRatio: spec.aspectRatio,
    model: modelId,
  });
  return { ...out, aspectRatio: spec.aspectRatio };
}
