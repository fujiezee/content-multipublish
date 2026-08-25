import { completeScriptLlm, listScriptLlmOptions, streamScriptLlm } from "@/lib/ai/script-llm";
import { listAiModels } from "@/lib/db";
import { modelHasBillablePrice } from "@/lib/ai/model-catalog/pricing";
import {
  MUSIC_AI_MODEL_SEED,
  hasSunoReady,
} from "@/lib/ai/model-catalog/music-seed";
import type { AiModelBadge } from "@/lib/ai/model-catalog/types";
import { listImageGenModels } from "@/lib/ai/image-gen-models";
import { rewritePublicMediaUrl } from "@/lib/content/media-urls";
import type { ArticleVideoEpisode, ArticleVideoSeries } from "@/lib/types";

export type MusicGenOption = {
  id: string;
  label: string;
  hint: string;
  cost: string;
  ready: boolean;
  providerModel: string;
  badges?: AiModelBadge[];
};

export type SeriesMusicTrack = {
  id: string;
  url: string;
  streamUrl?: string;
  title?: string;
  duration?: number;
  /** 这一版自己的封面；每首歌可不同 */
  coverUrl?: string;
};

export type SeriesMusicState = {
  status: "idle" | "pending" | "processing" | "ready" | "failed";
  taskId: string;
  model: string;
  style: string;
  vocal: "m" | "f";
  error: string;
  tracks: SeriesMusicTrack[];
  selectedTrackId: string;
  mixIntoVideo: boolean;
  styleTags: string[];
  styleExtra: string;
  lyricsModel: string;
  /** 歌曲名（给 Suno / 汽水用），不是文章标题 */
  songTitle: string;
  /** 专辑封面公网 URL */
  coverUrl: string;
  /** 出封面用的图像模型 slug */
  coverModel: string;
  /** 出歌时是否一并出封面；可关 */
  coverWanted: boolean;
  /** 正在补封面时的时间戳，防止并发 GET 各出一套图互相覆盖 */
  coverFillingAt?: number;
};

export function parseSeriesMusic(raw?: string | null): SeriesMusicState {
  try {
    const parsed = JSON.parse(raw || "{}") as Partial<SeriesMusicState>;
    const tracks = Array.isArray(parsed.tracks)
      ? parsed.tracks
          .map((row) => ({
            id: String(row.id || ""),
            url: String(row.url || "").trim(),
            streamUrl: String(row.streamUrl || "").trim() || undefined,
            title: row.title,
            duration:
              typeof row.duration === "number" ? row.duration : undefined,
            coverUrl: rewritePublicMediaUrl(String(row.coverUrl || "").trim()) || undefined,
          }))
          .filter((row) => row.id)
      : [];
    const status =
      parsed.status === "pending" ||
      parsed.status === "processing" ||
      parsed.status === "ready" ||
      parsed.status === "failed"
        ? parsed.status
        : "idle";
    const songTitle = String(parsed.songTitle || "").trim();
    const legacyCover = rewritePublicMediaUrl(String(parsed.coverUrl || "").trim());
    const selectedTrackId = String(
      parsed.selectedTrackId || tracks[0]?.id || "",
    );
    const tracksWithCover = tracks.map((row, index) => {
      if (row.coverUrl) return row;
      if (
        legacyCover &&
        (row.id === selectedTrackId || (!selectedTrackId && index === 0))
      ) {
        return { ...row, coverUrl: legacyCover };
      }
      return row;
    });
    const selectedCover =
      tracksWithCover.find((row) => row.id === selectedTrackId)?.coverUrl ||
      tracksWithCover.find((row) => row.coverUrl)?.coverUrl ||
      legacyCover;
    return {
      status,
      taskId: String(parsed.taskId || ""),
      model: String(parsed.model || "suno-v5-5"),
      style: String(parsed.style || ""),
      vocal: parsed.vocal === "f" ? "f" : "m",
      error: String(parsed.error || ""),
      tracks: tracksWithCover,
      selectedTrackId,
      mixIntoVideo: parsed.mixIntoVideo !== false,
      styleTags: Array.isArray(parsed.styleTags)
        ? parsed.styleTags.filter((row): row is string => typeof row === "string")
        : [],
      styleExtra: String(parsed.styleExtra || ""),
      lyricsModel: String(parsed.lyricsModel || ""),
      songTitle,
      coverUrl: selectedCover || "",
      coverModel: String(parsed.coverModel || "").trim(),
      coverWanted: parsed.coverWanted !== false,
      coverFillingAt: Number(parsed.coverFillingAt || 0) || 0,
    };
  } catch {
    return {
      status: "idle",
      taskId: "",
      model: "suno-v5-5",
      style: "",
      vocal: "m",
      error: "",
      tracks: [],
      selectedTrackId: "",
      mixIntoVideo: true,
      styleTags: [],
      styleExtra: "",
      lyricsModel: "",
      songTitle: "",
      coverUrl: "",
      coverModel: "",
      coverWanted: true,
      coverFillingAt: 0,
    };
  }
}

export function stringifySeriesMusic(state: SeriesMusicState): string {
  return JSON.stringify(state);
}

/** 新一轮 Suno 曲目合并进来时，保留已有的分轨封面。 */
export function mergeMusicTracks(
  previous: SeriesMusicTrack[],
  next: SeriesMusicTrack[],
): SeriesMusicTrack[] {
  const byId = new Map(
    previous.map((row) => [row.id, row] as const),
  );
  return next.map((row) => {
    const old = byId.get(row.id);
    const coverUrl = row.coverUrl || old?.coverUrl || undefined;
    return coverUrl ? { ...row, coverUrl } : row;
  });
}

/** 选中轨的封面同步到顶层 coverUrl，方便听歌页 / 发布兜底。 */
export function syncSelectedTrackCover(state: SeriesMusicState): SeriesMusicState {
  const picked =
    state.tracks.find((row) => row.id === state.selectedTrackId) ||
    state.tracks[0];
  const coverUrl = (picked?.coverUrl || state.coverUrl || "").trim();
  return { ...state, coverUrl };
}

export { musicNeedsCoverFill } from "@/lib/ai/music-cover-fill";

export function listMusicGenModels(): MusicGenOption[] {
  const ready = hasSunoReady();
  try {
    const rows = listAiModels({
      modality: "music",
      use: "music",
      enabledOnly: true,
    }).filter((row) => row.provider === "suno" && modelHasBillablePrice(row));
    if (rows.length) {
      return rows.map((row) => ({
        id: row.slug,
        label: row.label,
        hint: row.hint || "",
        cost: row.costHint || "",
        ready: ready && row.ready,
        providerModel: row.providerModel,
        badges: row.badges,
      }));
    }
  } catch {
    // build / edge
  }
  return MUSIC_AI_MODEL_SEED.filter((row) => row.enabled !== false).map(
    (row) => ({
      id: row.slug,
      label: row.label,
      hint: row.hint || "",
      cost: row.costHint || "",
      ready,
      providerModel: row.providerModel,
      badges: row.badges,
    }),
  );
}

export function resolveMusicProviderModel(slug: string): string {
  const hit = listMusicGenModels().find((row) => row.id === slug);
  return hit?.providerModel || "V5";
}

/** 汽水上架至少 1 分钟；出歌目标约 90–120 秒，但不要硬截。 */
export const MUSIC_MIN_DURATION_SEC = 60;
export const MUSIC_TARGET_DURATION_SEC = 90;

/** 曲风旁注：拉长成完整歌，并要求自然收尾，避免平台判「末尾截断」。 */
export function musicStyleWithDuration(
  style: string,
  durationSec = MUSIC_TARGET_DURATION_SEC,
): string {
  const base = String(style || "").trim() || "中文流行";
  const note = `完整成曲约${durationSec}到120秒，带自然淡出收尾，不要短片段，不要在副歌或唱词中间突然切断`;
  if (base.includes("自然淡出") || /约\d+到\d+秒/.test(base)) {
    return base.slice(0, 1000);
  }
  return `${base}, ${note}`.slice(0, 1000);
}

export function cleanLyricsDraft(text: string): string {
  return parseLyricsDraft(text).lyrics;
}

/** 从模型输出里拆出歌名和歌词正文。 */
export function parseLyricsDraft(text: string): {
  songTitle: string;
  lyrics: string;
} {
  const raw = text.replace(/^```[\s\S]*?```$/m, "").trim();
  if (!raw) return { songTitle: "", lyrics: "" };

  const lines = raw.split(/\r?\n/);
  let songTitle = "";
  let start = 0;
  const first = lines[0]?.trim() || "";
  const titled =
    /^(?:歌名|曲名|歌曲名|title)\s*[:：]\s*(.+)$/i.exec(first) ||
    /^[《「『](.+?)[》」』]\s*$/.exec(first);
  if (titled?.[1]) {
    songTitle = titled[1].trim();
    start = 1;
    while (start < lines.length && !lines[start].trim()) start += 1;
  }

  const lyrics = lines.slice(start).join("\n").trim();
  return {
    songTitle: sanitizeSongTitle(songTitle),
    lyrics,
  };
}

/** 歌名要短、像歌，别整段文章标题。 */
export function sanitizeSongTitle(raw: string, max = 16): string {
  let title = String(raw || "")
    .replace(/[《》「」『』【】\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  title = title.replace(/(片尾曲|主题曲|插曲|配乐)$/u, "").trim();
  if (!title) return "";
  const chars = Array.from(title);
  if (chars.length > max) title = chars.slice(0, max).join("").trim();
  return title;
}

function looksLikeArticleTitle(songTitle: string, articleTitle: string): boolean {
  const a = sanitizeSongTitle(songTitle, 40);
  const b = sanitizeSongTitle(articleTitle, 40);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 8 && (b.includes(a) || a.includes(b))) return true;
  return false;
}

function seriesLyricsMessages(input: {
  title: string;
  logline?: string;
  style?: string;
  episodes: Pick<ArticleVideoEpisode, "episode_no" | "title" | "voiceover">[];
}): { role: "system" | "user"; content: string }[] {
  const story = input.episodes
    .slice(0, 4)
    .map(
      (ep) =>
        `第${ep.episode_no}集 ${ep.title}\n${String(ep.voiceover || "").slice(0, 500)}`,
    )
    .join("\n\n");
  return [
    {
      role: "system",
      content:
        "你给竖屏短剧写片尾曲。第一行必须是「歌名: xxx」，歌名 2–8 个汉字，像歌名不像文章标题或剧名，不要加「片尾曲」。空一行后写完整可唱歌词（汽水上架至少满 1 分钟，目标约 90–120 秒）：用 [Verse] / [Chorus] / [Bridge] / [Outro] 分段；至少主歌两段、副歌两遍，再加桥段或第三主歌，最后必须有 [Outro] 收尾（两到四行，适合淡出，不要在高潮中间停）。每段四到八行，押一点韵，口语能唱，贴剧情情绪。不要解释，不要广告词，不要英文副歌，不要写成十几秒的短片段。",
    },
    {
      role: "user",
      content: `剧名：${input.title || "短剧"}\n曲风：${input.style || "中文流行"}\n简介：${input.logline || "无"}\n\n剧情：\n${story || "还没写出对白，按剧情情绪写一首能当片尾的完整歌。歌名不要直接用剧名。"}`,
    },
  ];
}

function standaloneLyricsMessages(input: {
  title: string;
  excerpt?: string;
  style?: string;
}): { role: "system" | "user"; content: string }[] {
  const body = String(input.excerpt || "").trim();
  return [
    {
      role: "system",
      content:
        "你根据文章写一首能完整上架的歌。第一行必须是「歌名: xxx」，歌名 2–8 个汉字，像歌名不像文章标题，不要照搬标题，不要加「片尾曲」。空一行后写完整可唱歌词（汽水/抖音曲库至少满 1 分钟，目标约 90–120 秒）：用 [Verse] / [Chorus] / [Bridge] / [Outro] 分段；至少主歌两段、副歌两遍，再加桥段或第三主歌，最后必须有 [Outro] 收尾（两到四行，适合淡出，不要在高潮中间停）。每段四到八行，押一点韵，口语能唱。歌词贴文章讲的事和情绪，不要空泛鸡汤，不要广告词，不要英文副歌，不要解释，不要写成短视频十几秒片段。",
    },
    {
      role: "user",
      content: `文章标题（仅供参考主题，不要当歌名）：${input.title || "未命名"}\n曲风：${input.style || "中文流行"}\n\n文章内容：\n${body || "正文还没写，按主题写，但歌名和歌词都不要编成标题复读。"}`,
    },
  ];
}

export type LyricsStreamEvent =
  | { type: "thinking"; delta: string }
  | { type: "content"; delta: string }
  | { type: "done"; lyrics: string; songTitle: string }
  | { type: "error"; message: string };

function lyricsModelError(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  if (!raw.trim()) return "写歌词失败，请再试一次";
  if (/超时|timeout|AbortError/i.test(raw)) {
    return "写歌词超时，换 DeepSeek 对话或再试一次";
  }
  if (/空内容|empty/i.test(raw)) {
    return "写歌词没写出内容，换个模型或再试一次";
  }
  if (/API\s*401|Unauthorized|invalid.?api.?key/i.test(raw)) {
    return "写歌词的模型通道没配好";
  }
  if (/API\s*402|insufficient|余额|credit/i.test(raw)) {
    return "写歌词的模型额度不够";
  }
  if (/DeepSeek API \d+/.test(raw) || /API\s*[45]\d\d/.test(raw)) {
    return "写歌词服务没有返回内容，请再试一次";
  }
  return raw.slice(0, 180);
}

export async function* streamLyricsDraft(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
): AsyncGenerator<LyricsStreamEvent> {
  try {
    let text = "";
    for await (const chunk of streamScriptLlm(messages, {
      maxTokens: 16384,
      temperature: 0.8,
      timeoutMs: 240_000,
    })) {
      if (chunk.type === "thinking" && chunk.text) {
        yield { type: "thinking", delta: chunk.text };
      }
      if (chunk.type === "content" && chunk.text) {
        text += chunk.text;
        yield { type: "content", delta: chunk.text };
      }
    }
    let lyrics = cleanLyricsDraft(text);
    if (!lyrics) {
      text = "";
      for await (const chunk of streamScriptLlm(messages, {
        model: "deepseek-chat",
        maxTokens: 8192,
        temperature: 0.8,
        timeoutMs: 180_000,
      })) {
        if (chunk.type === "thinking" && chunk.text) {
          yield { type: "thinking", delta: chunk.text };
        }
        if (chunk.type === "content" && chunk.text) {
          text += chunk.text;
          yield { type: "content", delta: chunk.text };
        }
      }
      lyrics = cleanLyricsDraft(text);
    }
    if (!lyrics) {
      yield {
        type: "error",
        message: "写歌词没写出内容，换个模型或再试一次",
      };
      return;
    }
    const parsed = parseLyricsDraft(text);
    yield {
      type: "done",
      lyrics: parsed.lyrics || lyrics,
      songTitle: parsed.songTitle,
    };
  } catch (err) {
    yield {
      type: "error",
      message: lyricsModelError(err),
    };
  }
}

export async function draftSongTitle(input: {
  lyrics: string;
  articleTitle?: string;
  style?: string;
}): Promise<string> {
  const lyrics = String(input.lyrics || "").trim().slice(0, 800);
  if (!lyrics) return "";
  const text = await completeScriptLlm(
    [
      {
        role: "system",
        content:
          "你给一首已有歌词起歌名。只输出歌名本身，2–8 个汉字，像歌名不像文章标题。不要书名号，不要「片尾曲」，不要解释。",
      },
      {
        role: "user",
        content: `参考主题（不要照搬）：${input.articleTitle || "无"}\n曲风：${input.style || "中文流行"}\n\n歌词：\n${lyrics}`,
      },
    ],
    { maxTokens: 32, temperature: 0.7 },
  );
  const title = sanitizeSongTitle(parseLyricsDraft(`歌名: ${text}`).songTitle || text);
  if (!title || looksLikeArticleTitle(title, input.articleTitle || "")) {
    return "";
  }
  return title;
}

/** 出歌用的最终歌名：优先已有歌名，否则从歌词现起，绝不直接甩文章标题。 */
export async function resolveMusicSongTitle(input: {
  songTitle?: string;
  lyrics: string;
  articleTitle?: string;
  style?: string;
}): Promise<string> {
  const existing = sanitizeSongTitle(input.songTitle || "");
  if (existing && !looksLikeArticleTitle(existing, input.articleTitle || "")) {
    return existing;
  }
  try {
    const drafted = await draftSongTitle({
      lyrics: input.lyrics,
      articleTitle: input.articleTitle,
      style: input.style,
    });
    if (drafted) return drafted;
  } catch {
    // fall through
  }
  const fromLyrics = sanitizeSongTitle(
    input.lyrics
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !/^(副歌|主歌|bridge)/i.test(line)) || "",
    8,
  );
  if (fromLyrics && !looksLikeArticleTitle(fromLyrics, input.articleTitle || "")) {
    return fromLyrics;
  }
  return "未名曲";
}

export async function* streamSeriesLyrics(input: {
  title: string;
  logline?: string;
  style?: string;
  episodes: Pick<ArticleVideoEpisode, "episode_no" | "title" | "voiceover">[];
}): AsyncGenerator<LyricsStreamEvent> {
  yield* streamLyricsDraft(seriesLyricsMessages(input));
}

export async function* streamStandaloneLyrics(input: {
  title: string;
  excerpt?: string;
  style?: string;
}): AsyncGenerator<LyricsStreamEvent> {
  yield* streamLyricsDraft(standaloneLyricsMessages(input));
}

export async function draftSeriesLyrics(input: {
  title: string;
  logline?: string;
  style?: string;
  episodes: Pick<ArticleVideoEpisode, "episode_no" | "title" | "voiceover">[];
}): Promise<string> {
  const text = await completeScriptLlm(seriesLyricsMessages(input), {
    maxTokens: 8192,
    temperature: 0.8,
  });
  return cleanLyricsDraft(text);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function articleMusicSource(article: {
  title?: string;
  script_title?: string;
  summary?: string;
  body?: string;
}): { title: string; excerpt: string } {
  const title = String(article.title || article.script_title || "").trim();
  const excerpt = [
    String(article.summary || "").trim(),
    stripHtml(article.body || ""),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2800);
  return { title, excerpt };
}

export async function draftStandaloneLyrics(input: {
  title: string;
  excerpt?: string;
  style?: string;
}): Promise<string> {
  const text = await completeScriptLlm(standaloneLyricsMessages(input), {
    maxTokens: 8192,
    temperature: 0.8,
  });
  return cleanLyricsDraft(text);
}

export function selectedMusicUrl(music: SeriesMusicState): string {
  const picked =
    music.tracks.find((row) => row.id === music.selectedTrackId) ||
    music.tracks.find((row) => row.url || row.streamUrl);
  return (picked?.url || picked?.streamUrl || "").trim();
}

export function musicPublicPayload(series: ArticleVideoSeries | null) {
  const music = parseSeriesMusic(series?.music_json);
  let lyricsModels: ReturnType<typeof listScriptLlmOptions> = [];
  try {
    lyricsModels = listScriptLlmOptions();
  } catch {
    lyricsModels = [];
  }
  let coverModels: Array<{
    id: string;
    label: string;
    hint: string;
    ready: boolean;
    badges?: AiModelBadge[];
  }> = [];
  try {
    coverModels = listImageGenModels().map((row) => ({
      id: row.id,
      label: row.label,
      hint: row.hint,
      ready: row.ready !== false,
      cost: row.cost,
      badges: row.badges,
    }));
  } catch {
    coverModels = [];
  }
  return {
    lyrics: series?.lyrics || "",
    music,
    models: listMusicGenModels(),
    lyricsModels,
    coverModels,
    ready: hasSunoReady(),
    songUrl: selectedMusicUrl(music),
  };
}
