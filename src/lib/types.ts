export type PlatformId =
  | "zhihu"
  | "weibo"
  | "baijiahao"
  | "jianshu"
  | "csdn"
  | "toutiao"
  | "juejin"
  | "weixin"
  | "bilibili"
  | "douban"
  | "sohu"
  | "dayu"
  | "yidian"
  | "cnblogs"
  | "cto51"
  | "segmentfault"
  | "imooc"
  | "oschina"
  | "yuque"
  | "woshipm"
  | "xueqiu"
  | "sohufocus"
  | "xiaohongshu"
  | "shunqi"
  | "shunqi_product"
  | "bafang"
  | "douyin"
  | "netease"
  | "smzdm"
  | "eastmoney"
  | "x"
  | "qiehao"
  | "dafeng"
  | "kuaichuan"
  | "sinakandian"
  | "dongfang"
  | "btime"
  | "peoplehao"
  | "xinhuahao"
  | "zhongqing"
  | "tencentcloud"
  | "aliyun"
  | "huaweicloud"
  | "dianwu";

export type SessionStatus = "connected" | "disconnected" | "expired";

/**
 * Job lifecycle:
 * - pending / running: in flight
 * - draft_ok: saved to platform draft box
 * - filled_awaiting_publish: form filled (XHS etc.), user must click publish
 * - published: live on platform
 * - success: legacy alias for draft_ok (imported history)
 * - failed: hard failure
 */
export type JobStatus =
  | "pending"
  | "running"
  | "draft_ok"
  | "filled_awaiting_publish"
  | "published"
  | "success"
  | "failed";

/** extension = Chrome draft API; api = Node draft HTTP; playwright = local browser automation */
export type PublishEngine = "extension" | "playwright" | "api";

export function normalizePublishEngine(value: unknown): PublishEngine {
  if (value === "extension" || value === "api") return value;
  return "playwright";
}

export interface Article {
  id: string;
  title: string;
  body: string;
  summary: string;
  cover_path: string | null;
  /** 主稿时一并起的短视频合集名 */
  script_title?: string;
  /** SaaS workspace ownership (nullable for legacy rows → default workspace). */
  workspace_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArticleInfographic {
  id: string;
  article_id: string;
  /** master = 长文共用；social = 社媒单独 */
  family: string;
  url: string;
  headline: string;
  kind: string;
  card_json: string;
  anchor_text: string;
  insert_hint: string;
  created_at: string;
}

export type PodcastMode = "dialogue" | "solo";
export type PodcastStatus = "idle" | "pending" | "ready" | "failed";
export type PodcastSpeaker = "host" | "guest";

export type PodcastTurn = {
  index: number;
  speaker: PodcastSpeaker;
  name: string;
  text: string;
  audioUrl: string;
  durationSec: number;
  /** 配音演法，不进听众看到的正文 */
  feel?: string;
};

/** 文章的听读版：同一篇 GEO 稿的对谈/口播，不走短视频合集 */
export interface ArticlePodcast {
  id: string;
  article_id: string;
  title: string;
  mode: PodcastMode;
  host_voice: string;
  guest_voice: string;
  tts_model: string;
  status: PodcastStatus;
  error: string | null;
  audio_url: string | null;
  cover_url: string | null;
  duration_sec: number;
  turns_json: string;
  created_at: string;
  updated_at: string;
}

export type VideoScriptGenre = "edu" | "drama";

export type VideoScriptHookStyle =
  | "talk"
  | "roast"
  | "confess"
  | "argue"
  | "expose"
  | "contrast"
  | "drama"
  | "isekai"
  | "rebirth"
  | "system"
  | "tycoon"
  | "revenge"
  | "romance"
  | "workplace"
  | "court";

export type VideoSpeakMode = "narration" | "dialogue";
export type ShotDelivery = "line" | "inner";

export const SHOT_SOUND_ROLES = ["speak", "inner", "hit", "hold"] as const;
export type ShotSoundRole = (typeof SHOT_SOUND_ROLES)[number];

export function normalizeSoundRole(value: unknown): ShotSoundRole | "" {
  return (SHOT_SOUND_ROLES as readonly string[]).includes(String(value || ""))
    ? (value as ShotSoundRole)
    : "";
}

export const SHOT_JOINS = ["continue", "cut", "away"] as const;
export type ShotJoin = (typeof SHOT_JOINS)[number];

export function normalizeShotJoin(value: unknown): ShotJoin | "" {
  if (value === "continue" || value === "cut" || value === "away") return value;
  if (value === "接戏" || value === "同场") return "continue";
  if (value === "切镜" || value === "硬切") return "cut";
  if (value === "换场") return "away";
  return "";
}
export type VideoVoicePath = "native" | "tts" | "lipsync";
export type InnerVoiceLevel = "off" | "low" | "mid" | "high";

const INNER_LEVEL_ALIASES: Record<string, InnerVoiceLevel> = {
  off: "off",
  关: "off",
  low: "low",
  压: "low",
  轻: "low",
  mid: "mid",
  震: "mid",
  中: "mid",
  high: "high",
  炸: "high",
  强: "high",
};

export function resolveInnerVoice(raw: unknown): InnerVoiceLevel {
  const t = String(raw || "").trim();
  return INNER_LEVEL_ALIASES[t] || INNER_LEVEL_ALIASES[t.toLowerCase()] || "off";
}

export function innerVoiceMark(
  level?: InnerVoiceLevel | "" | null,
): "·压" | "·震" | "·炸" | "" {
  if (level === "high") return "·炸";
  if (level === "mid") return "·震";
  if (level === "low") return "·压";
  return "";
}

export function innerVoiceLabel(level: InnerVoiceLevel): string {
  return { off: "关", low: "压", mid: "震", high: "炸" }[level];
}

export function resolveVoicePath(raw: unknown): VideoVoicePath {
  if (raw === "tts" || raw === "lipsync") return raw;
  return "native";
}

export const SHOT_SIZES = ["特写", "近景", "中景", "远景"] as const;
export type ShotSize = (typeof SHOT_SIZES)[number];

export const SHOT_ANGLES = ["平视", "仰视", "俯视", "过肩", "侧"] as const;
export type ShotAngle = (typeof SHOT_ANGLES)[number];

export type ShotPlate = {
  size: ShotSize;
  angle: ShotAngle;
  framing: string;
  light: string;
  grade: string;
  motion: string;
};

export type ShotQaFlag = "late-open" | "same-size" | "no-speech" | "voice-drift";

export function shotCanLipSync(
  shot?: Pick<
    VideoShot,
    "clipUrl" | "delivery" | "speaker" | "voiceover" | "soundRole"
  > | null,
): boolean {
  if (!shot?.clipUrl?.trim() || shotIsInner(shot)) return false;
  const role = normalizeSoundRole(shot.soundRole);
  if (role === "inner" || role === "hit" || role === "hold") return false;
  return Boolean(String(shot.voiceover || "").trim());
}

/** 口播 TTS 对口型：静帧已过片、已锁声，还没有成片。 */
export function shotCanAudioDrive(
  shot?: Pick<
    VideoShot,
    | "clipUrl"
    | "speechUrl"
    | "framesOk"
    | "startUrl"
    | "sceneUrl"
    | "endUrl"
    | "delivery"
    | "speaker"
    | "voiceover"
    | "soundRole"
  > | null,
): boolean {
  if (!shot?.speechUrl?.trim() || shotIsInner(shot)) return false;
  if (!shotHasKeyframes(shot) || !shot.framesOk) return false;
  if (shot.clipUrl?.trim()) return false;
  const role = normalizeSoundRole(shot.soundRole);
  if (role === "inner" || role === "hit" || role === "hold") return false;
  return Boolean(String(shot.voiceover || "").trim());
}

/** 开口镜必须先锁 TTS。内心/一声/留白不走这道闸。 */
export function shotNeedsLockedSpeech(
  shot?: Pick<
    VideoShot,
    "delivery" | "speaker" | "voiceover" | "soundRole"
  > | null,
): boolean {
  if (!shot || shotIsInner(shot)) return false;
  const role = normalizeSoundRole(shot.soundRole);
  if (role === "inner" || role === "hit" || role === "hold") return false;
  if (role === "speak") return true;
  return Boolean(String(shot.voiceover || "").trim());
}

export function speakShotsMissingLock(
  shots: Array<
    Pick<
      VideoShot,
      "index" | "delivery" | "speaker" | "voiceover" | "soundRole" | "speechUrl"
    >
  >,
): number[] {
  return shots
    .filter((shot) => shotNeedsLockedSpeech(shot) && !shot.speechUrl?.trim())
    .map((shot) => shot.index)
    .sort((a, b) => a - b);
}

export const DEFAULT_SPEAK_MODE: VideoSpeakMode = "dialogue";

export function normalizeSpeakMode(value: unknown): VideoSpeakMode {
  return value === "dialogue" ? "dialogue" : "narration";
}

const INNER_TAG =
  /[（(](?:内心|独白|心里)(?:[·・.](压|震|炸|轻|中|强|low|mid|high))?[）)]/i;

export function parseInnerLevel(
  raw: unknown,
): Exclude<InnerVoiceLevel, "off"> | "" {
  const direct = resolveInnerVoice(raw);
  if (direct !== "off") return direct;
  const m = String(raw || "").match(INNER_TAG);
  if (!m?.[1]) return "";
  const lvl = resolveInnerVoice(m[1]);
  return lvl === "off" ? "" : lvl;
}

export function isInnerTag(value?: string | null): boolean {
  return INNER_TAG.test(String(value || ""));
}

export function stripInnerTag(value?: string | null): string {
  return String(value || "").replace(INNER_TAG, "").trim();
}

export function normalizeShotDelivery(raw: unknown): ShotDelivery | "" {
  const t = String(raw || "").trim();
  if (t === "inner" || t === "独白" || t === "内心" || isInnerTag(t)) return "inner";
  if (t === "line" || t === "对白") return "line";
  return "";
}

export function shotIsInner(
  shot?: Pick<VideoShot, "delivery" | "speaker" | "voiceover"> | null,
): boolean {
  if (!shot) return false;
  if (shot.delivery === "inner") return true;
  return isInnerTag(shot.speaker) || isInnerTag(String(shot.voiceover || "").slice(0, 20));
}

export function shotInnerLevel(
  shot?: Pick<
    VideoShot,
    "delivery" | "speaker" | "voiceover" | "innerLevel"
  > | null,
  seriesLevel?: InnerVoiceLevel,
): Exclude<InnerVoiceLevel, "off"> | "" {
  if (!shotIsInner(shot)) return "";
  if (shot?.innerLevel) return shot.innerLevel;
  const fromText = parseInnerLevel(`${shot?.speaker || ""}${shot?.voiceover || ""}`);
  if (fromText) return fromText;
  const series = resolveInnerVoice(seriesLevel);
  return series === "off" ? "high" : series;
}

export type VideoEpisodeStatus = "idle" | "generating" | "ready" | "failed";

export type VideoShot = {
  index: number;
  seconds: number;
  visual: string;
  onScreen: string;
  voiceover: string;
  imagePrompt: string;
  speaker?: string;
  speakerId?: string;
  voiceId?: string;
  /** line=张嘴说，inner=心里的声音，闭嘴 */
  delivery?: ShotDelivery;
  /** 内心强烈度：压|震|炸。只在 delivery=inner 时有用 */
  innerLevel?: Exclude<InnerVoiceLevel, "off">;
  /** 钩|共|顶|打|停，这一镜调用观众哪一下 */
  beat?: string;
  /** 开口|内心|一声|留白，这一镜耳朵听什么 */
  soundRole?: ShotSoundRole;
  /** 接戏=接着上镜尾帧；切镜=同场换构图；换场=换地方 */
  join?: ShotJoin;
  /** 镜头看谁：说话的人 / 挨打的人 / 特写 */
  look?: string;
  /** 这一镜唯一运镜：推镜|拉镜|横移|固定。景别在 plate.size */
  camera?: string;
  /** 七要素：景别/角度/构图/光影/色调/动势。转场是 join */
  plate?: ShotPlate;
  /** 成片开口秒数，拉片用。本机 RMS 测出来 */
  speechOnsetSec?: number;
  /** 这一镜看得见的道具名，对应本剧道具设定图 */
  props?: string[];
  sceneUrl?: string;
  startUrl?: string;
  endUrl?: string;
  /** 模型刚吐出的原片。合成只读副本，不得改这个文件 */
  clipUrl?: string;
  rawClipUrl?: string;
  lastFrameUrl?: string;
  /** 对口型用的参考音：旁白是配音，对白是模型先出声再抽出来的 */
  speechUrl?: string;
  /** 头尾静帧人点过才能出片 */
  framesOk?: boolean;
  /** 同镜第二条成片，选片后和 clipUrl 对调 */
  clipAltUrl?: string;
};

export function shotRawClipUrl(
  shot?: Pick<VideoShot, "rawClipUrl" | "clipUrl"> | null,
): string {
  return shot?.rawClipUrl?.trim() || shot?.clipUrl?.trim() || "";
}

export function shotStartUrl(
  shot?: Pick<VideoShot, "startUrl" | "sceneUrl"> | null,
): string {
  return shot?.startUrl?.trim() || shot?.sceneUrl?.trim() || "";
}

export function shotEndUrl(shot?: Pick<VideoShot, "endUrl"> | null): string {
  return shot?.endUrl?.trim() || "";
}

export function shotTailUrl(
  shot?: Pick<VideoShot, "endUrl" | "lastFrameUrl"> | null,
): string {
  return shot?.endUrl?.trim() || shot?.lastFrameUrl?.trim() || "";
}

export function shotHasKeyframes(
  shot?: Pick<VideoShot, "startUrl" | "sceneUrl" | "endUrl"> | null,
): boolean {
  return Boolean(shot && shotStartUrl(shot) && shotEndUrl(shot));
}

export function shotFramesApproved(shot: VideoShot): boolean {
  return shotHasKeyframes(shot) && shot.framesOk === true;
}

export function shotHasImage(
  shot?: Pick<VideoShot, "startUrl" | "endUrl" | "sceneUrl"> | null,
): boolean {
  return Boolean(shotStartUrl(shot) || shotEndUrl(shot));
}

/** 单镜重出默认参考：先找后面已有图的最近一镜，没有再找前面。 */
export function defaultRefShotIndex(
  shots: Array<Pick<VideoShot, "index" | "startUrl" | "endUrl" | "sceneUrl">>,
  currentIndex: number,
): number | undefined {
  const ordered = [...shots].sort((a, b) => a.index - b.index);
  const later = ordered.find(
    (shot) => shot.index > currentIndex && shotHasImage(shot),
  );
  if (later) return later.index;
  const earlier = [...ordered]
    .reverse()
    .find((shot) => shot.index < currentIndex && shotHasImage(shot));
  return earlier?.index;
}

export interface ArticleVideoSeries {
  id: string;
  article_id: string;
  genre: VideoScriptGenre;
  hook_style: string;
  look_style: string;
  props_json: string;
  wardrobe_json: string;
  title: string;
  logline: string;
  premise: string;
  audience: string;
  notes: string;
  episode_count: number;
  duration_sec: number;
  character_id: string | null;
  cast_json: string;
  speak_mode: VideoSpeakMode;
  inner_voice: InnerVoiceLevel;
  voice_id: string;
  lyrics: string;
  music_json: string;
  created_at: string;
  updated_at: string;
}

export type ScriptProp = {
  id: string;
  name: string;
  look: string;
  url: string;
};

export type VideoCharacterPhoto = { url: string };

export type VideoCharacterAngle = {
  id: string;
  label: string;
  url: string;
};

export interface ArticleVideoCharacter {
  id: string;
  article_id: string;
  name: string;
  photos_json: string;
  angles_json: string;
  created_at: string;
  updated_at: string;
}

export type CharacterSource = "photo" | "script";

export interface StudioCharacter {
  id: string;
  workspace_id: string;
  name: string;
  photos_json: string;
  angles_json: string;
  source: CharacterSource;
  article_id: string | null;
  voice_id: string;
  /** 角色档案：性别年龄、五官衣服、标志、定装、习惯 */
  look: string;
  created_at: string;
  updated_at: string;
}

export type CharacterScriptRef = {
  article_id: string;
  title: string;
};

export type CharacterCatalogItem = {
  id: string;
  name: string;
  source: CharacterSource;
  article_id: string | null;
  article_title: string | null;
  voice_id: string;
  look: string;
  scripts: CharacterScriptRef[];
  photos: VideoCharacterPhoto[];
  angles: VideoCharacterAngle[];
  updated_at: string;
};

/** 内容工厂里用户上传/录音克隆的音色 */
export type StudioVoice = {
  id: string;
  workspace_id: string;
  name: string;
  hint: string;
  provider: string;
  provider_voice_id: string;
  provider_model: string;
  sample_url: string;
  created_at: string;
  updated_at: string;
};

export type VideoCatalogItem = {
  article_id: string;
  article_title: string;
  series_id: string;
  series_title: string;
  genre: VideoScriptGenre;
  hook_style?: string;
  episode_id: string;
  episode_no: number;
  episode_title: string;
  confirmed: boolean;
  video_status: VideoEpisodeStatus;
  video_url: string | null;
  updated_at: string;
};

/** 已出过可听曲目的剧本系列（音乐页目录） */
export type MusicCatalogItem = {
  article_id: string;
  article_title: string;
  series_id: string;
  series_title: string;
  genre: VideoScriptGenre;
  hook_style?: string;
  track_count: number;
  music_status: string;
  updated_at: string;
};

/** 已生成可听对谈的文章（播客页目录） */
export type PodcastCatalogItem = {
  article_id: string;
  article_title: string;
  podcast_title: string;
  mode: PodcastMode;
  audio_url: string | null;
  cover_url: string | null;
  duration_sec: number;
  turn_count: number;
  turns: PodcastTurn[];
  updated_at: string;
};

export interface VideoPublishJob {
  id: string;
  episode_id: string;
  article_id: string;
  platform: string;
  status: JobStatus;
  error: string | null;
  result_url: string | null;
  created_at: string;
  updated_at: string;
  episode_no?: number;
  episode_title?: string;
  series_title?: string;
}

export interface MusicPublishJob {
  id: string;
  article_id: string;
  series_id: string;
  track_id: string;
  platform: string;
  status: JobStatus;
  error: string | null;
  result_url: string | null;
  created_at: string;
  updated_at: string;
  series_title?: string;
  song_title?: string;
}

export interface ArticleVideoEpisode {
  id: string;
  series_id: string;
  episode_no: number;
  title: string;
  hook: string;
  voiceover: string;
  on_screen: string;
  recap: string;
  next_hook: string;
  duration_sec: number;
  shots_json: string;
  director_json?: string;
  confirmed: number;
  video_status: VideoEpisodeStatus;
  video_url: string | null;
  source_video_url?: string | null;
  subtitle_url?: string | null;
  caption_style_json?: string | null;
  caption_cues_json?: string | null;
  video_error: string | null;
  video_model: string | null;
  created_at: string;
  updated_at: string;
}

/** Re-export platform family types for convenience. */
export type {
  PlatformFamily,
  VariantSource,
} from "@/lib/content/platform-families";
export {
  PLATFORM_FAMILIES,
  ALL_PLATFORM_FAMILIES,
  platformFamily,
  isPlatformFamily,
  defaultFamilyForKind,
  familyLabel,
  WRITING_PLATFORM_FAMILIES,
  WRITING_ONLY_FAMILIES,
} from "@/lib/content/platform-families";

export interface ArticleVariant {
  id: string;
  article_id: string;
  family: import("@/lib/content/platform-families").PlatformFamily;
  title: string;
  body: string;
  summary: string;
  source: import("@/lib/content/platform-families").VariantSource;
  created_at: string;
  updated_at: string;
}

export interface PlatformSession {
  platform: PlatformId;
  storage_path: string;
  display_name: string | null;
  connected_at: string | null;
  last_checked_at: string | null;
  status: SessionStatus;
}

export interface PublishJob {
  id: string;
  article_id: string;
  platform: PlatformId;
  status: JobStatus;
  result_url: string | null;
  error: string | null;
  screenshot_path: string | null;
  engine: PublishEngine;
  created_at: string;
  updated_at: string;
}

export interface PublishContent {
  title: string;
  bodyMarkdown: string;
  bodyHtml: string;
  bodyText: string;
  summary: string;
  coverPath: string | null;
}

export interface PublishResult {
  success: boolean;
  url?: string;
  error?: string;
  screenshotPath?: string;
  /** Keep browser window open (e.g. for manual confirm). */
  keepOpen?: boolean;
  /** Prefer over inferring from success/draftOnly. */
  outcome?: Exclude<
    JobStatus,
    "pending" | "running" | "success"
  >;
  /** Platform draft saved (not live). */
  draftOnly?: boolean;
  /** Form filled; user must confirm publish (Xiaohongshu etc.). */
  awaitingUserPublish?: boolean;
}

/** 语料库条目分类 */
export type CorpusCategory = "brand" | "story" | "product" | "style" | "other";

/** 语料配图。截图必须有说明，引用时模型和读者才知道图里是什么。 */
export type CorpusAssetKind = "screenshot" | "image";

export interface CorpusAsset {
  id: string;
  url: string;
  path?: string;
  caption: string;
  kind: CorpusAssetKind;
}

export interface CorpusItem {
  id: string;
  title: string;
  category: CorpusCategory;
  tags: string;
  content: string;
  assets?: CorpusAsset[];
  created_at: string;
  updated_at: string;
  workspace_id?: string | null;
}

/** AI 文案类型 */
export type CopywritingKind =
  | "brand_intro"
  | "product"
  | "marketing"
  | "oral"
  | "social"
  | "article"
  | "slogan"
  | "script_outline";

/** 营销文案路子：同一套挖点，两种发动机。 */
export type MarketingAngle = "anxiety" | "hope";

/** AI 文案风格 */
export type CopywritingStyle =
  | "default"
  | "dan_koe"
  | "jinqiang"
  | "lijiaoshou"
  | "conflict_beat";

export const CORPUS_CATEGORIES: {
  id: CorpusCategory;
  label: string;
  hint: string;
}[] = [
  { id: "brand", label: "品牌", hint: "定位、价值观、Slogan、品牌故事" },
  { id: "story", label: "故事", hint: "个人经历、客户案例、创业复盘" },
  { id: "product", label: "产品", hint: "功能、卖点、参数、使用场景" },
  { id: "style", label: "风格", hint: "范文、语气参考、禁用词" },
  { id: "other", label: "其他", hint: "任意可引用素材" },
];

export const COPYWRITING_KINDS: {
  id: CopywritingKind;
  label: string;
  hint: string;
}[] = [
  { id: "brand_intro", label: "品牌介绍", hint: "官网 About、一句话介绍" },
  { id: "product", label: "产品文案", hint: "卖点、功能说明、落地页" },
  {
    id: "marketing",
    label: "营销文案",
    hint: "从语料挖读者的点，贩卖焦虑或期待，再落到产品",
  },
  {
    id: "oral",
    label: "口播文案",
    hint: "吸引力口播或对谈稿，连环钩，说话带情绪",
  },
  { id: "social", label: "社媒短帖", hint: "微博、小红书、朋友圈" },
  { id: "article", label: "长文初稿", hint: "公众号/专栏长文，约 3000–5000 字" },
  { id: "slogan", label: "标语口号", hint: "多条 Slogan 备选" },
  {
    id: "script_outline",
    label: "剧本大纲",
    hint: "先写戏骨，后面拆短剧时再选古装/职场",
  },
];

export const COPYWRITING_STYLES: {
  id: CopywritingStyle;
  label: string;
  hint: string;
}[] = [
  { id: "default", label: "默认", hint: "专业、真诚、有温度" },
  {
    id: "dan_koe",
    label: "Dan Koe",
    hint: "短句、原则断言、高能动身份叙事",
  },
  {
    id: "jinqiang",
    label: "金枪大叔",
    hint: "挑衅起手、口语相声腔、语言钉+反扣",
  },
  {
    id: "lijiaoshou",
    label: "李叫兽",
    hint: "认知反转、结构化说理、可转述模型",
  },
  {
    id: "conflict_beat",
    label: "冲突拍",
    hint: "一集一拍、锁立场、开头钩、集末留钩",
  },
];

export function defaultStyleForKind(kind: CopywritingKind): CopywritingStyle {
  return kind === "script_outline" ? "conflict_beat" : "default";
}

export const MARKETING_ANGLES: {
  id: MarketingAngle;
  label: string;
  hint: string;
}[] = [
  {
    id: "anxiety",
    label: "贩卖焦虑",
    hint: "把正在忍的代价说透，再给语料产品当出口",
  },
  {
    id: "hope",
    label: "贩卖期待",
    hint: "把想站到的那天写清楚，再给语料产品当路径",
  },
];

export const ORAL_MODES: {
  id: PodcastMode;
  label: string;
  hint: string;
}[] = [
  {
    id: "solo",
    label: "单人口播",
    hint: "一个人钩着往下讲，每段只揭一层",
  },
  {
    id: "dialogue",
    label: "双人对谈",
    hint: "问的人追问，答的人每次只揭一层",
  },
];

/** 用户蒸馏的写手 Agent，写作风格可反复选用。 */
export interface WriterAgent {
  id: string;
  workspace_id: string;
  name: string;
  seed: string;
  hint: string;
  instruction: string;
  created_at: string;
  updated_at: string;
}

/** GEO 挖词：痛点类型（沿用旧 id，文案按目标用户痛点） */
export type GeoKeywordIntent =
  | "informational"
  | "howto"
  | "comparison"
  | "commercial"
  | "local"
  | "question";

export interface GeoKeywordMine {
  id: string;
  seed: string;
  context: string;
  created_at: string;
  updated_at: string;
  workspace_id?: string | null;
}

export interface GeoKeyword {
  id: string;
  mine_id: string;
  keyword: string;
  title: string;
  intent: GeoKeywordIntent;
  angle: string;
  norm_key: string;
  /** @deprecated use geo_keyword_articles */
  article_id: string | null;
  created_at: string;
}

/** AI 写文与痛点的关联记录（同一痛点可有多篇） */
export interface GeoKeywordArticle {
  id: string;
  keyword_id: string;
  article_id: string;
  brief: string;
  created_at: string;
}

export type GeoKeywordArticleWithTitle = GeoKeywordArticle & {
  article_title: string;
};

export const GEO_KEYWORD_INTENTS: {
  id: GeoKeywordIntent;
  label: string;
}[] = [
  { id: "informational", label: "搞不懂" },
  { id: "howto", label: "做不成" },
  { id: "comparison", label: "选不准" },
  { id: "commercial", label: "不敢买" },
  { id: "local", label: "用不上" },
  { id: "question", label: "不放心" },
];

export const PLATFORMS: {
  id: PlatformId;
  name: string;
  description: string;
  limits: string;
}[] = [
  {
    id: "zhihu",
    name: "知乎",
    description: "知乎专栏文章",
    limits: "建议标题 ≤ 100 字，正文支持富文本",
  },
  {
    id: "weibo",
    name: "微博",
    description: "微博头条文章",
    limits: "标题建议 ≤ 32 字，正文以富文本填入",
  },
  {
    id: "baijiahao",
    name: "百家号",
    description: "百度百家号图文",
    limits: "标题 2–64 字，正文建议 ≥ 300 字",
  },
  {
    id: "jianshu",
    name: "简书",
    description: "简书专栏文章",
    limits: "标题建议 ≤ 80 字，正文按富文本填入",
  },
  {
    id: "csdn",
    name: "CSDN",
    description: "CSDN 博客文章",
    limits: "标题建议 ≤ 100 字，正文按富文本填入；发布时可能需补标签/扫码",
  },
  {
    id: "toutiao",
    name: "头条号",
    description: "今日头条图文",
    limits: "标题 2–30 字，正文按富文本填入；发布前通常需封面",
  },
  {
    id: "juejin",
    name: "掘金",
    description: "稀土掘金技术文章",
    limits: "标题建议 ≤ 80 字，正文 Markdown；需选分类/标签",
  },
  {
    id: "weixin",
    name: "微信公众号",
    description: "公众号图文（扩展写入，待你封面和发表）",
    limits: "标题建议 ≤ 64 字；扩展写入标题和正文，封面和发表你在打开的页里点",
  },
  {
    id: "bilibili",
    name: "B站专栏",
    description: "哔哩哔哩专栏文章",
    limits: "标题建议 ≤ 40 字，正文富文本",
  },
  {
    id: "douban",
    name: "豆瓣",
    description: "豆瓣日记（新版话题；扩展草稿为仅自己可见）",
    limits: "标题建议 ≤ 100 字；默认同步为仅自己可见",
  },
  {
    id: "sohu",
    name: "搜狐号",
    description: "搜狐号图文",
    limits: "标题建议 ≤ 64 字",
  },
  {
    id: "dayu",
    name: "大鱼号",
    description: "UC 大鱼号图文",
    limits: "标题建议 ≤ 64 字",
  },
  {
    id: "yidian",
    name: "一点号",
    description: "一点资讯图文",
    limits: "标题建议 ≤ 64 字",
  },
  {
    id: "cnblogs",
    name: "博客园",
    description: "博客园博文",
    limits: "标题建议 ≤ 200 字，正文 Markdown/HTML",
  },
  {
    id: "cto51",
    name: "51CTO",
    description: "51CTO 博客",
    limits: "标题建议 ≤ 100 字",
  },
  {
    id: "segmentfault",
    name: "思否",
    description: "SegmentFault 文章",
    limits: "标题建议 ≤ 100 字，正文 Markdown",
  },
  {
    id: "imooc",
    name: "慕课手记",
    description: "慕课网手记",
    limits: "标题建议 ≤ 80 字",
  },
  {
    id: "oschina",
    name: "开源中国",
    description: "OSChina 博客",
    limits: "标题建议 ≤ 100 字",
  },
  {
    id: "yuque",
    name: "语雀",
    description: "语雀文档",
    limits: "标题建议 ≤ 100 字；需已有知识库",
  },
  {
    id: "woshipm",
    name: "人人都是产品经理",
    description: "产品经理社区投稿",
    limits: "标题建议 ≤ 100 字",
  },
  {
    id: "xueqiu",
    name: "雪球",
    description: "雪球长文",
    limits: "标题建议 ≤ 80 字",
  },
  {
    id: "sohufocus",
    name: "搜狐焦点",
    description: "搜狐焦点房产号",
    limits: "标题建议 ≤ 64 字",
  },
  {
    id: "xiaohongshu",
    name: "小红书",
    description: "小红书长文/图文笔记（填稿待发，无稳定草稿 API）",
    limits: "标题 ≤ 20 字；扩展/本机填好后需你确认发布",
  },
  {
    id: "shunqi",
    name: "顺企网",
    description: "顺企网企业新闻（填稿待发，会员后台添加新闻）",
    limits: "标题建议 ≤ 80 字；可上传 1 张新闻图（封面或正文首图）；扩展填好后需你在后台确认发布",
  },
  {
    id: "shunqi_product",
    name: "顺企网产品",
    description: "顺企网添加产品（填稿待发，需上传产品图）",
    limits: "标题建议 ≤ 80 字；必须有封面或正文图；扩展填好后需你确认发布",
  },
  {
    id: "bafang",
    name: "八方资源网",
    description: "八方资源网发布产品（填稿待发，会员中心 pg=Supply）",
    limits: "标题建议 ≤ 32 字；必须有产品图；扩展填好后需你确认发布",
  },
  {
    id: "douyin",
    name: "抖音文章",
    description: "抖音创作者中心文章（长文，可插图）",
    limits: "标题 ≤ 30 字；正文按文章编辑器填写，图跟正文走",
  },
  {
    id: "netease",
    name: "网易号",
    description: "网易号图文",
    limits: "标题建议 ≤ 64 字",
  },
  {
    id: "smzdm",
    name: "什么值得买",
    description: "什么值得买投稿",
    limits: "标题建议 ≤ 60 字；投稿常需商品卡/图片",
  },
  {
    id: "eastmoney",
    name: "东方财富",
    description: "东方财富股吧长文",
    limits: "标题建议 ≤ 80 字",
  },
  {
    id: "x",
    name: "X",
    description: "X (Twitter) 长文/帖子",
    limits: "长文标题建议 ≤ 100 字；需已开通 Articles 或退回普通发帖",
  },
  {
    id: "qiehao",
    name: "企鹅号",
    description: "腾讯内容开放平台企鹅号图文",
    limits: "标题 5–64 字；默认同步为草稿",
  },
  {
    id: "dafeng",
    name: "大风号",
    description: "凤凰网大风号图文（原凤凰号）",
    limits: "标题建议 ≤ 64 字；默认同步为草稿",
  },
  {
    id: "kuaichuan",
    name: "360快传号",
    description: "360 快传号图文",
    limits: "标题建议 ≤ 64 字；默认同步为草稿",
  },
  {
    id: "sinakandian",
    name: "新浪看点",
    description: "新浪看点/头条文章（与微博长文打通）",
    limits: "标题建议 ≤ 64 字；若后台已并入微博，请改用微博平台",
  },
  {
    id: "dongfang",
    name: "东方号",
    description: "东方头条东方号图文",
    limits: "标题建议 ≤ 64 字；默认同步为草稿",
  },
  {
    id: "btime",
    name: "北京时间号",
    description: "北京时间·时间号图文",
    limits: "标题建议 ≤ 64 字；默认同步为草稿",
  },
  {
    id: "peoplehao",
    name: "人民号",
    description: "人民日报人民号图文",
    limits: "标题建议 ≤ 64 字；需 App 扫码登录与入驻审核；默认同步为草稿",
  },
  {
    id: "xinhuahao",
    name: "新华号",
    description: "新华网客户端新华号图文",
    limits: "标题建议 ≤ 64 字；多为邀约入驻；默认同步为草稿",
  },
  {
    id: "zhongqing",
    name: "中青号",
    description: "中青看点中青号图文",
    limits: "标题建议 ≤ 64 字；默认同步为草稿",
  },
  {
    id: "tencentcloud",
    name: "腾讯云+",
    description: "腾讯云开发者社区文章",
    limits: "标题 ≤ 80 字；正文纯文本建议 ≥ 140 字；同步为草稿",
  },
  {
    id: "aliyun",
    name: "阿里云开发者",
    description: "阿里云开发者社区文章",
    limits: "标题建议 ≤ 100 字；同步为 Markdown 草稿",
  },
  {
    id: "huaweicloud",
    name: "华为云社区",
    description: "华为云社区博客",
    limits: "标题 ≤ 64 字；同步为 Markdown 草稿（草稿箱最多 10 篇）",
  },
  {
    id: "dianwu",
    name: "点物目录",
    description: "dianwu.ai 目录（仅本地工作区可推送）",
    limits: "仅本地账号；推送后直接上线",
  },
];

/** All platform ids in registry order. */
export const ALL_PLATFORM_IDS: PlatformId[] = PLATFORMS.map((p) => p.id);

export type MentionSource =
  | "deepseek"
  | "doubao"
  | "yuanbao"
  | "qwen"
  | "other";

export const MENTION_SOURCES: { id: MentionSource; label: string }[] = [
  { id: "deepseek", label: "DeepSeek" },
  { id: "doubao", label: "豆包" },
  { id: "yuanbao", label: "元宝" },
  { id: "qwen", label: "通义" },
  { id: "other", label: "其他" },
];

export type MentionProbeSource = "deepseek" | "doubao";

export interface MentionSettings {
  brands: string[];
  questions: string[];
  updated_at: string;
  doubao_model: string;
  doubao_configured: boolean;
}

export interface MentionResult {
  id: string;
  run_id: string;
  question: string;
  source: MentionSource;
  mentioned: boolean;
  excerpt: string;
  answer: string;
  error: string;
}

export interface MentionRun {
  id: string;
  created_at: string;
  model: string;
  hit_count: number;
  miss_count: number;
  error_count: number;
  results: MentionResult[];
}
