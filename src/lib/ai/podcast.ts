import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { completeScriptLlm } from "@/lib/ai/script-llm";
import { synthesizeSpeechOrThrow } from "@/lib/ai/ark-tts";
import { persistPublicAsset } from "@/lib/storage/public-media";
import { articleMusicSource } from "@/lib/ai/video-music";
import {
  detectOralCopy,
  ORAL_ALIVE_VOICE,
  type DetectedOralCopy,
} from "@/lib/ai/oral-copy-agent";
import {
  DEFAULT_PODCAST_GUEST_VOICE,
  DEFAULT_PODCAST_HOST_VOICE,
  DEFAULT_PODCAST_TTS_MODEL,
  podcastAudioEmotion,
  podcastSpeakerName,
  podcastTone,
  wrapPodcastCot,
} from "@/lib/ai/podcast-shared";
import { isCustomVoiceId, ttsSpeechModelMeta } from "@/lib/ai/tts-voice-ids";
import { listArticlePainKeywords } from "@/lib/db";
import type {
  Article,
  ArticlePodcast,
  PodcastMode,
  PodcastSpeaker,
  PodcastTurn,
} from "@/lib/types";

export {
  DEFAULT_PODCAST_GUEST_VOICE,
  DEFAULT_PODCAST_HOST_VOICE,
  DEFAULT_PODCAST_TTS_MODEL,
  normalizePodcastMode,
  parsePodcastTurns,
  podcastSpeakerName,
  podcastTone,
  publicPodcast,
} from "@/lib/ai/podcast-shared";

const execFileAsync = promisify(execFile);

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced?.[1] || raw).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

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

function painHintText(articleId: string): string {
  const rows = listArticlePainKeywords(articleId);
  if (rows.length === 0) return "";
  return rows
    .map((row) => `${row.keyword}${row.angle ? `（${row.angle}）` : ""}`)
    .join("；");
}

export type PodcastScript = {
  title: string;
  turns: Array<{ speaker: PodcastSpeaker; text: string; feel?: string }>;
};

export function podcastCoverBrief(
  article: Article,
  script: PodcastScript,
): { title: string; excerpt: string; lines: string; pains: string } {
  const { excerpt } = articleMusicSource(article);
  return {
    title: script.title,
    excerpt,
    lines: script.turns
      .slice(0, 4)
      .map((row) => row.text)
      .join(" / "),
    pains: painHintText(article.id),
  };
}

const PODCAST_SOLO_SYSTEM = `你把一篇 GEO 稿改写成「吸引力单人口播」音频稿。一个人对着听的人说，不是两个人聊天，不是电台开场，不是把文章念一遍。

任务有三件，缺一不可：连环钩把人听下去；每一句都能听出情绪；文案本身有活人感，像当面跟熟人说，不是念提词器。

${ORAL_ALIVE_VOICE}

写法（吸引力口播）：
- 黄金三秒：第一句就必须停住。任选一类钩：反常识判断、挑衅判决、听的人正在做的错法、不做的代价。禁止自我介绍、禁止「今天讲」「先说背景」。
- 连环钩：每段只揭一层，段尾用自己的话留缺口。下一段必须接这个缺口，不许另起话题。禁止问完立刻「先别答」再跳到另一摊。上下句必须一根线。
- 车头抛钩 → 车身每段一个新刺激（错法/对照/具体判断）→ 车尾金句反扣开头那句。
- 口气：短句、问号、口语词。该急就急，该笑就笑，该不服就不服。像当面说给人听，不要写成能发公众号的完整句。
- 先钉一句总判断，每段只推进一步。结构藏在节奏里，禁止把「第一第二」「三个层面」「底层逻辑」「痛点方案」写进口播。
- 判断要具体、能被引用，全部来自正文。不要鸡汤、不要广告、不要编客户和数据。

每段必须写 feel：4到12字，只给配音，不进口播正文。写心情和怎么说，例如「着急不服」「认真揭开」「无奈心疼」「轻快损一句」「郑重收住」。相邻几段禁止同一个 feel。俏皮句的 feel 必须换轻或损，不能仍是认真往下。听的人必须听得出这一段的心情。

禁止：欢迎收听、各位听众、大家好、我是、下期见、点个关注、把全文复述成提纲、四平八稳念判断。
末段把钩收回来，给一句能记住的判断，不要号召收藏。`;

const PODCAST_DIALOGUE_SYSTEM = `你把一篇 GEO 稿改写成「连环钩对谈」音频稿。两个人较劲把文章拆开，不是采访提纲，不是一问一答课堂，不是两个人轮流念稿。

文案本身要有活人感：像两个人刚看完这件事坐下来吵，不是节目组写好的提词。

${ORAL_ALIVE_VOICE}

角色：
- 主持=听的人本人：急、疑、抬杠、听半句更慌。只问搞不懂、做不成、选不准、不敢买、用不上、不放心。第一句就是钩，不是「今天想请教」。问句要冲，可以打断。
- 嘉宾=文里的判断：要具体、能被引用。每次只回答刚被问到的那一层。可以无奈、可以揭穿、可以恨铁不成钢，不要冷静百科，不要吼。话尾必须抛新钩，用自己的话说。

连环钩（对谈专用，和单人口播不一样）：
- 钩在问答缝里，不在独白里。主持抛钩 → 嘉宾半揭+新钩 → 主持必须咬住刚才那个新钩追问，不许换题目、不许「那第二个问题」。
- 嘉宾禁止一次讲完：答完停在缺口上，把下一问逼出来。不要每轮都套同一句「但坑不在这儿」。
- 主持禁止念大纲：不要「第一个问题、第二个问题」。每一问都像被上一句戳到才问出口。禁止「先别答」假钩，禁止上一句英文下一句「你卖谁」这种接不上。
- 覆盖文中 3 到 5 个痛点或判断，用钩串起来，不要并列展览。全文只推进一句总判断。

每句必须写 feel：4到12字心情。主持例：「着急不服」；嘉宾例：「认真揭开」「无奈心疼」「轻快损一句」。相邻几句禁止同一个 feel。俏皮句必须换口气。听的人必须听得出这一句的心情。

禁止：欢迎收听、各位听众、下期见、那我们今天聊聊、把嘉宾写成念稿老师、把主持写成报幕、两个人都一个语调。
不要鸡汤、不要广告、不要编客户和数据。`;

function podcastScriptUserPrompt(input: {
  title: string;
  excerpt: string;
  body: string;
  pains: string;
  dialogue: boolean;
}): string {
  const material = [
    `标题：${input.title}`,
    input.pains ? `这篇对准的痛点：${input.pains}` : "",
    input.excerpt && input.excerpt !== input.body
      ? `摘要：${input.excerpt.slice(0, 800)}`
      : "",
    `正文：\n${input.body || input.excerpt}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const shape = input.dialogue
    ? `只输出 JSON：{"title":"6到16字标题，要像能停住的节目名","turns":[{"speaker":"host"|"guest","text":"口播","feel":"4到12字心情"}]}。
10到14轮，主持先开口，之后严格一轮问一轮答。
主持每句 18 到 40 字，必须是钩或追问；嘉宾每句 40 到 90 字，前半答、最后一句留钩。
text 必须浅白、有活人感：口语、半句、两人口气不一样，小学生听得懂。feel 只写心情，例如着急不服、认真揭开。
总字数大约 650 到 900。第一句主持不能是开场白；最后一轮嘉宾把钩收回成一句可引用的判断。`
    : `只输出 JSON：{"title":"6到16字标题，要像能停住的口播标题","turns":[{"speaker":"host","text":"口播","feel":"4到12字心情"}]}。
8到12段，全部 speaker 为 host。每段 40 到 90 字。
第一段必须是钩，中间每段结尾留缺口，最后一段反扣开头。
text 必须浅白、有活人感：口语、长短不齐，像当面说，小学生听得懂。feel 只写心情。总字数大约 650 到 900。不要复述全文。`;

  return `${material}\n\n${shape}`;
}

export async function writePodcastScript(input: {
  article: Article;
  mode: PodcastMode;
}): Promise<PodcastScript> {
  const existing = podcastScriptFromOralCopy(input.article);
  if (existing) return existing;

  const { title, excerpt } = articleMusicSource(input.article);
  const body = stripHtml(input.article.body || "").slice(0, 6000);
  const pains = painHintText(input.article.id);
  const dialogue = input.mode !== "solo";

  const raw = await completeScriptLlm(
    [
      {
        role: "system",
        content: dialogue ? PODCAST_DIALOGUE_SYSTEM : PODCAST_SOLO_SYSTEM,
      },
      {
        role: "user",
        content: podcastScriptUserPrompt({
          title,
          excerpt,
          body,
          pains,
          dialogue,
        }),
      },
    ],
    {
      maxTokens: 4096,
      temperature: 0.7,
      timeoutMs: 90_000,
      disableThinking: true,
    },
  );
  return parsePodcastScript(raw, title, dialogue);
}

export function detectArticleOralCopy(article: {
  title?: string;
  body?: string;
}): DetectedOralCopy | null {
  return detectOralCopy({
    title: article.title,
    body: article.body,
  });
}

function podcastScriptFromOralCopy(article: Article): PodcastScript | null {
  const detected = detectOralCopy({
    title: article.title,
    body: article.body,
  });
  if (!detected) return null;
  const dialogue = detected.mode === "dialogue";
  const title = (article.title || "").trim().slice(0, 24) || (dialogue ? "对谈" : "口播");
  return {
    title,
    turns: detected.turns.map((turn, i) => ({
      speaker: dialogue ? turn.speaker : "host",
      text: turn.text.slice(0, 180),
      feel: inferPodcastFeel(
        turn.text,
        dialogue ? turn.speaker : "host",
        dialogue,
        i,
        detected.turns.length,
      ),
    })),
  };
}

function cleanPodcastFeel(raw: unknown): string {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/^["「]|["」]$/g, "")
    .trim()
    .slice(0, 36);
}

function inferPodcastFeel(
  text: string,
  speaker: PodcastSpeaker,
  dialogue: boolean,
  index: number,
  total: number,
): string {
  if (index === 0) {
    return dialogue ? "着急不服" : "着急停住";
  }
  if (index === total - 1) return "郑重收住";
  if (/[？?]/.test(text)) return "着急追问";
  if (/但真正|更反直觉|还会栽|先别急|坑不在/.test(text)) {
    return "无奈吊着";
  }
  if (speaker === "guest") return "认真揭开";
  return dialogue ? "着急不服" : "认真往下";
}

function parsePodcastScript(
  raw: string,
  fallbackTitle: string,
  dialogue: boolean,
): PodcastScript {
  const json = extractJsonObject(raw);
  const title =
    (typeof json?.title === "string" && json.title.trim().slice(0, 24)) ||
    fallbackTitle.slice(0, 16) ||
    "对谈";
  const rows = Array.isArray(json?.turns) ? json.turns : [];
  const turns: PodcastScript["turns"] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const text = String(rec.text || rec.line || rec.content || "")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 6) continue;
    const speaker: PodcastSpeaker =
      dialogue && (rec.speaker === "guest" || rec.role === "guest")
        ? "guest"
        : "host";
    const feel = cleanPodcastFeel(rec.feel || rec.emotion || rec.delivery);
    turns.push({ speaker, text: text.slice(0, 180), feel: feel || undefined });
  }
  if (turns.length < 4) {
    throw new Error("对谈稿写太短，再生成一次");
  }
  if (dialogue) {
    turns[0].speaker = "host";
    for (let i = 1; i < turns.length; i += 1) {
      turns[i].speaker = turns[i - 1].speaker === "host" ? "guest" : "host";
    }
  } else {
    for (const turn of turns) turn.speaker = "host";
  }
  const sliced = turns.slice(0, dialogue ? 14 : 12);
  return {
    title,
    turns: sliced.map((turn, i) => ({
      ...turn,
      feel:
        turn.feel ||
        inferPodcastFeel(turn.text, turn.speaker, dialogue, i, sliced.length),
    })),
  };
}

function spokenPodcastLine(text: string): string {
  return text
    .replace(/（[^）]{1,24}）/g, " ")
    .replace(/\([^)]{1,24}\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function estimateDurationSec(buf: Buffer, text: string): number {
  if (buf.length > 44 && buf.slice(0, 4).toString("ascii") === "RIFF") {
    const byteRate = buf.readUInt32LE(28);
    if (byteRate > 0) return Math.max(0.8, buf.length / byteRate);
  }
  const chars = text.replace(/\s+/g, "").length;
  return Math.max(0.8, chars / 4.2);
}

function resolveFfmpeg(): string {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  for (const candidate of [
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "ffmpeg";
}

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync(resolveFfmpeg(), ["-version"], { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

function looksMp3(buf: Buffer): boolean {
  return (
    buf.slice(0, 3).toString("ascii") === "ID3" ||
    (buf.length > 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
  );
}

async function stitchPodcastAudio(
  clips: Array<{ buffer: Buffer }>,
): Promise<{ url: string; mime: string } | null> {
  if (clips.length === 0) return null;
  if (clips.length === 1) {
    const buf = clips[0].buffer;
    const wav = buf.slice(0, 4).toString("ascii") === "RIFF";
    const url = await persistPublicAsset({
      bytes: buf,
      filename: `${randomUUID()}${wav ? ".wav" : ".mp3"}`,
      contentType: wav ? "audio/wav" : "audio/mpeg",
      label: "播客",
    });
    return { url, mime: wav ? "audio/wav" : "audio/mpeg" };
  }

  if (await ffmpegAvailable()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-pod-"));
    try {
      const listFile = path.join(dir, "list.txt");
      const out = path.join(dir, "out.mp3");
      const lines: string[] = [];
      clips.forEach((clip, i) => {
        const wav = clip.buffer.slice(0, 4).toString("ascii") === "RIFF";
        const file = path.join(dir, `${i}${wav ? ".wav" : ".mp3"}`);
        fs.writeFileSync(file, clip.buffer);
        lines.push(`file '${file.replace(/'/g, "'\\''")}'`);
      });
      fs.writeFileSync(listFile, lines.join("\n"));
      await execFileAsync(
        resolveFfmpeg(),
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listFile,
          "-c:a",
          "libmp3lame",
          "-b:a",
          "192k",
          "-ar",
          "24000",
          "-ac",
          "1",
          out,
        ],
        { timeout: 120_000 },
      );
      if (fs.existsSync(out) && fs.statSync(out).size > 64) {
        const url = await persistPublicAsset({
          bytes: fs.readFileSync(out),
          filename: `${randomUUID()}.mp3`,
          contentType: "audio/mpeg",
          label: "播客",
        });
        return { url, mime: "audio/mpeg" };
      }
    } catch {
      // fall through
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  if (clips.every((clip) => looksMp3(clip.buffer))) {
    const merged = Buffer.concat(clips.map((clip) => clip.buffer));
    const url = await persistPublicAsset({
      bytes: merged,
      filename: `${randomUUID()}.mp3`,
      contentType: "audio/mpeg",
      label: "播客",
    });
    return { url, mime: "audio/mpeg" };
  }
  return null;
}

export async function speakPodcastTurns(input: {
  script: PodcastScript;
  mode: PodcastMode;
  hostVoice: string;
  guestVoice: string;
  ttsModel?: string;
  onProgress?: (message: string, index: number, total: number) => void | Promise<void>;
}): Promise<{ turns: PodcastTurn[]; audioUrl: string | null; durationSec: number }> {
  const host = input.hostVoice.trim() || DEFAULT_PODCAST_HOST_VOICE;
  const guest =
    input.mode === "solo"
      ? host
      : input.guestVoice.trim() || DEFAULT_PODCAST_GUEST_VOICE;
  const clips: Buffer[] = [];
  const turns: PodcastTurn[] = [];
  const total = input.script.turns.length;

  for (let i = 0; i < total; i += 1) {
    const row = input.script.turns[i];
    const voice = row.speaker === "guest" ? guest : host;
    await input.onProgress?.(
      `配音 ${i + 1}/${total} · ${podcastSpeakerName(row.speaker, input.mode)}`,
      i + 1,
      total,
    );
    const spoken = spokenPodcastLine(row.text) || row.text;
    const ttsMeta = ttsSpeechModelMeta(input.ttsModel);
    const expressive =
      ttsMeta.provider === "ark" && ttsMeta.id !== "doubao-seed-tts-1.0";
    const cloneVoice =
      isCustomVoiceId(voice) || /^(S_|icl_)/i.test(voice);
    const clip = await synthesizeSpeechOrThrow(
      cloneVoice
        ? wrapPodcastCot(spoken, row.speaker, input.mode, row.feel)
        : spoken,
      voice,
      {
        acting: false,
        expressive,
        punch: false,
        speed: 1,
        ttsModel: input.ttsModel,
        tone: podcastTone(row.speaker, input.mode, row.feel),
        emotion: podcastAudioEmotion(row.speaker, input.mode, row.feel),
        requirePublicUrl: true,
      },
    );
    if (!clip.url) throw new Error("配音没有传到公网，播客听不了");
    const durationSec = estimateDurationSec(clip.buffer, spoken);
    clips.push(clip.buffer);
    turns.push({
      index: i + 1,
      speaker: row.speaker,
      name: podcastSpeakerName(row.speaker, input.mode),
      text: row.text,
      audioUrl: clip.url,
      durationSec: Math.round(durationSec * 10) / 10,
      feel: row.feel,
    });
  }

  await input.onProgress?.("正在合成完整音频…", total, total);
  const stitched = await stitchPodcastAudio(clips.map((buffer) => ({ buffer })));
  const durationSec = Math.round(
    turns.reduce((sum, row) => sum + (row.durationSec || 0), 0),
  );
  return {
    turns,
    audioUrl: stitched?.url || null,
    durationSec,
  };
}

export function emptyPodcastRow(articleId: string): ArticlePodcast {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    article_id: articleId,
    title: "",
    mode: "dialogue",
    host_voice: DEFAULT_PODCAST_HOST_VOICE,
    guest_voice: DEFAULT_PODCAST_GUEST_VOICE,
    tts_model: DEFAULT_PODCAST_TTS_MODEL,
    status: "idle",
    error: null,
    audio_url: null,
    cover_url: null,
    duration_sec: 0,
    turns_json: "[]",
    created_at: now,
    updated_at: now,
  };
}
