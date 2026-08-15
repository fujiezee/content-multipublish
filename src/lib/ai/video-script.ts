import { chatCompletion, streamChatCompletion } from "@/lib/ai/deepseek";
import {
  buildCorpusContext,
  selectCorpusForBrief,
} from "@/lib/ai/copywriting";
import { stripPhotoLook } from "@/lib/ai/manhua-look";
import {
  genreFromHookStyle,
  hookStyleLine,
  normalizeHookStyle,
  type VideoScriptHookStyle,
} from "@/lib/ai/video-script-styles";
import {
  NARRATOR_SPEAKER_ID,
  resolveShotSpeakerId,
} from "@/lib/ai/tts-voice-ids";
import {
  normalizeSpeakMode,
  type VideoScriptGenre,
  type VideoShot,
  type VideoSpeakMode,
} from "@/lib/types";

export type VideoScriptGenEvent =
  | { type: "status"; message: string }
  | { type: "meta"; model: string }
  | { type: "thinking"; delta: string }
  | { type: "content"; delta: string };

function scriptModel(): string {
  return (
    process.env.DEEPSEEK_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "deepseek-chat"
  );
}

export type GeneratedEpisodeScript = {
  episode_no: number;
  title: string;
  hook: string;
  voiceover: string;
  on_screen: string;
  recap: string;
  next_hook: string;
  duration_sec: number;
  shots: VideoShot[];
};

export type GeneratedVideoSeries = {
  genre: VideoScriptGenre;
  title: string;
  logline: string;
  audience: string;
  notes: string;
  episodes: GeneratedEpisodeScript[];
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function clampEpisodeCount(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.min(12, Math.max(1, Math.round(v)));
}

export function normalizeGenre(raw: unknown): VideoScriptGenre {
  return raw === "drama" ? "drama" : "edu";
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("AI 未返回可用的剧本 JSON");
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch {
    throw new Error("AI 返回的剧本 JSON 无法解析，请再生成一次");
  }
}

function asText(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function clipSpoken(v: unknown, max: number): string {
  const raw = asText(v, max + 48);
  if (!raw) return "";
  if (raw.length <= max) return raw;
  const slice = raw.slice(0, max);
  const cut = Math.max(
    slice.lastIndexOf("。"),
    slice.lastIndexOf("！"),
    slice.lastIndexOf("？"),
    slice.lastIndexOf("…"),
  );
  if (cut >= Math.floor(max * 0.45)) return slice.slice(0, cut + 1);
  return slice;
}

function normalizeShots(raw: unknown, voiceover: string): VideoShot[] {
  const list = Array.isArray(raw) ? raw : [];
  const shots = list
    .map((item, i) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const secondsRaw = Number(o.seconds ?? o.duration ?? 10);
      const seconds = Number.isFinite(secondsRaw)
        ? Math.min(15, Math.max(6, Math.round(secondsRaw)))
        : 10;
      const visual = asText(o.visual ?? o.scene, 80);
      if (!visual) return null;
      const sceneRaw = o.sceneUrl ?? o.scene_url;
      const sceneUrl =
        typeof sceneRaw === "string" && sceneRaw.trim()
          ? sceneRaw.trim().slice(0, 2000)
          : "";
      const clipRaw = o.clipUrl ?? o.clip_url ?? o.videoUrl ?? o.video_url;
      const clipUrl =
        typeof clipRaw === "string" && clipRaw.trim()
          ? clipRaw.trim().slice(0, 2000)
          : "";
      const speaker = asText(o.speaker ?? o.speaker_name, 16);
      const speakerId = asText(o.speakerId ?? o.speaker_id, 64);
      const shot: VideoShot = {
        index: i + 1,
        seconds,
        visual,
        onScreen: asText(o.onScreen ?? o.on_screen, 36),
        voiceover: clipSpoken(o.voiceover, 160),
        imagePrompt: stripPhotoLook(
          asText(o.imagePrompt ?? o.image_prompt, 160),
        ),
      };
      if (speaker) shot.speaker = speaker;
      if (speakerId) shot.speakerId = speakerId;
      if (sceneUrl) shot.sceneUrl = sceneUrl;
      if (clipUrl) shot.clipUrl = clipUrl;
      return shot;
    })
    .filter((x): x is VideoShot => Boolean(x))
    .slice(0, 10);

  if (shots.length > 0) {
    return shots.map((s, i) => ({
      ...s,
      index: i + 1,
      imagePrompt:
        s.imagePrompt ||
        `竖屏 9:16，${s.visual}，无水印无 logo 无网址`,
    }));
  }

  const chunks = voiceover
    .split(/[。！？]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
    .slice(0, 8);
  const fallback = chunks.length ? chunks : [voiceover.slice(0, 40) || "本集要点"];
  return fallback.map((line, i) => ({
    index: i + 1,
    seconds: 10,
    visual: `竖屏讲解画面，配合「${line.slice(0, 18)}」`,
    onScreen: line.slice(0, 16),
    voiceover: line.slice(0, 220),
    imagePrompt: `竖屏 9:16 科普画面，${line.slice(0, 24)}，无水印无 logo 无网址`,
  }));
}

function normalizeEpisode(
  raw: unknown,
  fallbackNo: number,
): GeneratedEpisodeScript | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const noRaw = Number(o.episode_no ?? o.no ?? o.episodeNo ?? fallbackNo);
  const episode_no = Number.isFinite(noRaw)
    ? Math.max(1, Math.round(noRaw))
    : fallbackNo;
  const voiceoverRaw = asText(o.voiceover ?? o.vo, 800);
  const title = asText(o.title, 28);
  if (!title && !voiceoverRaw) return null;
  const durationRaw = Number(o.duration_sec ?? o.duration ?? 90);
  const hook = asText(o.hook, 64);
  const shots = normalizeShots(o.shots, voiceoverRaw);
  const voiceoverJoined = shots
    .map((s) => s.voiceover)
    .filter(Boolean)
    .join("");
  const voiceover =
    voiceoverJoined.length >= 40 ? voiceoverJoined.slice(0, 800) : voiceoverRaw;
  const onScreenDirect = asText(
    o.on_screen ??
      o.onScreen ??
      o.caption ??
      o.overlay ??
      o.main_text ??
      o.flower_text,
    80,
  );
  const onScreenFromShots = [...new Set(shots.map((s) => s.onScreen).filter(Boolean))]
    .slice(0, 3)
    .join(" · ");
  const on_screen =
    onScreenDirect ||
    onScreenFromShots.slice(0, 80) ||
    hook.slice(0, 24) ||
    voiceover.split(/[。！？]/)[0]?.slice(0, 24) ||
    title.slice(0, 16);
  return {
    episode_no,
    title: title || `第 ${episode_no} 集`,
    hook,
    voiceover,
    on_screen,
    recap: asText(o.recap, 80),
    next_hook: asText(o.next_hook ?? o.nextHook, 48),
    duration_sec: Number.isFinite(durationRaw)
      ? Math.min(120, Math.max(60, Math.round(durationRaw)))
      : 90,
    shots,
  };
}

function parseSeries(raw: string, genre: VideoScriptGenre): GeneratedVideoSeries {
  const json = extractJsonObject(raw);
  if (!json || typeof json !== "object") {
    throw new Error("AI 未返回系列剧本");
  }
  const o = json as Record<string, unknown>;
  const episodesRaw = Array.isArray(o.episodes) ? o.episodes : [];
  const episodes = episodesRaw
    .map((item, i) => normalizeEpisode(item, i + 1))
    .filter((x): x is GeneratedEpisodeScript => Boolean(x))
    .sort((a, b) => a.episode_no - b.episode_no);
  if (episodes.length === 0) {
    throw new Error("剧本里没有可用的分集，请再生成一次");
  }
  return {
    genre,
    title: asText(o.title, 28) || asText(episodes[0]?.title, 16) || "短视频系列",
    logline: asText(o.logline, 80),
    audience: asText(o.audience, 40),
    notes: asText(o.notes, 120),
    episodes,
  };
}

function parseEpisodeList(
  raw: string,
  fallbackStart: number,
): GeneratedEpisodeScript[] {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() || trimmed;
  const arrayStart = candidate.indexOf("[");
  const arrayEnd = candidate.lastIndexOf("]");
  let list: unknown[] = [];
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    try {
      const parsed = JSON.parse(candidate.slice(arrayStart, arrayEnd + 1));
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  if (list.length === 0) {
    const obj = extractJsonObject(raw) as Record<string, unknown>;
    if (Array.isArray(obj.episodes)) list = obj.episodes;
    else list = [obj];
  }
  return list
    .map((item, i) => normalizeEpisode(item, fallbackStart + i))
    .filter((x): x is GeneratedEpisodeScript => Boolean(x));
}

const SHARED_RULES = `你是抖音/视频号资深短视频编导，不是公文写手，也不是课堂讲师。
写出来的东西要能停住划走的人：有钩子、有共鸣、有节奏、一听就懂。

事实边界：
- 只依据文章和语料。不得编造数据、客户、公司名、域名、资质。
- 品牌名、产品、官网只许引用语料里已有的；语料没有的一律不写（包括点物、dianwu.ai）。
- 禁止催单、限时折扣、加微留资、招商加盟。

看懂：
- 用小学生也听得懂的大白话。短句，口语，像跟身边人说话。
- 专业词必须立刻打比方；禁止「赋能、抓手、闭环、底层逻辑、颗粒度」这类空话。
- 一集只讲一件事。听完能复述给别人。

抖音 90 秒节奏（必须按这个写口播和分镜）：
- 0–3 秒：钩子。反常识、扎心、好奇缺口，或「你是不是也……」。第一句就要停住拇指。
- 3–15 秒：共鸣。点出观众正在踩的坑，让人觉得「说的就是我」。
- 15–70 秒：只推进一件事。画面可以 8–12 秒一换，口播必须接着上一句，不许每镜换一个新论点，不许每镜重新起头。
- 70–85 秒：落地。一句能记住的话，或一个马上能用的小办法。
- 85–90 秒：收。金句，或留下一集的缺口（不是硬广）。

口播 280–380 个中文字，约 90 秒，要留出停顿。竖屏 9:16。
分镜 7–9 个，每镜 8–12 秒，seconds 合计 85–95。
画面按半写实插画短剧写：角色五官清楚像个人，不要写成实拍现场，不要二次元卡通。
花字短、狠、能独立看懂。
最后只输出 JSON，不要解释。`;

function speakLine(mode?: VideoSpeakMode): string {
  const continuity =
    "口播是一条连着的线，不是每镜各写一段互不相干的讲解。整集 shots[].voiceover 按顺序拼起来，必须就是完整口播，能一口气听懂。上一镜最后一句，下一镜第一句必须接得上。禁止每镜重新开头、再问一遍「你是不是」、再自我介绍。每镜口播 35–70 字，刚好这镜秒数，一镜只说一个来回里的半句到两句。";
  return normalizeSpeakMode(mode) === "dialogue"
    ? `说话方式：角色开口。${continuity} voiceover 必须是出镜人原话，第一人称，像当面讲，不要旁白腔。visual 里这个人在张嘴。每镜写 speaker：角色名；只有画外音才写「旁白」。同一镜只一个人，换人就拆镜。两个人时要有来回：问完立刻答，顶完立刻拆，不要一个人连讲四镜再换人念另一段稿。`
    : `说话方式：独白旁白。${continuity} voiceover 是画外音，像一个人在耳边讲；角色可以看镜头、做事、停顿，不必对口型。每镜 speaker 写「旁白」。`;
}

function characterLine(name?: string | string[]): string {
  const names = (Array.isArray(name) ? name : [name || ""])
    .map((x) => x.trim())
    .filter(Boolean);
  if (names.length === 0) {
    return "没有指定角色时，出镜用一个稳定的普通人，各集不要换脸。";
  }
  if (names.length === 1) {
    return `出镜角色固定为「${names[0]}」。口播用这个人的口吻；分镜 visual 必须是这个人在场，不要换成别人。`;
  }
  const listed = names.map((n) => `「${n}」`).join("、");
    return `出镜角色是${listed}。分镜里只能出现这些人。对白必须在这些人之间来回，下一镜要接上一镜的话，不要各说各的，不要换成别人，不要再加新脸。`;
}

function genreLine(
  genre: VideoScriptGenre,
  hookStyle?: VideoScriptHookStyle | string,
): string {
  return hookStyleLine(hookStyle || (genre === "drama" ? "drama" : "talk"));
}

function jsonSchemaHint(count: number): string {
  return `输出 JSON 对象：
{
  "title": "剧本名（必填，≤16字，像抖音合集名，不要照抄文章标题，不要写「短视频系列」）",
  "logline": "一句话：看完能得到什么",
  "audience": "给谁看，用他们自己的话说",
  "notes": "连载时注意什么",
  "episodes": [
    {
      "episode_no": 1,
      "title": "本集标题（≤16字，像视频标题，有钩子）",
      "hook": "前3秒原话，必须能单独当开头",
      "voiceover": "完整口播=各镜 voiceover 按顺序拼接，280-380字，不要另写一套对不上的",
      "on_screen": "主花字，必填，6–16字，不能空，要能单独当屏幕大字",
      "recap": "本集收束一句，要能记住",
      "next_hook": "下集缺口；若只有一集就写一个让人想收藏的尾巴",
      "duration_sec": 90,
      "shots": [
        {
          "seconds": 10,
          "visual": "这 10 秒画面，具体、能画成半写实插画分镜",
          "onScreen": "这镜花字",
          "voiceover": "这镜原话，35-70字，必须接上一镜最后一句",
          "speaker": "旁白或角色名，同一镜只一个人",
          "imagePrompt": "竖屏9:16半写实插画分镜，真人比例五官清楚，无实拍脸，无水印无logo无网址"
        }
      ]
    }
  ]
}
必须正好 ${count} 集，episode_no 从 1 连续到 ${count}。`;
}

function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  const slice = candidate.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as { episodes?: unknown };
    if (parsed && typeof parsed === "object") return slice;
  } catch {
    // keep slice; parseSeries will try again
  }
  return slice;
}

async function streamModelText(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options: {
    maxTokens: number;
    timeoutMs: number;
    onEvent?: (event: VideoScriptGenEvent) => void | Promise<void>;
  },
): Promise<string> {
  const model = scriptModel();
  await options.onEvent?.({ type: "meta", model });
  let content = "";
  let thinking = "";
  let lastStatusAt = 0;
  for await (const chunk of streamChatCompletion(messages, {
    model,
    temperature: 0.55,
    maxTokens: options.maxTokens,
    timeoutMs: options.timeoutMs,
  })) {
    if (chunk.type === "thinking") {
      thinking += chunk.text;
      await options.onEvent?.({ type: "thinking", delta: chunk.text });
      if (Date.now() - lastStatusAt > 4000) {
        lastStatusAt = Date.now();
        await options.onEvent?.({
          type: "status",
          message: `还在想钩子和节奏（已思考 ${thinking.length} 字），想完才写 JSON…`,
        });
      }
    } else if (chunk.type === "content") {
      if (!content) {
        await options.onEvent?.({
          type: "status",
          message: "正在写剧本 JSON…",
        });
      }
      content += chunk.text;
      await options.onEvent?.({ type: "content", delta: chunk.text });
    }
  }

  const fromContent = extractJsonText(content);
  if (fromContent) return fromContent;
  const fromThinking = extractJsonText(thinking);
  if (fromThinking) {
    await options.onEvent?.({
      type: "status",
      message: "正文没吐出来，已从思考里取出剧本 JSON",
    });
    return fromThinking;
  }

  await options.onEvent?.({
    type: "status",
    message: "思考写完了但没有 JSON，改用对话模型直接落剧本…",
  });
  const fallback = await chatCompletion(
    [
      ...messages,
      {
        role: "user",
        content:
          "上面已经想过了。现在只输出完整 JSON 剧本，不要解释，不要 markdown 以外的字，不要再写思考。",
      },
    ],
    {
      model: "deepseek-chat",
      temperature: 0.4,
      maxTokens: Math.min(8192, options.maxTokens),
      timeoutMs: 180_000,
    },
  );
  const fromFallback = extractJsonText(fallback);
  if (fromFallback) return fromFallback;
  if (fallback.trim()) return fallback;
  throw new Error("模型没有写出剧本，请再试一次");
}

export async function generateVideoSeries(
  input: {
    title: string;
    bodyHtml: string;
    genre?: VideoScriptGenre;
    hookStyle?: VideoScriptHookStyle | string;
    episodeCount?: number;
    seriesName?: string;
    characterName?: string | string[];
    speakMode?: VideoSpeakMode;
  },
  onEvent?: (event: VideoScriptGenEvent) => void | Promise<void>,
): Promise<GeneratedVideoSeries> {
  const title = input.title.trim() || "未命名文章";
  const body = stripHtml(input.bodyHtml);
  if (body.length < 80) {
    throw new Error("正文太短，请先写完文章再拆剧本");
  }
  const hookStyle = normalizeHookStyle(input.hookStyle);
  const genre = genreFromHookStyle(hookStyle);
  const count = clampEpisodeCount(input.episodeCount);
  const corpus = selectCorpusForBrief(`${title}\n${body.slice(0, 400)}`, {});
  const corpusText = buildCorpusContext(corpus);

  const system = `${SHARED_RULES}

${genreLine(genre, hookStyle)}
${characterLine(input.characterName)}
${speakLine(input.speakMode)}`;

  const countLine =
    count === 1
      ? "只写 1 集完整成片，90 秒内把最能停住观众的一个点讲透。不要写成提纲，不要留半截。"
      : `拆成 ${count} 集连载，每集 90 秒、只讲一件事，集与集之间要有缺口，让人想看下一集。`;

  const named = input.seriesName?.trim().slice(0, 16) || "";
  const nameLine = named
    ? `剧本名必须用「${named}」。JSON 的 title 就填这个，不要另起名。`
    : "必须给这套剧本起一个好记的名字，写在 title 里。像抖音合集名，不要论文题，不要照抄文章标题。";

  const user = `${countLine}
${nameLine}
先想清楚：这集凭什么不被划走？观众是谁？他正在烦什么？然后才写剧本。

文章标题：${title}

正文：
${body.slice(0, 10000)}

可参考的语料（品牌/事实只许用这里有的）：
${corpusText}

${jsonSchemaHint(count)}`;

  await onEvent?.({
    type: "status",
    message:
      count === 1
        ? "正在写 1 集 90 秒剧本…"
        : `正在按抖音节奏拆 ${count} 集剧本…`,
  });

  const raw = await streamModelText(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    {
      maxTokens: 32768,
      timeoutMs: 300_000,
      onEvent,
    },
  );

  const series = parseSeries(raw, genre);
  const have = new Set(series.episodes.map((e) => e.episode_no));
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter(
    (n) => !have.has(n),
  );
  if (missing.length === 0) {
    return {
      ...series,
      title: named || series.title,
      episodes: series.episodes.filter((e) => e.episode_no <= count).slice(0, count),
    };
  }

  await onEvent?.({
    type: "status",
    message: `先写出了部分，正在补第 ${missing.join("、")} 集…`,
  });
  const filled = await generateEpisodeScripts(
    {
      title,
      body,
      genre,
      hookStyle,
      seriesTitle: named || series.title,
      episodeNos: missing,
      existing: series.episodes,
      corpusText,
      characterName: input.characterName,
      speakMode: input.speakMode,
    },
    onEvent,
  );
  const byNo = new Map<number, GeneratedEpisodeScript>();
  for (const ep of [...series.episodes, ...filled]) {
    byNo.set(ep.episode_no, ep);
  }
  const episodes = Array.from({ length: count }, (_, i) => i + 1)
    .map((n) => byNo.get(n))
    .filter((x): x is GeneratedEpisodeScript => Boolean(x));
  if (episodes.length === 0) {
    throw new Error("未能拆出分集剧本，请再试一次");
  }
  return { ...series, title: named || series.title, episodes };
}

export async function generateEpisodeScripts(
  input: {
    title: string;
    body: string;
    genre: VideoScriptGenre;
    hookStyle?: VideoScriptHookStyle | string;
    seriesTitle: string;
    episodeNos: number[];
    existing: Array<{ episode_no: number; title: string }>;
    corpusText: string;
    characterName?: string | string[];
    speakMode?: VideoSpeakMode;
  },
  onEvent?: (event: VideoScriptGenEvent) => void | Promise<void>,
): Promise<GeneratedEpisodeScript[]> {
  if (input.episodeNos.length === 0) return [];
  const others = input.existing
    .map((e) => `第${e.episode_no}集 ${e.title}`)
    .join("；");
  const raw = await streamModelText(
    [
      {
        role: "system",
        content: `${SHARED_RULES}\n\n${genreLine(input.genre, input.hookStyle)}\n${characterLine(input.characterName)}\n${speakLine(input.speakMode)}`,
      },
      {
        role: "user",
        content: `系列「${input.seriesTitle}」还要写这些集：${input.episodeNos.join("、")}。
已有分集（不要重复同一个点）：${others || "无"}
文章标题：${input.title}
正文：
${input.body.slice(0, 8000)}

语料：
${input.corpusText}

只输出 JSON 数组，元素字段与分集剧本相同（episode_no/title/hook/voiceover/on_screen/recap/next_hook/duration_sec/shots）。
每一集都要有自己的 3 秒钩子和共鸣。口播是一条连着的对话：各镜 voiceover 拼起来就是完整口播，上一镜说到哪下一镜就从哪接，不要每镜另起一段。小学生能听懂。
on_screen 必填，写 6–16 字主花字，不能空。`,
      },
    ],
    {
      maxTokens: 16384,
      timeoutMs: 240_000,
      onEvent,
    },
  );
  return parseEpisodeList(raw, input.episodeNos[0] || 1);
}

export async function regenerateOneEpisode(
  input: {
    title: string;
    bodyHtml: string;
    genre: VideoScriptGenre;
    hookStyle?: VideoScriptHookStyle | string;
    seriesTitle: string;
    episodeNo: number;
    existing: Array<{ episode_no: number; title: string }>;
    characterName?: string | string[];
    speakMode?: VideoSpeakMode;
  },
  onEvent?: (event: VideoScriptGenEvent) => void | Promise<void>,
): Promise<GeneratedEpisodeScript> {
  const body = stripHtml(input.bodyHtml);
  const corpus = selectCorpusForBrief(`${input.title}\n${body.slice(0, 400)}`, {});
  await onEvent?.({
    type: "status",
    message: `正在重写第 ${input.episodeNo} 集，先找新的钩子…`,
  });
  const [ep] = await generateEpisodeScripts(
    {
      title: input.title,
      body,
      genre: input.genre,
      hookStyle: input.hookStyle,
      seriesTitle: input.seriesTitle,
      episodeNos: [input.episodeNo],
      existing: input.existing.filter((e) => e.episode_no !== input.episodeNo),
      corpusText: buildCorpusContext(corpus),
      characterName: input.characterName,
      speakMode: input.speakMode,
    },
    onEvent,
  );
  if (!ep) {
    throw new Error(`第 ${input.episodeNo} 集重写失败，请再试`);
  }
  return { ...ep, episode_no: input.episodeNo };
}

export function shotsToJson(shots: VideoShot[]): string {
  return JSON.stringify(shots);
}

export function bindShotSpeakers(
  shots: VideoShot[],
  cast: Array<{ id: string; name: string }>,
  speakMode?: VideoSpeakMode,
): VideoShot[] {
  return shots.map((shot) => {
    const speakerId = resolveShotSpeakerId(shot, cast, speakMode);
    const speaker =
      speakerId === NARRATOR_SPEAKER_ID
        ? "旁白"
        : cast.find((c) => c.id === speakerId)?.name || shot.speaker || "旁白";
    return { ...shot, speakerId, speaker };
  });
}

export function shotsHaveScenes(shots: VideoShot[]): boolean {
  return shots.length > 0 && shots.every((s) => Boolean(s.sceneUrl?.trim()));
}

export function shotsHaveClips(shots: VideoShot[]): boolean {
  return shots.length > 0 && shots.every((s) => Boolean(s.clipUrl?.trim()));
}

export function shotsFromJson(raw: string): VideoShot[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeShots(parsed, "");
  } catch {
    return [];
  }
}
