import {
  activeScriptLlmId,
  completeScriptLlm,
  scriptLlmFallbackId,
  streamScriptLlm,
} from "@/lib/ai/script-llm";
import {
  buildCorpusContext,
  looksLikeManualScriptTitle,
  selectCorpusForBrief,
} from "@/lib/ai/copywriting";
import { describeCharactersFromScript } from "@/lib/ai/character-sheet";
import { stripPhotoLook } from "@/lib/ai/manhua-look";
import { resolveLookStyle } from "@/lib/ai/look-styles";
import {
  looksLikeCharacterName,
  resolveScriptSourceKind,
  scriptSourceMinChars,
} from "@/lib/ai/script-import";
import {
  clampEpisodeCount,
  clampEpisodeDuration,
  episodePace,
  genreFromHookStyle,
  hookStyleLabel,
  hookStyleLine,
  hookStyleLookLine,
  hookStylePremiseLine,
  hookStyleShotContract,
  isShowStyle,
  showEngineCard,
  showKickoffLine,
  textHasShowEngine,
  PREMISE_MAX,
  normalizeHookStyle,
  paceRules,
  showEngineMark,
  type EpisodeDurationSec,
  type EpisodePace,
  type VideoScriptHookStyle,
} from "@/lib/ai/video-script-styles";
import {
  applyShotEmotionGrammar,
  emotionRules,
  flowerRepeatsLine,
  innerVoiceWriteRules,
  normalizeShotBeat,
  scrubShotFlowers,
  SPEECH_CHARS_PER_SEC,
  weaveSilentEmotionShots,
} from "@/lib/ai/emotion-beat";
import { reviewGeneratedEpisodes } from "@/lib/ai/script-review";
import { directGeneratedEpisodes } from "@/lib/ai/shot-agent";
import type { SeriesWardrobeLock, ShotAgentLock } from "@/lib/ai/director-lock";
import {
  dropCastOutlineBlock,
  embedStanceNotes,
  episodeScriptBlob,
  formatStanceCards,
  generateStanceCards,
  isCannedStanceCard,
  resolveStanceCards,
  type StanceCard,
} from "@/lib/ai/stance-card";
import { lockEpisodeVoices } from "@/lib/ai/tts-voice-ids";
import { parseShotPlate } from "@/lib/ai/shot-plate";
import {
  innerVoiceMark,
  isInnerTag,
  normalizeShotDelivery,
  normalizeShotJoin,
  normalizeSoundRole,
  normalizeSpeakMode,
  parseInnerLevel,
  shotHasKeyframes,
  shotIsInner,
  stripInnerTag,
  type InnerVoiceLevel,
  type VideoScriptGenre,
  type VideoShot,
  type VideoSpeakMode,
} from "@/lib/types";

export {
  MAX_EPISODE_COUNT,
  MAX_SERIES_CAST,
  PREMISE_MAX,
  EPISODE_DURATION_OPTIONS,
  DEFAULT_EPISODE_DURATION,
  clampEpisodeCount,
  clampEpisodeDuration,
} from "@/lib/ai/video-script-styles";

export type VideoScriptGenEvent =
  | { type: "status"; message: string }
  | { type: "meta"; model: string }
  | { type: "thinking"; delta: string }
  | { type: "content"; delta: string };

function scriptModel(): string {
  return (
    activeScriptLlmId() ||
    process.env.DEEPSEEK_SCRIPT_MODEL?.trim() ||
    process.env.DEEPSEEK_REASONING_MODEL?.trim() ||
    process.env.DEEPSEEK_STREAM_MODEL?.trim() ||
    "deepseek-reasoner"
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
  director?: ShotAgentLock;
};

export type GeneratedVideoSeries = {
  genre: VideoScriptGenre;
  title: string;
  logline: string;
  premise: string;
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

const FIRST_EPISODE_BATCH = 6;
const FILL_EPISODE_CHUNK = 4;

function scriptWriteBudget(episodeCount: number, durationSec: number) {
  const short = durationSec <= 15 && episodeCount <= 2;
  const jsonPer = durationSec <= 15 ? 2800 : durationSec <= 30 ? 4200 : 6000;
  const thinkPad = short ? 2500 : 4000;
  return {
    maxTokens: Math.min(32768, Math.max(8192, episodeCount * jsonPer + thinkPad)),
    timeoutMs: short ? 90_000 : episodeCount <= 2 ? 180_000 : 300_000,
    thinkingEffort: (short ? "low" : "high") as "low" | "high",
    sourceChars: short
      ? 4000
      : durationSec <= 15
        ? 6000
        : 10000,
  };
}

function firstPassShotsOk(
  episode: GeneratedEpisodeScript,
  durationSec?: EpisodeDurationSec,
): boolean {
  const pace = episodePace(durationSec);
  const shots = episode.shots || [];
  if (shots.length < pace.shotMin || shots.length > pace.shotMax + 2) {
    return false;
  }
  return shots.every((shot) => String(shot.visual || "").trim().length >= 8);
}

export function normalizeGenre(raw: unknown): VideoScriptGenre {
  return raw === "drama" ? "drama" : "edu";
}

function extractJsonObjects(text: string): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            out.push(JSON.parse(text.slice(i, j + 1)));
          } catch {
            // skip invalid object
          }
          break;
        }
      }
    }
  }
  return out;
}

function jsonSpeechScore(parsed: unknown): number {
  if (!parsed || typeof parsed !== "object") return -1;
  const o = parsed as Record<string, unknown>;
  const episodes = Array.isArray(o.episodes) ? o.episodes : [o];
  let n = 0;
  for (const item of episodes) {
    if (item && typeof item === "object") {
      n += collectEpisodeSpeech(item as Record<string, unknown>).length;
    }
  }
  return n;
}

function pickRichestJson(text: string): unknown | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() || trimmed;
  let best: unknown = null;
  let bestScore = -1;
  for (const obj of extractJsonObjects(candidate)) {
    const score = jsonSpeechScore(obj);
    if (score > bestScore) {
      best = obj;
      bestScore = score;
    }
  }
  return best;
}

function extractJsonObject(text: string): unknown {
  const parsed = pickRichestJson(text);
  if (parsed) return parsed;
  throw new Error("AI 未返回可用的剧本 JSON");
}

function asText(v: unknown, max: number): string {
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim().slice(0, max);
  if (v && typeof v === "object" && "text" in v) {
    return asText((v as { text?: unknown }).text, max);
  }
  return "";
}

function asPremise(v: unknown): string {
  if (typeof v === "string") {
    return v
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, PREMISE_MAX);
  }
  if (Array.isArray(v)) {
    return asPremise(
      v
        .map((item) => {
          if (typeof item === "string") return item.trim();
          if (!item || typeof item !== "object") return "";
          const o = item as Record<string, unknown>;
          const name = String(o.name || "").trim();
          const role = String(o.role || "").trim();
          const line = String(
            o.line || o.intro || o.stance || o.desc || o.text || "",
          ).trim();
          if (name && line) {
            return `${name}${role ? `（${role}）` : ""}：${line}`;
          }
          return asPremise(item);
        })
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const parts = [
      o.cast,
      o.characters,
      o.roles,
      o.outline,
      o.roster,
      o.story,
      o.plot,
      o.synopsis,
      o.backstory,
      o.intro,
      o.text,
      o.premise,
    ];
    return asPremise(
      parts
        .map((part) => asPremise(part))
        .filter(Boolean)
        .join("\n\n"),
    );
  }
  return "";
}

function asSpoken(v: unknown, max = 2000): string {
  if (v == null) return "";
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim().slice(0, max);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    return mergeSpokenParts(v.map((item) => asSpoken(item, max)));
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return asSpoken(
      o.voiceover ??
        o.vo ??
        o.text ??
        o.line ??
        o.dialogue ??
        o.speech ??
        o.content,
      max,
    );
  }
  return "";
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[。！？…])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function mergeSpokenParts(parts: string[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const text = String(part || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const bits = splitSentences(text);
    for (const piece of bits.length ? bits : [text]) {
      const key = piece.replace(/\s+/g, "");
      if (key.length < 2 || seen.has(key)) continue;
      seen.add(key);
      out.push(piece);
    }
  }
  return out.join("");
}

function collectShotSpeech(o: Record<string, unknown>): string {
  const parts: string[] = [];
  if (!Array.isArray(o.shots)) return "";
  for (const item of o.shots) {
    if (!item || typeof item !== "object") {
      parts.push(asSpoken(item));
      continue;
    }
    const shot = item as Record<string, unknown>;
    parts.push(
      asSpoken(
        shot.voiceover ?? shot.vo ?? shot.dialogue ?? shot.line ?? shot.speech,
      ),
    );
  }
  return mergeSpokenParts(parts);
}

function collectEpisodeSpeech(o: Record<string, unknown>): string {
  return mergeSpokenParts([
    asSpoken(o.voiceover ?? o.vo),
    asSpoken(o.hook),
    collectShotSpeech(o),
  ]);
}

function dropRepriseSentences(text: string): string {
  const parts = splitSentences(text);
  const kept: string[] = [];
  for (const piece of parts) {
    const key = compactSpoken(piece);
    if (key.length < 2) continue;
    const soFar = compactSpoken(kept.join(""));
    if (soFar && (soFar.includes(key) || kept.some((prev) => {
      const pk = compactSpoken(prev);
      return pk.includes(key) || (key.includes(pk) && pk.length >= 8);
    }))) {
      continue;
    }
    kept.push(piece);
  }
  return kept.join("");
}

function canonicalEpisodeSpeech(o: Record<string, unknown>): string {
  const written = dropRepriseSentences(
    trimIncompleteTail(asSpoken(o.voiceover ?? o.vo, 800)),
  );
  if (compactSpoken(written).length >= 24) return written;
  const fromShots = dropRepriseSentences(
    trimIncompleteTail(collectShotSpeech(o).slice(0, 800)),
  );
  return fromShots || written || dropRepriseSentences(trimIncompleteTail(asSpoken(o.hook, 80)));
}

function collapseRepeatedSpeech(text: string): string {
  return mergeSpokenParts([text]);
}

const SPEECH_STOP = /[。！？…]$|——$|—$/;

function trimIncompleteTail(text: string): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (SPEECH_STOP.test(t)) return t;
  const marks = ["。", "！", "？", "…", "——", "—"];
  let last = -1;
  let take = 1;
  for (const mark of marks) {
    const at = t.lastIndexOf(mark);
    if (at > last) {
      last = at;
      take = mark.length;
    }
  }
  if (last >= 0) return t.slice(0, last + take);
  return t;
}

function compactSpoken(text: string): string {
  return text.replace(/\s+/g, "").trim();
}

const AUDIENCE_DIR =
  /观众先(?:替[^。！？]{0,24}|松半口气|看(?:到)?[^。！？]{0,16})|观众心又提起来|观众替[^。！？]{0,16}(?:捏汗|痛快|着急|憋屈)/g;

function spokenPlain(voiceover: string): string {
  return compactSpoken(
    String(voiceover || "")
      .replace(/【(?:对话|旁白)】/g, "")
      .replace(/[\u4e00-\u9fffA-Za-z·]{1,8}[：:]/g, ""),
  );
}

function lastSpokenLine(voiceover: string): string {
  return String(voiceover || "")
    .replace(/【(?:对话|旁白)】/g, "")
    .split(/(?<=[。！？…])/)
    .map((s) => s.replace(/^[\u4e00-\u9fffA-Za-z·]{1,8}[：:]/, "").trim())
    .filter(Boolean)
    .at(-1) || "";
}

function stripInventedQuotes(text: string, voiceover: string): string {
  const spoken = spokenPlain(voiceover);
  const vo = compactSpoken(voiceover);
  let next = String(text || "");
  const quotes = [...next.matchAll(/[「"]([^」"]{2,40})[」"]/g)].map((m) => m[1]);
  let invented = 0;
  for (const q of quotes) {
    const compact = compactSpoken(q);
    if (spoken.includes(compact) || vo.includes(compact)) continue;
    invented += 1;
    next = next.replaceAll(`「${q}」`, "").replaceAll(`"${q}"`, "");
  }
  next = next.replace(/[——]\s*$/g, "").replace(/\s{2,}/g, " ").trim();
  if (invented > 0 && (next.length < 6 || invented >= quotes.length)) {
    return lastSpokenLine(voiceover) || next;
  }
  return next;
}

/** 去掉分镜里的观众说明书，以及收束里准稿没有的编词。 */
export function scrubShowCopy(
  episode: GeneratedEpisodeScript,
): GeneratedEpisodeScript {
  const shots = scrubShotFlowers(
    (episode.shots || []).map((shot) => ({
      ...shot,
      visual: String(shot.visual || "")
        .replace(AUDIENCE_DIR, "")
        .replace(/^[：:，、\s]+/, "")
        .replace(/\s{2,}/g, " ")
        .trim(),
      onScreen: flowerRepeatsLine(shot.onScreen || "", shot.voiceover || "")
        ? ""
        : shot.onScreen,
    })),
  );
  return {
    ...episode,
    recap: stripInventedQuotes(episode.recap, episode.voiceover),
    next_hook: stripInventedQuotes(episode.next_hook, episode.voiceover),
    shots,
  };
}

function splitSpokenChunks(text: string): string[] {
  return text
    .split(/(?<=[。！？…])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
}

function stripCopiedPrefix(current: string, previous: string): string {
  const prev = compactSpoken(previous);
  const cur = compactSpoken(current);
  if (!prev || !cur || prev === cur) return current;
  if (!cur.startsWith(prev) || cur.length < prev.length + 8) return current;
  const cut = current.indexOf(previous.trim());
  const rest =
    cut >= 0
      ? current.slice(cut + previous.trim().length)
      : current.slice(current.length - (cur.length - prev.length));
  return rest.replace(/^[，。！？、；:\s]+/, "").trim() || current;
}

function splitVoiceoverAcrossShots(
  shots: VideoShot[],
  episodeVo: string,
): VideoShot[] {
  const chunks = splitSpokenChunks(episodeVo);
  if (chunks.length === 0) return shots;
  const per = Math.max(1, Math.ceil(chunks.length / shots.length));
  return shots.map((shot, i) => {
    const piece = chunks.slice(i * per, i === shots.length - 1 ? chunks.length : (i + 1) * per);
    return {
      ...shot,
      voiceover: (piece.join("") || shot.voiceover).slice(0, 160),
    };
  });
}

function dedupeShotVoiceovers(
  shots: VideoShot[],
  episodeVo: string,
): VideoShot[] {
  if (shots.length < 2) return shots;
  const lines = shots.map((s) => compactSpoken(s.voiceover));
  const nonempty = lines.filter(Boolean);
  const unique = new Set(nonempty);
  const episode = compactSpoken(episodeVo);
  const allCopyEpisode =
    Boolean(episode) &&
    nonempty.length >= 2 &&
    nonempty.every((line) => line === episode || episode.startsWith(line) && line.length >= 40);
  if ((nonempty.length >= 2 && unique.size === 1) || allCopyEpisode) {
    return splitVoiceoverAcrossShots(shots, episodeVo || shots[0].voiceover);
  }
  let prev = "";
  return shots.map((shot) => {
    let line = shot.voiceover.trim();
    if (prev) line = stripCopiedPrefix(line, prev);
    if (episode && compactSpoken(line) === episode && shots.length > 1) {
      line = splitSpokenChunks(episode)[0] || line;
    }
    prev = line;
    return { ...shot, voiceover: line };
  });
}

function secondsForSpeech(text: string, pace: EpisodePace): number {
  const n = compactSpoken(text).length;
  const raw = Math.round(n / SPEECH_CHARS_PER_SEC) + 1;
  return Math.min(pace.shotSecMax, Math.max(pace.shotSecMin, raw || pace.shotSecMin));
}

function timeShotsBySpeech(shots: VideoShot[], pace: EpisodePace): VideoShot[] {
  return shots.slice(0, pace.shotMax).map((shot, i) => ({
    ...shot,
    index: i + 1,
    seconds: secondsForSpeech(shot.voiceover, pace),
  }));
}

function normalizeShots(
  raw: unknown,
  voiceover: string,
  pace: EpisodePace,
  preserve = false,
): VideoShot[] {
  const list = Array.isArray(raw) ? raw : [];
  const shots = list
    .map((item, i) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const spoken = asSpoken(
        o.voiceover ?? o.vo ?? o.dialogue ?? o.line,
        800,
      );
      const secondsRaw = Number(o.seconds ?? o.duration);
      const seconds = Number.isFinite(secondsRaw)
        ? Math.min(
            preserve ? 15 : pace.shotSecMax,
            Math.max(preserve ? 4 : pace.shotSecMin, Math.round(secondsRaw)),
          )
        : secondsForSpeech(spoken, pace);
      const visual =
        asText(o.visual ?? o.scene, 180) ||
        (spoken ? `竖屏，配合「${spoken.slice(0, 18)}」` : "");
      if (!visual && !spoken) return null;
      const asUrl = (raw: unknown) =>
        typeof raw === "string" && raw.trim()
          ? raw.trim().slice(0, 2000)
          : "";
      const startUrl = asUrl(o.startUrl ?? o.start_url);
      const endUrl = asUrl(o.endUrl ?? o.end_url);
      const sceneUrl = startUrl || asUrl(o.sceneUrl ?? o.scene_url);
      const clipUrl = asUrl(o.clipUrl ?? o.clip_url ?? o.videoUrl ?? o.video_url);
      const rawClipUrl = asUrl(o.rawClipUrl ?? o.raw_clip_url) || clipUrl;
      const lastFrameUrl = asUrl(o.lastFrameUrl ?? o.last_frame_url);
      const speakerRaw = asText(o.speaker ?? o.speaker_name, 24);
      const speaker = stripInnerTag(speakerRaw);
      const speakerId = asText(o.speakerId ?? o.speaker_id, 64);
      const voiceId = asText(o.voiceId ?? o.voice_id, 80);
      const beat = asText(o.beat ?? o.emotion ?? o.feel, 4);
      const look = asText(o.look ?? o.look_at, 24);
      const camera = asText(o.camera ?? o.lens ?? o.shot_type, 8);
      const speechUrl = asUrl(o.speechUrl ?? o.speech_url);
      const clipAltUrl = asUrl(o.clipAltUrl ?? o.clip_alt_url);
      const framesOk = o.framesOk === true || o.frames_ok === true;
      const rawIndex = Number(o.index ?? o.shot_index ?? o.shotIndex);
      const shot: VideoShot = {
        index:
          preserve && Number.isFinite(rawIndex) && rawIndex > 0
            ? Math.round(rawIndex)
            : i + 1,
        seconds,
        visual,
        onScreen: asText(o.onScreen ?? o.on_screen, 36),
        voiceover: spoken,
        imagePrompt: stripPhotoLook(
          asText(o.imagePrompt ?? o.image_prompt, 220),
        ),
      };
      if (speaker && (looksLikeCharacterName(speaker) || speaker === "旁白")) {
        shot.speaker = speaker;
      } else {
        const fromLine = speakerOfLine(spoken);
        if (fromLine && (looksLikeCharacterName(fromLine) || fromLine === "旁白")) {
          shot.speaker = fromLine;
        }
      }
      if (speakerId) shot.speakerId = speakerId;
      if (voiceId) shot.voiceId = voiceId;
      if (beat) shot.beat = normalizeShotBeat(beat) || beat;
      const soundRole = normalizeSoundRole(o.soundRole ?? o.sound_role);
      if (soundRole) shot.soundRole = soundRole;
      const join = normalizeShotJoin(o.join ?? o.cut);
      if (join) shot.join = join;
      if (look) shot.look = look;
      if (camera) shot.camera = camera;
      const plate = parseShotPlate(o.plate);
      if (plate) shot.plate = plate;
      const onset = Number(o.speechOnsetSec ?? o.speech_onset_sec);
      if (Number.isFinite(onset) && onset >= 0) shot.speechOnsetSec = onset;
      const props = Array.isArray(o.props)
        ? o.props
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim().slice(0, 12))
            .filter(Boolean)
            .slice(0, 6)
        : [];
      if (props.length) shot.props = props;
      const delivery =
        normalizeShotDelivery(o.delivery ?? o.speak) ||
        (isInnerTag(speakerRaw) || lineIsInner(`${speakerRaw}：${spoken}`)
          ? "inner"
          : "");
      if (delivery) shot.delivery = delivery;
      const innerLevel =
        parseInnerLevel(o.innerLevel ?? o.inner_level ?? speakerRaw) ||
        (delivery === "inner" ? parseInnerLevel(`${speakerRaw}：${spoken}`) : "");
      if (innerLevel) shot.innerLevel = innerLevel;
      if (speechUrl) shot.speechUrl = speechUrl;
      if (clipAltUrl) shot.clipAltUrl = clipAltUrl;
      if (framesOk) shot.framesOk = true;
      if (sceneUrl) shot.sceneUrl = sceneUrl;
      if (startUrl || sceneUrl) shot.startUrl = startUrl || sceneUrl;
      if (endUrl) shot.endUrl = endUrl;
      if (clipUrl) shot.clipUrl = clipUrl;
      if (rawClipUrl) shot.rawClipUrl = rawClipUrl;
      if (lastFrameUrl) shot.lastFrameUrl = lastFrameUrl;
      return shot;
    })
    .filter((x): x is VideoShot => Boolean(x))
    .filter((shot) => preserve || !isHollowShot(shot))
    .slice(0, preserve ? Math.max(pace.shotMax, 32) : pace.shotMax);

  const episodeVo = collapseRepeatedSpeech(voiceover);
  const cleaned = dedupeShotVoiceovers(
    shots.map((s, i) => ({
      ...s,
      index: preserve ? s.index : i + 1,
      imagePrompt:
        s.imagePrompt || `竖屏 9:16，${s.visual}，无水印无 logo 无网址`,
    })),
    episodeVo,
  );
  const collapsed = scrubShotFlowers(
    cleaned.map((shot) => ({
      ...shot,
      voiceover: collapseRepeatedSpeech(shot.voiceover),
    })),
  );
  if (preserve) {
    return applyShotEmotionGrammar(collapsed.sort((a, b) => a.index - b.index), {
      insert: false,
      mutateVisual: false,
    });
  }
  const script =
    compactSpoken(episodeVo).length >= 24
      ? episodeVo
      : mergeSpokenParts([episodeVo, ...collapsed.map((s) => s.voiceover)]);
  return applyShotEmotionGrammar(
    timeShotsBySpeech(lockShotsToScript(collapsed, script, pace), pace),
    { insert: true, mutateVisual: true, shotMax: pace.shotMax },
  );
}

function splitUniqueLines(text: string, _target: number, max: number): string[] {
  const clean = collapseRepeatedSpeech(text);
  let parts = clean
    .split(/(?<=[。！？…])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  if (parts.length === 0) parts = [clean || "……"];
  if (parts.length > 1 && !SPEECH_STOP.test(parts[parts.length - 1] || "")) {
    parts = parts.slice(0, -1);
  }
  while (parts.length > max) {
    let shortest = 0;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (parts[i].length + parts[i + 1].length < parts[shortest].length + parts[shortest + 1].length) {
        shortest = i;
      }
    }
    parts.splice(shortest, 2, `${parts[shortest]}${parts[shortest + 1]}`);
  }
  return parts;
}

const INNER_MARK = "(?:[（(](?:内心|独白|心里)[）)])";
const SPEAKER_PREFIX = new RegExp(
  `^([\\u4e00-\\u9fffA-Za-z·]{1,8}${INNER_MARK}?)[：:]`,
);
const SPEAKER_TOKEN = new RegExp(
  `[\\u4e00-\\u9fffA-Za-z·]{1,8}${INNER_MARK}?[：:]`,
  "g",
);
const SCRIPT_MODE_RE = /^【(对话|旁白)】\s*/;

export function scriptModeLabel(mode?: VideoSpeakMode | string): "对话" | "旁白" {
  return normalizeSpeakMode(mode) === "dialogue" ? "对话" : "旁白";
}

export function stripScriptModeHeader(text: string): string {
  return String(text || "").replace(SCRIPT_MODE_RE, "").trim();
}

export function ensureScriptModeHeader(
  text: string,
  mode?: VideoSpeakMode | string,
): string {
  const body = stripScriptModeHeader(text);
  return `【${scriptModeLabel(mode)}】${body}`;
}

function inferSpeakMode(
  text: string,
  shots: VideoShot[],
  fallback?: VideoSpeakMode,
): VideoSpeakMode {
  const mark = text.trim().match(SCRIPT_MODE_RE)?.[1];
  if (mark === "对话") return "dialogue";
  if (mark === "旁白") return "narration";
  if (shots.some((s) => s.speaker && s.speaker !== "旁白")) return "dialogue";
  return normalizeSpeakMode(fallback);
}

function speakerOfLine(line: string): string {
  return stripInnerTag(line.match(SPEAKER_PREFIX)?.[1] || "");
}

function lineIsInner(line: string): boolean {
  const mark = line.match(SPEAKER_PREFIX)?.[1] || "";
  return shotIsInner({ delivery: normalizeShotDelivery(mark) || undefined, speaker: mark, voiceover: line });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectSpeakerNames(text: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(SPEAKER_TOKEN)) {
    const name = match[0].slice(0, -1);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function splitLabeledTurns(text: string): string[] {
  const clean = stripScriptModeHeader(text).trim();
  if (!clean) return [];
  const names = collectSpeakerNames(clean);
  const parts =
    names.length === 0
      ? [clean]
      : clean.split(new RegExp(`(?=(?:${names.map(escapeRegExp).join("|")})[：:])`));
  return parts.map((s) => s.trim()).filter((s) => !isHollowUtterance(s));
}

export function splitShotDialogue(shot: {
  speaker?: string;
  voiceover?: string;
  delivery?: string;
}): Array<{ speaker: string; voiceover: string; delivery?: "inner" | "line" }> {
  const vo = String(shot.voiceover || "").trim();
  if (!vo) return [];
  const who = stripInnerTag(shot.speaker || "");
  const labeled =
    who && !SPEAKER_PREFIX.test(vo)
      ? `${shotIsInner(shot) ? `${who}（内心）` : who}：${vo}`
      : vo;
  const parts = splitLabeledTurns(labeled);
  if (parts.length <= 1) {
    return [
      {
        speaker: who || speakerOfLine(vo),
        voiceover: spokenLine(vo) || vo,
        delivery: shotIsInner(shot) || lineIsInner(vo) ? "inner" : "line",
      },
    ];
  }
  return parts.map((part) => ({
    speaker: speakerOfLine(part) || who,
    voiceover: spokenLine(part),
    delivery: lineIsInner(part) ? "inner" : "line",
  }));
}

const DIALOGUE_PUSHBACK =
  /^(这岂不是|岂不是|怎么能|这不就|难道|哪能|可是|但是|不行|你这)/;

function isQuestionLine(line: string): boolean {
  return /[？?]$/.test(spokenLine(line));
}

function otherDialogueSpeaker(
  who: string,
  names: string[],
  parts: string[],
  index: number,
): string {
  if (names.length === 2) return names[0] === who ? names[1] : names[0];
  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = speakerOfLine(parts[i]);
    if (prev && prev !== who && prev !== "旁白") return prev;
  }
  return names.find((name) => name !== who) || who;
}

/** 两人稿里问完自己答，先拉开。三人或以上交给审稿 Agent 按身份判。 */
export function repairDialogueTurns(text: string): string {
  const header = String(text || "").trim().match(SCRIPT_MODE_RE)?.[1];
  const parts = splitLabeledTurns(text);
  if (parts.length < 4) return text;
  const names = [
    ...new Set(
      parts
        .map((line) => speakerOfLine(line))
        .filter((name) => name && name !== "旁白"),
    ),
  ];
  if (names.length !== 2) return text;
  const relabel = (line: string, who: string) => `${who}：${spokenLine(line)}`;
  for (let i = 1; i < parts.length; i += 1) {
    const who = speakerOfLine(parts[i]);
    const prevWho = speakerOfLine(parts[i - 1]);
    if (!who || !prevWho || who === "旁白" || prevWho === "旁白") continue;
    if (who !== prevWho || !isQuestionLine(parts[i - 1])) continue;
    const nextWho = otherDialogueSpeaker(prevWho, names, parts, i);
    parts[i] = relabel(parts[i], nextWho);
    for (let j = i + 1; j < parts.length && j <= i + 2; j += 1) {
      const follow = speakerOfLine(parts[j]);
      if (follow !== prevWho) break;
      const spoken = spokenLine(parts[j]);
      if (isQuestionLine(parts[j]) || DIALOGUE_PUSHBACK.test(spoken)) break;
      parts[j] = relabel(parts[j], nextWho);
    }
  }
  const body = parts.join("");
  return header ? `【${header}】${body}` : body;
}

function stripSpeakerPrefixes(text: string): string {
  let t = String(text || "")
    .replace(/【(?:对话|旁白)】/g, "")
    .trim();
  for (let i = 0; i < 6; i += 1) {
    const next = t.replace(SPEAKER_PREFIX, "").trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

function spokenLine(text: string): string {
  return stripSpeakerPrefixes(text);
}

function isHollowUtterance(line: string): boolean {
  return compactSpoken(stripSpeakerPrefixes(line)).length < 2;
}

const FALLBACK_VISUAL_RE =
  /^竖屏(?:讲解)?画面[，,]配合[「"]([^」"]*)[」"]/;

export function isHollowShot(
  shot: Pick<VideoShot, "voiceover" | "visual">,
): boolean {
  if (!isHollowUtterance(shot.voiceover || "")) return false;
  const visual = String(shot.visual || "").trim();
  if (!visual) return true;
  const quoted = visual.match(FALLBACK_VISUAL_RE)?.[1];
  return quoted != null ? isHollowUtterance(quoted) : false;
}

function dropHollowShots(shots: VideoShot[], renumber: boolean): VideoShot[] {
  const kept = shots.filter((shot) => !isHollowShot(shot));
  return renumber ? kept.map((shot, i) => ({ ...shot, index: i + 1 })) : kept;
}

function formatScriptBody(
  shots: VideoShot[],
  mode: VideoSpeakMode,
): string {
  return shots
    .map((shot) => {
      const line = spokenLine(shot.voiceover);
      if (!line) return "";
      const who =
        stripInnerTag(shot.speaker || "") ||
        (mode === "narration" ? "旁白" : "");
      if (!who) return line;
      const named =
        shotIsInner(shot) && who !== "旁白"
          ? `${who}（内心${innerVoiceMark(shot.innerLevel)}）`
          : who;
      return `${named}：${line}`;
    })
    .filter(Boolean)
    .join("");
}

function splitScriptUtterances(text: string, max: number): string[] {
  const clean = dropRepriseSentences(
    trimIncompleteTail(collapseRepeatedSpeech(stripScriptModeHeader(text))),
  );
  let parts = splitLabeledTurns(clean);
  if (parts.length < 2) parts = splitUniqueLines(clean, 0, max);
  if (parts.length === 0) parts = [clean || "……"];
  parts = parts.filter((part) => !isHollowUtterance(part));
  if (parts.length === 0) parts = [clean || "……"].filter((part) => !isHollowUtterance(part));
  if (parts.length === 0) return [];
  while (parts.length > max) {
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const who = speakerOfLine(parts[i]);
      if (!who || who !== speakerOfLine(parts[i + 1])) continue;
      const score = parts[i].length + parts[i + 1].length;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    parts.splice(best, 2, `${parts[best]}${parts[best + 1]}`);
  }
  return parts;
}

function lockShotsToScript(
  shots: VideoShot[],
  script: string,
  pace: EpisodePace,
): VideoShot[] {
  const lines = splitScriptUtterances(script, pace.shotMax);
  const mapped = lines.map((line, i) => {
    const same = shots.find((row) => row.index === i + 1) ?? shots[i];
    const named = speakerOfLine(line);
    const spoken = spokenLine(line);
    const shot: VideoShot = {
      index: i + 1,
      seconds: secondsForSpeech(spoken, pace),
      visual: same?.visual || `竖屏讲解画面，配合「${spoken.slice(0, 18)}」`,
      onScreen: same?.onScreen || spoken.slice(0, 16),
      voiceover: spoken,
      imagePrompt:
        same?.imagePrompt ||
        `竖屏 9:16 科普画面，${line.slice(0, 24)}，无水印无 logo 无网址`,
    };
    if (named) shot.speaker = named;
    else if (same?.speaker) shot.speaker = stripInnerTag(same.speaker);
    else shot.speaker = "旁白";
    if (lineIsInner(line) || (same && shotIsInner(same))) {
      shot.delivery = "inner";
      const level =
        parseInnerLevel(line) ||
        same?.innerLevel ||
        parseInnerLevel(same?.speaker);
      if (level) shot.innerLevel = level;
    } else if (same?.delivery === "line") shot.delivery = "line";
    if (!named && same?.speakerId) shot.speakerId = same.speakerId;
    if (!named && same?.voiceId) shot.voiceId = same.voiceId;
    if (same?.beat) shot.beat = same.beat;
    if (same?.soundRole) shot.soundRole = same.soundRole;
    if (same?.join) shot.join = same.join;
    if (same?.look) shot.look = same.look;
    if (same?.camera) shot.camera = same.camera;
    const media = shots.find((row) => row.index === i + 1);
    const start = media?.startUrl?.trim() || media?.sceneUrl?.trim() || "";
    if (start) {
      shot.sceneUrl = start;
      shot.startUrl = start;
    }
    if (media?.endUrl) shot.endUrl = media.endUrl;
    if (media?.clipUrl) shot.clipUrl = media.clipUrl;
    if (media?.rawClipUrl) shot.rawClipUrl = media.rawClipUrl;
    if (media?.lastFrameUrl) shot.lastFrameUrl = media.lastFrameUrl;
    if (
      media?.speechUrl &&
      compactSpoken(shot.voiceover) === compactSpoken(media.voiceover || "")
    ) {
      shot.speechUrl = media.speechUrl;
    }
    if (media?.clipAltUrl) shot.clipAltUrl = media.clipAltUrl;
    if (media?.framesOk) shot.framesOk = true;
    return shot;
  });
  return weaveSilentEmotionShots(shots, dropHollowShots(mapped, true));
}

export function canonicalizeVoiceover(
  text: string,
  mode?: VideoSpeakMode | string,
): string {
  const header = text.trim().match(SCRIPT_MODE_RE)?.[1];
  const body = dropRepriseSentences(trimIncompleteTail(stripScriptModeHeader(text)));
  const speak = header === "对话" ? "dialogue" : header === "旁白" ? "narration" : mode;
  const fixed = speak === "narration" ? body : repairDialogueTurns(body);
  return ensureScriptModeHeader(fixed, speak);
}

export function bindShotsToVoiceover(
  shots: VideoShot[],
  voiceover: string,
  durationSec?: unknown,
): VideoShot[] {
  const script = dropRepriseSentences(
    trimIncompleteTail(stripScriptModeHeader(voiceover)),
  );
  if (compactSpoken(script).length < 8) return shots;
  const pace = episodePace(durationSec);
  return applyShotEmotionGrammar(
    timeShotsBySpeech(lockShotsToScript(shots, script, pace), pace),
    { insert: false, mutateVisual: false },
  );
}

function fillShotsFromEpisode(
  shots: VideoShot[],
  episodeVo: string,
  pace: EpisodePace,
): VideoShot[] {
  return lockShotsToScript(shots, episodeVo, pace);
}

function joinShotVoiceovers(shots: VideoShot[]): string {
  return mergeSpokenParts(shots.map((shot) => shot.voiceover));
}

function pickHook(
  raw: Record<string, unknown>,
  shots: VideoShot[],
  voiceover: string,
): string {
  const direct = collapseRepeatedSpeech(
    asText(raw.hook ?? raw.opening ?? raw.cold_open ?? raw.hook_line, 64),
  );
  if (direct) return direct.slice(0, 64);
  const firstSpoken =
    shots.find((s) => compactSpoken(s.voiceover).length >= 4)?.voiceover || "";
  const source = firstSpoken || voiceover;
  const firstSent = source.split(/[。！？]/)[0]?.trim() || source;
  return asText(firstSent, 36);
}

function normalizeEpisode(
  raw: unknown,
  fallbackNo: number,
  targetDuration: EpisodeDurationSec = 90,
  speakMode?: VideoSpeakMode,
): GeneratedEpisodeScript | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const noRaw = Number(o.episode_no ?? o.no ?? o.episodeNo ?? fallbackNo);
  const episode_no = Number.isFinite(noRaw)
    ? Math.max(1, Math.round(noRaw))
    : fallbackNo;
  const pace = episodePace(targetDuration);
  const voiceoverRaw = repairDialogueTurns(canonicalEpisodeSpeech(o));
  const title = asText(o.title, 28);
  if (!title && !voiceoverRaw) return null;
  const shots = normalizeShots(o.shots, voiceoverRaw, pace);
  const mode = inferSpeakMode(voiceoverRaw, shots, speakMode);
  if (mode === "narration") {
    for (const shot of shots) {
      if (!shot.speaker) shot.speaker = "旁白";
    }
  }
  const body = formatScriptBody(shots, mode) || stripScriptModeHeader(voiceoverRaw);
  const voiceover = ensureScriptModeHeader(body, mode);
  const hook = pickHook(o, shots, voiceover);
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
    duration_sec: (() => {
      const sum = shots.reduce((acc, shot) => acc + shot.seconds, 0);
      if (!sum) return pace.sec === 15 ? 12 : 40;
      return Math.min(pace.secondsSumMax, sum);
    })(),
    shots,
  };
}

export function parseSeries(
  raw: string,
  genre: VideoScriptGenre,
  durationSec: EpisodeDurationSec = 90,
  speakMode?: VideoSpeakMode,
): GeneratedVideoSeries {
  const json = extractJsonObject(raw);
  if (!json || typeof json !== "object") {
    throw new Error("AI 未返回系列剧本");
  }
  const o = json as Record<string, unknown>;
  const episodesRaw = Array.isArray(o.episodes) ? o.episodes : [];
  const episodes = episodesRaw
    .map((item, i) => normalizeEpisode(item, i + 1, durationSec, speakMode))
    .filter((x): x is GeneratedEpisodeScript => Boolean(x))
    .sort((a, b) => a.episode_no - b.episode_no);
  if (episodes.length === 0) {
    throw new Error("剧本里没有可用的分集，请再生成一次");
  }
  return {
    genre,
    title: asText(o.title, 28) || asText(episodes[0]?.title, 16) || "短视频系列",
    logline: asText(o.logline, 80),
    premise: asPremise(o.premise ?? o.synopsis ?? o.backstory ?? o.intro),
    audience: asText(o.audience, 40),
    notes: asText(o.notes, 120),
    episodes,
  };
}

function fallbackPremise(input: {
  seriesTitle: string;
  logline?: string;
  hookStyle?: VideoScriptHookStyle | string;
  episodes: ExistingEpisodeBrief[];
  cards?: StanceCard[];
}): string {
  const last = [...input.episodes].sort((a, b) => a.episode_no - b.episode_no).at(-1);
  const plot = [
    input.logline?.trim(),
    input.episodes[0]?.hook?.trim(),
    last?.recap?.trim(),
    last?.next_hook?.trim(),
  ]
    .filter(Boolean)
    .join(" ");
  const engine =
    isShowStyle(input.hookStyle) && !textHasShowEngine(plot, input.hookStyle)
      ? `${hookStyleLabel(input.hookStyle)}设定。`
      : "";
  return `${engine}${plot}`.trim().slice(0, PREMISE_MAX);
}

export function speakersFromVoiceover(text: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of splitLabeledTurns(text)) {
    const who = speakerOfLine(part);
    const line = part.replace(SPEAKER_PREFIX, "").trim();
    if (!who || who === "旁白" || !line || seen.has(who)) continue;
    seen.add(who);
    names.push(who);
  }
  return names;
}

function foldSpeaker(raw: string, known: string[]): string {
  const name = raw.trim();
  if (!name) return "";
  const hit = known.find((person) => name === person || name.startsWith(person));
  return hit || name;
}

function namesFromPremiseSource(
  episodes: ExistingEpisodeBrief[],
  extra?: string | string[],
): string[] {
  const known = (Array.isArray(extra) ? extra : [extra || ""])
    .map((name) => name.trim())
    .filter(Boolean);
  const found: string[] = [];
  const push = (raw: string) => {
    const name = foldSpeaker(raw, known);
    if (!name || name === "旁白" || found.includes(name)) return;
    found.push(name);
  };
  for (const name of known) push(name);
  for (const ep of episodes) {
    for (const who of speakersFromVoiceover(ep.voiceover || "")) push(who);
  }
  return known.length > 0 ? found.filter((name) => known.includes(name)) : found;
}

/** 给当前剧本写/刷新剧情介绍：设定 + 已经发生的事。 */
export async function writeSeriesPremise(input: {
  seriesTitle: string;
  logline?: string;
  premise?: string;
  hookStyle?: VideoScriptHookStyle | string;
  episodes: ExistingEpisodeBrief[];
  characterName?: string | string[];
  cards?: StanceCard[];
}): Promise<string> {
  const fallback = fallbackPremise(input);
  const show = isShowStyle(input.hookStyle);
  const styleName = hookStyleLabel(input.hookStyle);
  const lock = hookStylePremiseLine(input.hookStyle);
  const roster = namesFromPremiseSource(input.episodes, input.characterName);
  const ask = async (extra = "") => {
    const raw = await completeScriptLlm(
      [
        {
          role: "system",
          content: show
            ? `你给「${styleName}」短剧写剧情介绍。180–560字，可换行。只写设定和已经发生的事，像给没看过的人讲前情。不要写「角色大纲」，人设卡在别处。${lock}不要广告词，不要「本系列将讲述」，不要列集数大纲。旧介绍如果写成了别的题材，推倒重写。`
            : `你给短视频系列写剧情介绍。120–400字。写这套在讲什么、已经说到哪。不要写角色大纲。不要广告词，不要「本系列将讲述」。`,
        },
        {
          role: "user",
          content: [
            `题材必须是「${styleName}」。`,
            `剧本名：${input.seriesTitle}`,
            input.logline ? `一句话：${input.logline}` : "",
            roster.length ? `出场人：${roster.join("、")}。介绍里点到即可，不要写成名单。` : "",
            input.premise
              ? `旧介绍（按已发生的事改，发动机必须仍是「${styleName}」，删掉角色大纲那段）：${input.premise}`
              : "",
            extra,
            "已有分集：",
            formatExistingBriefs(input.episodes),
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      { temperature: 0.4, maxTokens: 1200, timeoutMs: 30_000 },
    );
    return dropCastOutlineBlock(
      raw.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
    ).slice(0, PREMISE_MAX);
  };
  const usable = (text: string) =>
    text.length >= 24 && textHasShowEngine(text, input.hookStyle);
  try {
    let text = await ask();
    if (text && !textHasShowEngine(text, input.hookStyle)) {
      text = await ask(`上一稿看不出「${styleName}」，必须重写，把这个发动机写进介绍。`);
    }
    if (usable(text)) return text;
    return fallback;
  } catch {
    return fallback;
  }
}

export function parseEpisodeList(
  raw: string,
  fallbackStart: number,
  durationSec: EpisodeDurationSec = 90,
  speakMode?: VideoSpeakMode,
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
    .map((item, i) => normalizeEpisode(item, fallbackStart + i, durationSec, speakMode))
    .filter((x): x is GeneratedEpisodeScript => Boolean(x));
}

const FACT_BOUNDARY = `事实边界：
- 品牌名、产品、官网、数据、客户、公司名、域名、资质，只许用文章和语料里已有的；没有的一律不写（包括点物、dianwu.ai）。
- 禁止催单、限时折扣、加微留资、招商加盟。`;

function lookHint(lookStyle?: string | null): string {
  return resolveLookStyle(lookStyle).visualHint;
}

function talkRules(
  sec?: unknown,
  innerVoice?: InnerVoiceLevel,
  lookStyle?: string | null,
): string {
  return `你是抖音/视频号资深短视频编导，不是公文写手，也不是课堂讲师。
写出来的东西要能停住划走的人：有钩子、有共鸣、有节奏、一听就懂。

${emotionRules(false, innerVoice)}

${FACT_BOUNDARY}

看懂：
- 用小学生也听得懂的大白话。短句，口语，语速要能快说，像抖音当面讲，不要书面长句，不要念稿。
- 专业词必须立刻打比方；禁止「赋能、抓手、闭环、底层逻辑、颗粒度」这类空话。
- 一集只讲一件事。听完能复述给别人。

${paceRules(false, sec)}
${lookHint(lookStyle)}
分镜必须连着拍，不要做成互不相关的幻灯片：
- 口播钩是第一句语言。第一镜 visual：近景看说话的人，第一帧已经张嘴在说。禁止「要开口」「嘴角微动」「结束时才开口」「先冷脸盯镜头」。不要写成短剧那种帖拍上桌、身体一紧。
- 口播：上一镜最后半句，下一镜第一句必须接得上，禁止每镜重新自我介绍或另起话题。
- 画面必须可拍：写成能看见的动作，不要抽象情绪。错：情绪愤怒。对：老爷子猛地拍桌，墨汁飞溅。
- 每镜 visual 写清：镜头类型、谁、可见动作、场、开头状态→结束状态。
- 每镜写 camera（特写|近景|中景|远景|推镜|拉镜|横移|固定|切镜），一镜只准一种运镜。
- 画面：默认同一场、同一套衣服、同一发型、同一光线。下一镜只推进动作、表情或机位。
- 定装：第一镜写死每个人穿什么。后面各镜写「同装」，禁止无故换装。角色库是现代便装、这一场是古代时，第一镜按这场定装，后面必须照穿，不要一镜长衫一镜西装。
- 体态要记账：每镜 visual 写清开头谁在哪、站还是坐、表情、手里有什么；再写结束时变成什么样。同场时下一镜开头必须等于上一镜结束，不要重画开头。上一镜已经站起来，下一镜禁止再写成坐着，除非写明「坐下」。
- 道具：只写会入画的具体物件（玉佩、签子、信、刀），不要写房间家具。每镜 shots[].props 列出这一镜看得见的道具名，没有就 []。同一件道具整集样子不要变。
- 出图一镜最多钉 10 张参考（入画人+道具+上一镜尾帧）。群戏不要全员入画，只特写/过肩这一下要看的 2–3 张脸，其余人拆到下一镜。
- 写这一镜时看一眼下一镜要去哪，结束状态要能接着演，不要和下一镜打架。
- 换场必须在 visual 里写「从A到B」。不要每镜换一套衣服或换一个无关房间。
- 每镜写 beat（钩|共|顶|打|停）、look（镜头看谁）和 join（接戏|切镜|换场）。钩/停/打默认切镜：同场但换构图，不要接着上一镜尾帧往前挪半步。只有同场推进才写接戏。换地方才写换场。
花字短、狠，是观众心里那一句，能独立看懂，不要复述口播。
最后只输出 JSON，不要解释。`;
}

function showRules(
  sec?: unknown,
  innerVoice?: InnerVoiceLevel,
  lookStyle?: string | null,
): string {
  return `你是竖屏短剧编导，写的是能连载的戏，不是口播课，也不是咨询会。

${FACT_BOUNDARY}
文章和语料只当舞台：行业、场景、人设、不能编的品牌和数据。
文章里的知识点、指标、步骤不能当对白念出来，只能变成这一集里的一件具体事（栽过、改过、被揭穿）。不要求每集讲一个知识点。

看懂：短句，口语，语速要能快说，像短剧对口，小学生能听懂谁在跟谁吵什么。不要书面长句，不要念稿。

一集只推进一个冲突拍：发现、打脸、选择、反转，四者只取一件做完。
金手指、穿越身份、重生记忆、系统绑定只露必须露的那一下。后面各集换新的冲突拍，禁止每集重复同一句设定。
人物必须有欲想和对手。对手要在场、要开口。没有第二个人就没有戏。
对手不是来上课的学员，是有自己目的的人。
对白推动关系，不要一个人念稿。连载时集与集必须留下未揭开的缺口；本集收束时不要写下一集。

${emotionRules(true, innerVoice)}

硬禁（写成这样就失败）：
- 会议室/白板讲方案，列「第一、第二、第三」或「三把尺子」
- 钩子用「你知道为什么吗 / 那怎么衡量 / 你是不是还在…… / 你可明白 / 总要有个规矩」
- 对白汇报检测方法或方案：「三个问法我都试了 / 咱们得改对外说法 / AI推荐了谁」
- 用提问把上周案情问清楚
- 标题写成公号提问句
- recap 写成知识点总结，next_hook 写成「下一集我们讲」
- recap / next_hook 出现准稿里没有的原话
- 把文章小标题、评估方法、步骤清单搬进对白
- visual 每镜写「观众先替谁」

${paceRules(true, sec)}
${lookHint(lookStyle)}
分镜必须连着拍：
- 对白：每镜只写新说的话，不要复述上一镜，不要把整集再抄一遍。
- 画面必须可拍：写成能看见的动作，不要抽象情绪。错：情绪愤怒。对：老爷子猛地拍桌，墨汁飞溅。
- 每镜 visual 写清：镜头类型、谁、可见动作、场、开头状态→结束状态。
- 每镜写 camera（特写|近景|中景|远景|推镜|拉镜|横移|固定|切镜），一镜只准一种运镜。
- 画面：默认同一场、同一套衣服、同一发型。下一镜只推进动作、表情、反应或机位。
- 定装：第一镜写死每个人穿什么。后面各镜写「同装」。角色库是现代便装、这一场是古代时，按这场定装并整集照穿，禁止一镜长衫一镜西装。
- 体态要记账：每镜 visual 写清开头谁在哪、站还是坐、表情、手里有什么；再写结束时变成什么样。同场时下一镜开头必须等于上一镜结束，不要重画开头。上一镜已经站起来，下一镜禁止再写成坐着，除非写明「坐下」。
- 道具：只写会入画的具体物件（玉佩、签子、信、刀），不要写房间家具。每镜 shots[].props 列出这一镜看得见的道具名，没有就 []。同一件道具整集样子不要变。
- 出图一镜最多钉 10 张参考（入画人+道具+上一镜尾帧）。群戏不要全员入画，只特写/过肩这一下要看的 2–3 张脸，其余人拆到下一镜。
- 写这一镜时看一眼下一镜要去哪，结束状态要能接着演。
- 换场必须在 visual 里写「从A到B」。不要每镜换装换脸换房间。
- 每镜写 beat（钩|共|顶|打|停）和 look（说话的人 / 挨打的人 / 特写）。骂完必须有反应镜。
花字短、狠，是没说出口的那句，替观众说话，不要复述对白，不要「第一把：XX」。
最后只输出 JSON，不要解释。`;
}

function sharedRules(
  hookStyle?: VideoScriptHookStyle | string,
  durationSec?: unknown,
  innerVoice?: InnerVoiceLevel,
  lookStyle?: string | null,
): string {
  return isShowStyle(hookStyle)
    ? showRules(durationSec, innerVoice, lookStyle)
    : talkRules(durationSec, innerVoice, lookStyle);
}

function speakLine(
  mode?: VideoSpeakMode,
  hookStyle?: VideoScriptHookStyle | string,
  durationSec?: unknown,
  innerVoice?: InnerVoiceLevel,
) {
  const pace = episodePace(durationSec);
  const continuity =
    `整集 voiceover 是准稿。shots[].voiceover 必须是准稿原句按顺序切开，拼起来要和准稿一字不差。禁止改词、禁止缩写复述、禁止另写一套对白。seconds 按抖音/短剧语速来写，短句就短、长句就长，不要每镜都 10 秒，不要按慢慢念稿估时长。visual 从第 2 镜起必须写清怎么接上一镜：同场推进、切反应，或明确换场；并写明这一镜结束时人是站是坐、在哪。默认同一套衣服同一发型同一场，不要每镜另起一张无关的画。`;
  if (normalizeSpeakMode(mode) === "dialogue") {
    const ensemble = isShowStyle(hookStyle)
      ? "这是多人对话短剧：至少两个人来回说话。问完立刻答，顶完立刻拆，误会立刻圆或立刻撕。禁止旁白讲道理，禁止一个人念稿演独角戏。对白按人设卡的立场写，不要为了轮流说话把上级写成请示、把下属写成拍板。"
      : "对白要有来回：问完立刻答，顶完立刻拆。按人设卡写，不要后半段把谁在教、谁在问写反。";
    return `说话方式：对话。准稿第一行必须写【对话】，随后每一句写成「角色名：原话」。${continuity} ${ensemble} 禁止写成没名字的一段话。voiceover 是出镜人原话，第一人称，像短剧当面吵，语速快，有口气：压、顶、冷、急、咽。一句一口气，禁止书面长句，禁止旁白腔，禁止把冲突写成说明，禁止念稿。说话镜才张嘴；反应镜看挨打的人，可以闭嘴。${innerVoiceWriteRules(innerVoice)}每镜写 speaker：角色名；内心镜加 delivery=inner 和 innerLevel。只有画外音才写「旁白」。同一镜只一个人，换人就拆镜。`;
  }
  return `说话方式：旁白。准稿第一行必须写【旁白】，随后每一句写成「旁白：原话」。${continuity} voiceover 是画外音，像抖音口播当面讲，语速快，短句，有轻重，不要播音腔，不要匀速念稿；角色可以看镜头、做事、停顿，不必对口型。每镜 speaker 写「旁白」。`;
}

export type ExistingEpisodeBrief = {
  episode_no: number;
  title: string;
  hook?: string;
  voiceover?: string;
  on_screen?: string;
  recap?: string;
  next_hook?: string;
};

function formatExistingBriefs(existing: ExistingEpisodeBrief[]): string {
  if (existing.length === 0) return "无";
  return existing
    .slice()
    .sort((a, b) => a.episode_no - b.episode_no)
    .map((e) => {
      const lines = [`第${e.episode_no}集 ${e.title || "未命名"}`];
      if (e.hook?.trim()) lines.push(`钩：${e.hook.trim()}`);
      if (e.recap?.trim()) lines.push(`收束：${e.recap.trim()}`);
      if (e.next_hook?.trim()) lines.push(`缺口：${e.next_hook.trim()}`);
      if (e.on_screen?.trim()) lines.push(`花字：${e.on_screen.trim()}`);
      if (e.voiceover?.trim()) {
        lines.push(`准稿：${e.voiceover.trim().slice(0, 500)}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function characterLine(
  name?: string | string[],
  hookStyle?: VideoScriptHookStyle | string,
  cards?: StanceCard[],
  opts?: { allowNewCast?: boolean },
): string {
  if (cards && cards.length > 0) return formatStanceCards(cards);
  const names = (Array.isArray(name) ? name : [name || ""])
    .map((x) => x.trim())
    .filter(Boolean);
  const show = isShowStyle(hookStyle);
  const style = normalizeHookStyle(hookStyle);
  const card = showEngineCard(hookStyle);
  const roles: Record<string, string> = {
    isekai: "今人主角，加上这个世界里压他的对手。衣服称呼要对那个世界。",
    rebirth: "带着上一世记忆的主角，加上上一世就认识、这世还当第一次的对手。",
    system: "被系统盯着的主角，加上逼他接或瞒的对手。系统不是人，不要单独当角色。",
    tycoon: "家里的人：至少两代或两房。对手是家里人，不是客户。",
    revenge: "被亏待的人，加上还嘴、会反咬的仇人。",
    romance: "两人，外加一个搅局的。不要讲师和学员。",
    workplace: "会上要站队的人，加上甩锅或拉拢的对手。不是客户来听课。",
    court: "这个时代的人，称呼衣服要对。对手用规矩压他。",
  };
  const roleHint = card
    ? `观众替「${card.root}」。${roles[style] || "主角、对手，必要时再加一个搅局的。对手不是学员。"} ${card.neverAs} ${hookStyleLookLine(style)}`
    : roles[style] || "主角、对手，必要时再加一个搅局的。对手不是学员。";
  const newCastLine = opts?.allowNewCast
    ? "已有角色必须接着用，不要换脸换装、不要改立场。剧情需要时可以再加新角色，必须起名、写进准稿「角色名：」。新角色进场要交代是谁、跟谁对立。不要把已有角色换掉。"
    : "";
  if (names.length === 0) {
    return show
      ? `人数按戏来，该有几人就几人，不要为了凑人。${roleHint}各集不要换脸。先写死谁压谁、谁知道什么，后面不要对调。`
      : "没有指定角色时，出镜用一个稳定的普通人，各集不要换脸。";
  }
  if (names.length === 1) {
    return show
      ? `「${names[0]}」是主角，不是讲师。还必须再写 ${roleHint}禁止客户来听课。${newCastLine || "分镜里不要换成名单外的新脸。"}`
      : `出镜角色固定为「${names[0]}」。口播用这个人的口吻；分镜 visual 必须是这个人在场，不要换成别人。${newCastLine}`;
  }
  const listed = names.map((n) => `「${n}」`).join("、");
  if (newCastLine) {
    return show
      ? `出镜角色先是${listed}。${roleHint}准稿写成「角色名：原话」。${newCastLine}`
      : `出镜角色先是${listed}。准稿写成「角色名：原话」。${newCastLine}`;
  }
  return show
    ? `出镜角色是${listed}。${roleHint}准稿写成「角色名：原话」。先写死谁压谁、谁在教、谁在问，整集不要对调。对白要顶起来，不要各说各的，不要写成开会听课，不要再加新脸。`
    : `出镜角色是${listed}。准稿写成「角色名：原话」。分镜里只能出现这些人。对白必须接得上，不要各说各的，不要把谁在教谁在问写反，不要换成别人，不要再加新脸。`;
}

export function endingRules(input: {
  episodeCount: number;
  hasSequel?: boolean;
  show?: boolean;
  episodeNo?: number;
}): string {
  const count = Math.max(1, Math.round(input.episodeCount || 1));
  const sequel = input.hasSequel === true;
  const show = input.show === true;
  const no = input.episodeNo;
  const thisCloses =
    !sequel && (count === 1 || (typeof no === "number" && no >= count));
  if (thisCloses) {
    return show
      ? "本集没有后续。冲突必须在本集收束：最后一句是结局，不要电话打断、不要问完不答、不要「我马上来」。next_hook 写收束一句，禁止写下一集缺口。"
      : "本集没有后续。把这一点讲完，最后一句落地。next_hook 写收束一句或金句，禁止写下一集缺口。";
  }
  if (count === 1) {
    return show
      ? "用户标明还有后续。本集在冲突最紧处停，next_hook 写没揭开的缺口，不要写成大结局。"
      : "用户标明还有后续。本集可以留尾巴，next_hook 写缺口，不要把后话一次讲完。";
  }
  if (sequel) {
    return `这是 ${count} 集连载，后面还有后续。每集包括最后一集都留缺口，next_hook 写没揭开的那一句。`;
  }
  return `这是 ${count} 集。第 1 到 ${count - 1} 集集尾留缺口；第 ${count} 集必须收束，没有再下一集。`;
}

function genreLine(
  _genre: VideoScriptGenre,
  hookStyle?: VideoScriptHookStyle | string,
): string {
  return hookStyleLine(hookStyle || "talk");
}

function jsonSchemaHint(
  count: number,
  total?: number,
  hookStyle?: VideoScriptHookStyle | string,
  durationSec?: unknown,
  hasSequel?: boolean,
  lookStyle?: string | null,
): string {
  const show = isShowStyle(hookStyle);
  const pace = episodePace(durationSec);
  const close = !hasSequel && (total || count) <= 1;
  const shot = hookStyleShotContract(hookStyle);
  return `输出 JSON 对象：
{
  "title": "剧本名（必填，≤16字，像抖音合集名，短狠有钩子。禁止指南/攻略/五步/从0到1，不要照抄文章标题，不要写「短视频系列」）",
  "logline": "${show ? "一句话：这套戏在演谁和谁的什么冲突" : "一句话：看完能得到什么"}",
      "premise": "剧情介绍，180–560字，可换行。只写设定和已经发生的事。${hookStylePremiseLine(hookStyle)}不要写角色大纲，不要广告词，不要「本系列将讲述」",
  "audience": "给谁看，用他们自己的话说",
  "notes": "连载时注意什么",
  "episodes": [
    {
      "episode_no": 1,
      "title": "${show ? "本集标题（≤16字，像短剧集名，不要公号提问句）" : "本集标题（≤16字，像视频标题，有钩子）"}",
      "hook": "${show ? `开场${pace.sec === 15 ? "2" : "3"}秒原话，${shot.hook}` : `开场${pace.sec === 15 ? "2" : "3"}秒原话，必填不能空，必须能单独当开头`}",
      "voiceover": "${show ? `先写【对话】，再写「角色名：原话」来回，${pace.voiceMin}-${pace.voiceMax}字，是吵架/对峙/重逢，不是讲课，最后一句必须说完。分镜只能切开准稿，不准改词` : `先写【旁白】，再写「旁白：原话」，${pace.voiceMin}-${pace.voiceMax}字，最后一句必须说完。分镜只能切开准稿，不准另写一套`}",
      "on_screen": "${shot.onScreen}",
      "recap": "${show ? "观众替谁、感到哪种情绪、这一拍改了什么关系，收在气还是爽。不要知识点总结，不要引用准稿里没有的原话" : "本集收束一句，要能记住"}",
      "next_hook": "${close ? "本集收束一句，必须是准稿里停住的那句，不要编新台词，不要写下一集" : show ? "没揭开的缺口，不要写「下一集我们讲」，不要编准稿里没有的原话" : "下集缺口"}",
      "duration_sec": "各镜 seconds 相加，按实际对白，不要硬写 ${pace.sec}",
      "shots": [
        {
          "seconds": "按抖音/短剧语速，短句4–6秒，长句7–12秒，不要每镜都10秒，不要按念稿估",
          "beat": "钩|共|顶|打|停，这一镜调用观众哪一下",
          "look": "${shot.look}",
          "camera": "特写|近景|中景|远景|推镜|拉镜|横移|固定|切镜，一镜只准一种",
          "props": ["这一镜看得见的道具名，没有就空数组"],
          "visual": "${shot.visual}",
          "voiceover": "必须是准稿里的原句切片，不准改词、不准缩写、不准另写",
          "speaker": "这镜说话的角色名，必须和准稿「角色名：」一致，同一镜只一个人",
          "delivery": "line=张嘴说；inner=心里的声音、闭嘴。内心句对应准稿「角色名（内心·炸）：」",
          "innerLevel": "内心强烈度 low=压 / mid=震 / high=炸。不是内心镜不要写",
          "imagePrompt": "竖屏9:16${resolveLookStyle(lookStyle).stillAlias}分镜，接上一镜已定装的衣服发型场景，无水印无logo无网址"
        }
      ]
    }
  ]
}
${
    total && total > count
      ? `这套一共 ${total} 集。这次只写第 1 到 ${count} 集，必须正好 ${count} 集，episode_no 从 1 到 ${count}。`
      : `必须正好 ${count} 集，episode_no 从 1 连续到 ${count}。`
  }`;
}

const LECTURE_MARK =
  /第一把|第二把|第三把|三把尺子|你知道为什么吗|那怎么衡量|下一集.{0,12}(讲|拆|看)|简单来说|记住三|评估的不是|三个问法|改对外说法|AI推荐了谁/;

function episodeBlob(ep: GeneratedEpisodeScript): string {
  return [
    ep.title,
    ep.hook,
    ep.voiceover,
    ep.recap,
    ep.next_hook,
    ep.on_screen,
    ...ep.shots.map((s) => `${s.voiceover}\n${s.visual}\n${s.onScreen}`),
  ].join("\n");
}

function episodeLooksLikeLecture(ep: GeneratedEpisodeScript): boolean {
  return LECTURE_MARK.test(episodeBlob(ep));
}

function episodeMissesShowEngine(
  ep: GeneratedEpisodeScript,
  hookStyle?: VideoScriptHookStyle | string,
): boolean {
  const mark = showEngineMark(hookStyle);
  if (!mark) return false;
  return !mark.test(episodeBlob(ep));
}

export function rewriteIsUsable(
  next: GeneratedEpisodeScript,
  prev: GeneratedEpisodeScript,
  durationSec?: unknown,
): boolean {
  const pace = episodePace(durationSec);
  const nextLen = compactSpoken(next.voiceover).length;
  const prevLen = compactSpoken(prev.voiceover).length;
  if (nextLen < pace.voiceMin && nextLen <= prevLen) return false;
  if (next.shots.length < pace.shotMin && prev.shots.length >= pace.shotMin) {
    return false;
  }
  return true;
}

function episodeNeedsShowRewrite(
  ep: GeneratedEpisodeScript,
  hookStyle?: VideoScriptHookStyle | string,
): boolean {
  if (!isShowStyle(hookStyle)) return false;
  return episodeLooksLikeLecture(ep) || episodeMissesShowEngine(ep, hookStyle);
}

async function rewriteLectureEpisodes(
  episodes: GeneratedEpisodeScript[],
  input: {
    title: string;
    body: string;
    genre: VideoScriptGenre;
    hookStyle?: VideoScriptHookStyle | string;
    lookStyle?: string | null;
    seriesTitle: string;
    corpusText: string;
    characterName?: string | string[];
    speakMode?: VideoSpeakMode;
    innerVoice?: InnerVoiceLevel;
    durationSec?: EpisodeDurationSec;
    cards?: StanceCard[];
  },
  onEvent?: (event: VideoScriptGenEvent) => void | Promise<void>,
): Promise<GeneratedEpisodeScript[]> {
  if (!isShowStyle(input.hookStyle)) return episodes;
  const styleName = hookStyleLabel(input.hookStyle);
  const durationSec = clampEpisodeDuration(input.durationSec);
  const out = [...episodes];
  for (let i = 0; i < out.length; i += 1) {
    const ep = out[i];
    if (!episodeNeedsShowRewrite(ep, input.hookStyle)) continue;
    const why = episodeLooksLikeLecture(ep)
      ? "还是口播课/咨询会"
      : `还看不出「${styleName}」`;
    await onEvent?.({
      type: "status",
      message: `第 ${ep.episode_no} 集${why}，正在按「${styleName}」重写…`,
    });
    let raw = "";
    try {
      raw = await streamModelText(
      [
        {
          role: "system",
          content: `${sharedRules(input.hookStyle, durationSec, input.innerVoice, input.lookStyle)}\n\n${genreLine(input.genre, input.hookStyle)}\n${characterLine(input.characterName, input.hookStyle, input.cards)}\n${speakLine(input.speakMode, input.hookStyle, durationSec, input.innerVoice)}`,
        },
        {
          role: "user",
          content: `系列「${input.seriesTitle}」第 ${ep.episode_no} 集写偏了，必须推倒重写成「${styleName}」短剧，预算约 ${durationSec} 秒，第一要务是把剧情演清楚，秒数按对白走，不要混成别的题材，不要写成口播课。
${showKickoffLine(input.hookStyle)}
第一镜必须：${showEngineCard(input.hookStyle)?.firstHit || "冲突已经发生，观众先站队。"}
不要保留「三把尺子、你知道为什么吗、那怎么衡量、白板讲课、下一集我们讲」。
文章只当舞台。只输出这一集的 JSON 对象。

失败稿（对照着避开）：
标题：${ep.title}
钩子：${ep.hook}
口播：${ep.voiceover.slice(0, 400)}
收束：${ep.recap}
下集：${ep.next_hook}

文章标题：${input.title}
正文：
${input.body.slice(0, 6000)}

语料：
${input.corpusText}`,
        },
      ],
      {
        maxTokens: 8192,
        timeoutMs: durationSec <= 15 ? 90_000 : 180_000,
        thinkingEffort: durationSec <= 15 ? "low" : "high",
        onEvent,
      },
    );
    } catch (err) {
      await onEvent?.({
        type: "status",
        message: `第 ${ep.episode_no} 集重写没落下来，仍用原口播`,
      });
      continue;
    }
    const [next] = parseEpisodeList(
      raw,
      ep.episode_no,
      durationSec,
      input.speakMode,
    );
    if (!next) continue;
    if (!rewriteIsUsable(next, ep, durationSec)) {
      await onEvent?.({
        type: "status",
        message: `第 ${ep.episode_no} 集重写太短，仍用原口播`,
      });
      continue;
    }
    out[i] = { ...next, episode_no: ep.episode_no };
  }
  return out;
}

async function finalizeGeneratedEpisodes(
  episodes: GeneratedEpisodeScript[],
  input: {
    title: string;
    body: string;
    genre: VideoScriptGenre;
    hookStyle?: VideoScriptHookStyle | string;
    lookStyle?: string | null;
    seriesTitle: string;
    corpusText: string;
    characterName?: string | string[];
    speakMode?: VideoSpeakMode;
    innerVoice?: InnerVoiceLevel;
    durationSec?: EpisodeDurationSec;
    cards?: StanceCard[];
    shotModel?: string;
    wardrobe?: SeriesWardrobeLock | null;
  },
  onEvent?: (event: VideoScriptGenEvent) => void | Promise<void>,
): Promise<GeneratedEpisodeScript[]> {
  const rewritten = await rewriteLectureEpisodes(episodes, input, onEvent);
  const short = clampEpisodeDuration(input.durationSec) === 15;
  const reviewed = short
    ? rewritten
    : await reviewGeneratedEpisodes(
        rewritten,
        {
          speakMode: input.speakMode,
          innerVoice: input.innerVoice,
          characterName: input.characterName,
          durationSec: input.durationSec,
          cards: input.cards,
          show: isShowStyle(input.hookStyle),
          skipEmotion: true,
          rewriteEpisode: (episode, issues) =>
            rewriteEpisodeToStance(episode, { ...input, issues }),
        },
        onEvent,
      );
  if (
    short &&
    reviewed.every((ep) => firstPassShotsOk(ep, input.durationSec))
  ) {
    return reviewed.map(scrubShowCopy);
  }
  const directed = await directGeneratedEpisodes(
    reviewed,
    {
      hookStyle: input.hookStyle,
      lookStyle: input.lookStyle,
      seriesTitle: input.seriesTitle,
      characterName: input.characterName,
      speakMode: input.speakMode,
      innerVoice: input.innerVoice,
      durationSec: input.durationSec,
      cards: input.cards,
      shotModel: input.shotModel,
      wardrobe: input.wardrobe,
    },
    onEvent,
  );
  return directed.map(scrubShowCopy);
}

async function rewriteEpisodeToStance(
  episode: GeneratedEpisodeScript,
  input: {
    title: string;
    body: string;
    genre: VideoScriptGenre;
    hookStyle?: VideoScriptHookStyle | string;
    lookStyle?: string | null;
    seriesTitle: string;
    corpusText: string;
    characterName?: string | string[];
    speakMode?: VideoSpeakMode;
    innerVoice?: InnerVoiceLevel;
    durationSec?: EpisodeDurationSec;
    cards?: StanceCard[];
    issues?: string[];
  },
): Promise<GeneratedEpisodeScript | null> {
  const durationSec = clampEpisodeDuration(input.durationSec);
  const raw = await streamModelText(
    [
      {
        role: "system",
        content: `${sharedRules(input.hookStyle, durationSec, input.innerVoice, input.lookStyle)}\n\n${genreLine(input.genre, input.hookStyle)}\n${characterLine(input.characterName, input.hookStyle, input.cards)}\n${speakLine(input.speakMode, input.hookStyle, durationSec, input.innerVoice)}`,
      },
      {
        role: "user",
        content: `系列「${input.seriesTitle}」第 ${episode.episode_no} 集立场写反了，必须按人设卡重写对白，不要对调谁压谁、谁在教、谁在问。
审稿指出：${(input.issues || []).join("；") || "后半集权力关系写反"}
失败稿只对照着避开，不要沿用反了的口气：
${episode.voiceover.slice(0, 500)}
文章标题：${input.title}
正文：
${input.body.slice(0, 4000)}
只输出这一集的 JSON 对象。`,
      },
    ],
    { maxTokens: 8192, timeoutMs: 90_000, thinkingEffort: "low" },
  );
  const [next] = parseEpisodeList(
    raw,
    episode.episode_no,
    durationSec,
    input.speakMode,
  );
  return next ? { ...next, episode_no: episode.episode_no } : null;
}

function extractJsonText(raw: string): string {
  const parsed = pickRichestJson(raw);
  return parsed ? JSON.stringify(parsed) : "";
}

async function streamModelText(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options: {
    maxTokens: number;
    timeoutMs: number;
    thinkingEffort?: "low" | "high" | "max";
    onEvent?: (event: VideoScriptGenEvent) => void | Promise<void>;
  },
): Promise<string> {
  const model = scriptModel();
  await options.onEvent?.({ type: "meta", model });
  let content = "";
  let thinking = "";
  let lastStatusAt = 0;
  for await (const chunk of streamScriptLlm(messages, {
    model,
    temperature: 0.55,
    maxTokens: options.maxTokens,
    timeoutMs: options.timeoutMs,
    thinkingEffort: options.thinkingEffort,
  })) {
    if (chunk.type === "thinking") {
      thinking += chunk.text;
      await options.onEvent?.({ type: "thinking", delta: chunk.text });
      if (!lastStatusAt) {
        lastStatusAt = Date.now();
        await options.onEvent?.({
          type: "status",
          message: "正在想钩子和节奏…",
        });
      } else if (Date.now() - lastStatusAt > 4000) {
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

  const fromCombined = extractJsonText(`${content}\n${thinking}`);
  if (fromCombined) return fromCombined;
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
  const fallback = await completeScriptLlm(
    [
      ...messages,
      {
        role: "user",
        content:
          "上面已经想过了。现在只输出完整 JSON 剧本，不要解释，不要 markdown 以外的字，不要再写思考。",
      },
    ],
    {
      model: scriptLlmFallbackId(model),
      temperature: 0.4,
      maxTokens: Math.min(8192, options.maxTokens),
      timeoutMs: 90_000,
      disableThinking: true,
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
    lookStyle?: string | null;
    sourceKind?: "article" | "script";
    episodeCount?: number;
    seriesName?: string;
    characterName?: string | string[];
    speakMode?: VideoSpeakMode;
    innerVoice?: InnerVoiceLevel;
    durationSec?: number;
    hasSequel?: boolean;
    shotModel?: string;
    wardrobe?: SeriesWardrobeLock | null;
    savedNotes?: string;
  },
  onEvent?: (event: VideoScriptGenEvent) => void | Promise<void>,
): Promise<GeneratedVideoSeries> {
  const title = input.title.trim() || "未命名文章";
  const body = stripHtml(input.bodyHtml);
  const sourceKind = resolveScriptSourceKind(input.sourceKind, body);
  const minChars = scriptSourceMinChars(sourceKind);
  if (body.length < minChars) {
    throw new Error(
      sourceKind === "script"
        ? "贴进来的本太短，再补几句对白或情节"
        : "正文太短，请先写完文章再拆剧本",
    );
  }
  const hookStyle = normalizeHookStyle(input.hookStyle);
  const lookStyle = resolveLookStyle(input.lookStyle).id;
  const genre = genreFromHookStyle(hookStyle);
  const count = clampEpisodeCount(input.episodeCount);
  const durationSec = clampEpisodeDuration(input.durationSec);
  const writeBudget = scriptWriteBudget(count, durationSec);
  const corpus = selectCorpusForBrief(`${title}\n${body.slice(0, 400)}`, {});
  const corpusText = buildCorpusContext(corpus);

  const show = isShowStyle(hookStyle);
  const hasSequel = input.hasSequel === true;
  const ending = endingRules({ episodeCount: count, hasSequel, show });
  const names = [
    ...new Set(
      (Array.isArray(input.characterName)
        ? input.characterName
        : [input.characterName || ""]
      )
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
  await onEvent?.({
    type: "status",
    message:
      count === 1
        ? `正在写 1 集剧本（预算约 ${durationSec} 秒，以演清楚为准）…`
        : `正在拆 ${count} 集剧本（每集预算约 ${durationSec} 秒，以演清楚为准）…`,
  });
  const deferCards = names.length === 0 || (count === 1 && durationSec <= 15);
  const cards = deferCards
    ? []
    : await generateStanceCards({
        names,
        hookStyle,
        title,
        body,
      });
  const system = [
    sharedRules(hookStyle, durationSec, input.innerVoice, lookStyle),
    genreLine(genre, hookStyle),
    characterLine(input.characterName, hookStyle, cards),
    speakLine(input.speakMode, hookStyle, durationSec, input.innerVoice),
    ending,
  ]
    .filter(Boolean)
    .join("\n");

  const firstBatch = Math.min(count, FIRST_EPISODE_BATCH);
  const countLine =
    count === 1
      ? show
        ? `只写 1 集完整成片，预算约 ${durationSec} 秒，第一要务是把一个冲突拍演清楚，要有对手对白。秒数按对白走，不要为凑时长注水。${ending}`
        : `只写 1 集完整成片，预算约 ${durationSec} 秒，第一要务是把最能停住观众的一个点讲透。秒数按口播走，不要为凑时长注水。${ending}`
      : show
        ? `拆成 ${count} 集连载短剧，每集预算约 ${durationSec} 秒、只推进一个冲突拍。以演清楚为准。${ending}${
            count > firstBatch ? `这次先写第 1 到 ${firstBatch} 集。` : ""
          }`
        : `拆成 ${count} 集连载，每集预算约 ${durationSec} 秒、只讲一件事。以讲清楚为准。${ending}${
            count > firstBatch ? `这次先写第 1 到 ${firstBatch} 集。` : ""
          }`;

  const named = input.seriesName?.trim().slice(0, 16) || "";
  const keepName = Boolean(named) && !looksLikeManualScriptTitle(named);
  const nameLine = keepName
    ? `剧本名必须用「${named}」。JSON 的 title 就填这个，不要另起名。`
    : named
      ? `栏里的「${named}」像说明书，不要用。必须另起一个好记的抖音合集名，短、狠、有钩子。禁止指南/攻略/五步/从0到1，不要论文题，不要照抄文章标题。`
      : "必须给这套剧本起一个好记的名字，写在 title 里。像抖音合集名，短、狠、有钩子。禁止指南/攻略/五步，不要论文题，不要照抄文章标题。";

  const paceHint =
    durationSec <= 15 && count <= 2
      ? `这集只要约 ${durationSec} 秒、${episodePace(durationSec).shotMin}–${episodePace(durationSec).shotMax} 镜。钩子和节奏用不超过 6 句话想完，立刻输出 JSON，不要长篇分析。`
      : "";
  const thinkLine = [
    show
      ? showKickoffLine(hookStyle)
      : paceHint ||
        `先想清楚：这集凭什么不被划走？观众是谁？他正在烦什么？然后才写剧本。`,
    show ? paceHint : "",
  ]
    .filter(Boolean)
    .join("\n");

  const sourceSlice =
    sourceKind === "script"
      ? Math.max(writeBudget.sourceChars, 6000)
      : writeBudget.sourceChars;
  const user = `${countLine}
${nameLine}
${thinkLine}

${
    sourceKind === "script"
      ? `这是已有剧本/对白，不是科普文章。按选定题材改写成我们这套竖屏短剧。
必须保留原作的人、关系、冲突和关键情节，不要另起故事。
对白改成能演的短句，准稿仍用「角色名：」。角色名必须是人名，不要把镜头动作、花字、表情、道具写成角色名。
不要写成说明书，不要上课。
原作名：${title}
原剧本：
${body.slice(0, sourceSlice)}`
      : `文章标题：${title}

正文：
${body.slice(0, sourceSlice)}`
  }

可参考的语料（品牌/事实只许用这里有的）：
${corpusText}

${jsonSchemaHint(firstBatch, count, hookStyle, durationSec, hasSequel, lookStyle)}`;

  const raw = await streamModelText(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    {
      maxTokens: writeBudget.maxTokens,
      timeoutMs: writeBudget.timeoutMs,
      thinkingEffort: writeBudget.thinkingEffort,
      onEvent,
    },
  );

  const series = parseSeries(raw, genre, durationSec, input.speakMode);
  const byNo = new Map<number, GeneratedEpisodeScript>();
  for (const ep of series.episodes) {
    if (ep.episode_no <= count) byNo.set(ep.episode_no, ep);
  }
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter(
    (n) => !byNo.has(n),
  );
  for (let i = 0; i < missing.length; i += FILL_EPISODE_CHUNK) {
    const chunk = missing.slice(i, i + FILL_EPISODE_CHUNK);
    await onEvent?.({
      type: "status",
      message: `正在补第 ${chunk[0]}–${chunk[chunk.length - 1]} 集（共 ${count} 集）…`,
    });
    const filled = await generateEpisodeScripts(
      {
        title,
        body,
        genre,
        hookStyle,
        lookStyle,
        sourceKind,
        seriesTitle: named || series.title,
        episodeNos: chunk,
        existing: [...byNo.values()].sort((a, b) => a.episode_no - b.episode_no),
        corpusText,
        characterName: input.characterName,
        speakMode: input.speakMode,
      innerVoice: input.innerVoice,
        durationSec,
        hasSequel,
        seriesEpisodeCount: count,
        cards,
        premise: series.premise,
      },
      onEvent,
    );
    for (const ep of filled) {
      if (ep.episode_no <= count) byNo.set(ep.episode_no, ep);
    }
  }
  const episodes = Array.from({ length: count }, (_, i) => i + 1)
    .map((n) => byNo.get(n))
    .filter((x): x is GeneratedEpisodeScript => Boolean(x));
  if (episodes.length === 0) {
    throw new Error("未能拆出分集剧本，请再试一次");
  }
  const rewritten = await finalizeGeneratedEpisodes(
    episodes,
    {
      title,
      body,
      genre,
      hookStyle,
      lookStyle,
      seriesTitle: named || series.title,
      corpusText,
      characterName: input.characterName,
      speakMode: input.speakMode,
      innerVoice: input.innerVoice,
      durationSec,
      cards,
      shotModel: input.shotModel,
      wardrobe: input.wardrobe,
    },
    onEvent,
  );
  const shotCount = rewritten.reduce(
    (sum, ep) => sum + (ep.shots?.length || 0),
    0,
  );
  await onEvent?.({
    type: "status",
    message: `分镜已切好：${rewritten.length} 集、${shotCount} 镜`,
  });
  const episodeBriefs = rewritten.map((ep) => ({
    episode_no: ep.episode_no,
    title: ep.title,
    hook: ep.hook,
    voiceover: ep.voiceover,
    on_screen: ep.on_screen,
    recap: ep.recap,
    next_hook: ep.next_hook,
  }));
  let roster = [
    ...new Set(
      (Array.isArray(input.characterName)
        ? input.characterName
        : [input.characterName || ""]
      )
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
  if (roster.length === 0) {
    await onEvent?.({ type: "status", message: "正在用模型从剧本里认角色…" });
    try {
      const briefs = await describeCharactersFromScript({
        seriesTitle: named || series.title,
        genre,
        hookStyle,
        nameHint: Array.isArray(input.characterName)
          ? input.characterName.filter(Boolean).join("、")
          : input.characterName,
        episodes: rewritten.map((ep) => ({
          title: ep.title,
          hook: ep.hook,
          voiceover: ep.voiceover,
          on_screen: ep.on_screen,
        })),
      });
      roster = briefs.map((item) => item.name).filter(Boolean);
    } catch {
      roster = [];
    }
  }
  let nextCards = cards.filter((card) => !isCannedStanceCard(card));
  if (nextCards.length === 0) {
    nextCards = resolveStanceCards(input.savedNotes || "", roster, hookStyle);
  }
  if (roster.length > 0) {
    const script = episodeScriptBlob(rewritten);
    const stale =
      nextCards.length === 0 ||
      nextCards.some((card) => !card.intro.trim()) ||
      roster.some((name) => !nextCards.some((card) => card.name === name));
    if (stale) {
      await onEvent?.({ type: "status", message: "正在按剧本写角色介绍…" });
      nextCards = await generateStanceCards({
        names: roster,
        hookStyle,
        title,
        body,
        script,
      });
    }
  }
  let premise = series.premise.trim();
  if (premise.length < 24 || !textHasShowEngine(premise, hookStyle)) {
    await onEvent?.({ type: "status", message: "正在写剧情介绍…" });
    premise = await writeSeriesPremise({
      seriesTitle: named || series.title,
      logline: series.logline,
      premise,
      hookStyle,
      characterName: roster.length ? roster : input.characterName,
      cards: nextCards,
      episodes: episodeBriefs,
    });
  }
  return {
    ...series,
    title: named || series.title,
    premise,
    notes: embedStanceNotes(series.notes, nextCards),
    episodes: rewritten,
  };
}

export async function generateEpisodeScripts(
  input: {
    title: string;
    body: string;
    genre: VideoScriptGenre;
    hookStyle?: VideoScriptHookStyle | string;
    lookStyle?: string | null;
    sourceKind?: "article" | "script";
    seriesTitle: string;
    episodeNos: number[];
    existing: ExistingEpisodeBrief[];
    corpusText: string;
    characterName?: string | string[];
    speakMode?: VideoSpeakMode;
    innerVoice?: InnerVoiceLevel;
    durationSec?: number;
    hasSequel?: boolean;
    seriesEpisodeCount?: number;
    cards?: StanceCard[];
    allowNewCast?: boolean;
    continueFrom?: string;
    premise?: string;
  },
  onEvent?: (event: VideoScriptGenEvent) => void | Promise<void>,
): Promise<GeneratedEpisodeScript[]> {
  if (input.episodeNos.length === 0) return [];
  const durationSec = clampEpisodeDuration(input.durationSec);
  const writeBudget = scriptWriteBudget(input.episodeNos.length, durationSec);
  const others = formatExistingBriefs(input.existing);
  const last = [...input.existing].sort((a, b) => a.episode_no - b.episode_no).at(-1);
  const continueFrom = (input.continueFrom || last?.next_hook || "").trim();
  const sequelBlock = continueFrom
    ? `这是续写，不是重拆。已有集是底本，不要重写、不要改已经发生的事。从缺口接着演：${continueFrom}`
    : "";
  const raw = await streamModelText(
    [
      {
        role: "system",
        content: `${sharedRules(input.hookStyle, durationSec, input.innerVoice, input.lookStyle)}\n\n${genreLine(input.genre, input.hookStyle)}\n${characterLine(input.characterName, input.hookStyle, input.cards, { allowNewCast: input.allowNewCast })}\n${speakLine(input.speakMode, input.hookStyle, durationSec, input.innerVoice)}\n${endingRules({
          episodeCount: input.seriesEpisodeCount || input.episodeNos[input.episodeNos.length - 1] || 1,
          hasSequel: input.hasSequel,
          show: isShowStyle(input.hookStyle),
          episodeNo: input.episodeNos[input.episodeNos.length - 1],
        })}`,
      },
      {
        role: "user",
        content: `系列「${input.seriesTitle}」还要写这些集：${input.episodeNos.join("、")}。
${isShowStyle(input.hookStyle) ? showKickoffLine(input.hookStyle) : ""}
${input.premise?.trim() ? `剧情介绍（必须接着这条世界走，发动机必须仍是「${hookStyleLabel(input.hookStyle)}」，已有角色不准换脸换立场）：${input.premise.trim()}` : ""}
${sequelBlock}
已有分集（不要重复同一个${isShowStyle(input.hookStyle) ? "冲突拍" : "点"}）：
${others}
${
          resolveScriptSourceKind(input.sourceKind, input.body) === "script"
            ? `原作名：${input.title}
原剧本（改写时保留人、冲突、情节，不要另起故事。已写过的集不要再写，从原作还没拍到的部分接着改。准稿「角色名：」必须是人名，不要用镜头动作或花字当名字）：
${input.body.slice(0, 10000)}`
            : `文章标题：${input.title}
正文：
${input.body.slice(0, 8000)}`
        }

语料：
${input.corpusText}

只输出 JSON 数组，元素字段与分集剧本相同（episode_no/title/hook/voiceover/on_screen/recap/next_hook/duration_sec/shots）。每集预算约 ${durationSec} 秒，以把剧情演清楚为准；seconds 按这句对白来，不要每镜都 10 秒。hook 必填不能空。禁止同一句复读凑字数。
${endingRules({
  episodeCount: input.seriesEpisodeCount || input.episodeNos[input.episodeNos.length - 1] || 1,
  hasSequel: input.hasSequel,
  show: isShowStyle(input.hookStyle),
  episodeNo: input.episodeNos[input.episodeNos.length - 1],
})}
${
  isShowStyle(input.hookStyle)
    ? "必须是戏，不是课：禁止白板列一二三、禁止客户来听课、禁止「你知道为什么吗 / 那怎么衡量 / 下一集我们讲」。对白是一条连着的戏，每镜只写新说的话，至少两个人来回。画面默认同一场同一套衣服，换场必须写明。"
    : "每一集都要有自己的钩子和共鸣。口播是一条连着的对话：各镜 voiceover 拼起来就是完整口播，每镜只写新说的话，不要把整集或上一镜再抄一遍。画面默认同一场同一套衣服，换场必须写明。"
}
小学生能听懂。on_screen 必填，写 6–16 字主花字，不能空。`,
      },
    ],
    {
      maxTokens: writeBudget.maxTokens,
      timeoutMs: writeBudget.timeoutMs,
      thinkingEffort: writeBudget.thinkingEffort,
      onEvent,
    },
  );
  const parsed = parseEpisodeList(
    raw,
    input.episodeNos[0] || 1,
    durationSec,
    input.speakMode,
  );
  return rewriteLectureEpisodes(
    parsed,
    {
      title: input.title,
      body: input.body,
      genre: input.genre,
      hookStyle: input.hookStyle,
      seriesTitle: input.seriesTitle,
      corpusText: input.corpusText,
      characterName: input.characterName,
      speakMode: input.speakMode,
      innerVoice: input.innerVoice,
      durationSec,
      cards: input.cards,
    },
    onEvent,
  );
}

export async function regenerateOneEpisode(
  input: {
    title: string;
    bodyHtml: string;
    genre: VideoScriptGenre;
    hookStyle?: VideoScriptHookStyle | string;
    lookStyle?: string | null;
    seriesTitle: string;
    episodeNo: number;
    existing: ExistingEpisodeBrief[];
    characterName?: string | string[];
    speakMode?: VideoSpeakMode;
    innerVoice?: InnerVoiceLevel;
    durationSec?: number;
    hasSequel?: boolean;
    stanceNotes?: string;
    premise?: string;
    shotModel?: string;
    wardrobe?: SeriesWardrobeLock | null;
  },
  onEvent?: (event: VideoScriptGenEvent) => void | Promise<void>,
): Promise<GeneratedEpisodeScript> {
  const body = stripHtml(input.bodyHtml);
  const corpus = selectCorpusForBrief(`${input.title}\n${body.slice(0, 400)}`, {});
  const names = [
    ...new Set(
      (Array.isArray(input.characterName)
        ? input.characterName
        : [input.characterName || ""]
      )
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
  await onEvent?.({
    type: "status",
    message: `正在重写第 ${input.episodeNo} 集，先核对人设立场…`,
  });
  const saved = resolveStanceCards(input.stanceNotes || "", names, input.hookStyle);
  const locked =
    saved.length >= names.length
      ? saved
      : await generateStanceCards({
          names,
          hookStyle: input.hookStyle,
          title: input.title,
          body,
          script: episodeScriptBlob(input.existing),
        });
  const [ep] = await generateEpisodeScripts(
    {
      title: input.title,
      body,
      genre: input.genre,
      hookStyle: input.hookStyle,
      lookStyle: input.lookStyle,
      seriesTitle: input.seriesTitle,
      episodeNos: [input.episodeNo],
      existing: input.existing.filter((e) => e.episode_no !== input.episodeNo),
      corpusText: buildCorpusContext(corpus),
      characterName: input.characterName,
      speakMode: input.speakMode,
      innerVoice: input.innerVoice,
      durationSec: input.durationSec,
      hasSequel: input.hasSequel,
      seriesEpisodeCount: Math.max(
        input.episodeNo,
        ...input.existing.map((e) => e.episode_no),
        1,
      ),
      cards: locked,
      premise: input.premise,
    },
    onEvent,
  );
  if (!ep) {
    throw new Error(`第 ${input.episodeNo} 集重写失败，请再试`);
  }
  const rewriteInput = {
    title: input.title,
    body,
    genre: input.genre,
    hookStyle: input.hookStyle,
    lookStyle: input.lookStyle,
    seriesTitle: input.seriesTitle,
    corpusText: buildCorpusContext(corpus),
    characterName: input.characterName,
    speakMode: input.speakMode,
    durationSec: input.durationSec,
    cards: locked,
  };
  const [reviewed] = await reviewGeneratedEpisodes(
    [{ ...ep, episode_no: input.episodeNo }],
    {
      speakMode: input.speakMode,
      innerVoice: input.innerVoice,
      characterName: input.characterName,
      durationSec: input.durationSec,
      cards: locked,
      show: isShowStyle(input.hookStyle),
      skipEmotion: true,
      rewriteEpisode: (episode, issues) =>
        rewriteEpisodeToStance(episode, { ...rewriteInput, issues }),
    },
    onEvent,
  );
  const next = reviewed || { ...ep, episode_no: input.episodeNo };
  return directOneEpisodeShots(
    next,
    {
      ...rewriteInput,
      innerVoice: input.innerVoice,
      shotModel: input.shotModel,
      wardrobe: input.wardrobe,
    },
    onEvent,
  );
}

export async function generateNextEpisode(
  input: {
    title: string;
    bodyHtml: string;
    genre: VideoScriptGenre;
    hookStyle?: VideoScriptHookStyle | string;
    lookStyle?: string | null;
    sourceKind?: "article" | "script";
    seriesTitle: string;
    previous: ExistingEpisodeBrief[];
    characterName?: string | string[];
    speakMode?: VideoSpeakMode;
    innerVoice?: InnerVoiceLevel;
    durationSec?: number;
    hasSequel?: boolean;
    stanceNotes?: string;
    premise?: string;
    shotModel?: string;
    wardrobe?: SeriesWardrobeLock | null;
  },
  onEvent?: (event: VideoScriptGenEvent) => void | Promise<void>,
): Promise<GeneratedEpisodeScript> {
  const previous = [...input.previous].sort((a, b) => a.episode_no - b.episode_no);
  const last = previous.at(-1);
  if (!last) {
    throw new Error("还没有上一集，先写出第一集");
  }
  const episodeNo = last.episode_no + 1;
  const body = stripHtml(input.bodyHtml);
  const corpus = selectCorpusForBrief(`${input.title}\n${body.slice(0, 400)}`, {});
  const names = [
    ...new Set(
      (Array.isArray(input.characterName)
        ? input.characterName
        : [input.characterName || ""]
      )
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
  await onEvent?.({
    type: "status",
    message: `正在按第 ${last.episode_no} 集底本写第 ${episodeNo} 集…`,
  });
  const saved = resolveStanceCards(input.stanceNotes || "", names, input.hookStyle);
  const locked =
    saved.length >= names.length
      ? saved
      : await generateStanceCards({
          names,
          hookStyle: input.hookStyle,
          title: input.title,
          body,
          script: episodeScriptBlob(input.existing),
        });
  const [ep] = await generateEpisodeScripts(
    {
      title: input.title,
      body,
      genre: input.genre,
      hookStyle: input.hookStyle,
      lookStyle: input.lookStyle,
      sourceKind: input.sourceKind,
      seriesTitle: input.seriesTitle,
      episodeNos: [episodeNo],
      existing: previous,
      corpusText: buildCorpusContext(corpus),
      characterName: input.characterName,
      speakMode: input.speakMode,
      innerVoice: input.innerVoice,
      durationSec: input.durationSec,
      hasSequel: input.hasSequel,
      seriesEpisodeCount: episodeNo,
      cards: locked,
      allowNewCast: true,
      continueFrom: last.next_hook,
      premise: input.premise,
    },
    onEvent,
  );
  if (!ep) {
    throw new Error(`第 ${episodeNo} 集续写失败，请再试`);
  }
  const rewriteInput = {
    title: input.title,
    body,
    genre: input.genre,
    hookStyle: input.hookStyle,
    lookStyle: input.lookStyle,
    seriesTitle: input.seriesTitle,
    corpusText: buildCorpusContext(corpus),
    characterName: input.characterName,
    speakMode: input.speakMode,
    durationSec: input.durationSec,
    cards: locked,
  };
  const [reviewed] = await reviewGeneratedEpisodes(
    [{ ...ep, episode_no: episodeNo }],
    {
      speakMode: input.speakMode,
      innerVoice: input.innerVoice,
      characterName: input.characterName,
      durationSec: input.durationSec,
      cards: locked,
      show: isShowStyle(input.hookStyle),
      skipEmotion: true,
      rewriteEpisode: (episode, issues) =>
        rewriteEpisodeToStance(episode, { ...rewriteInput, issues }),
    },
    onEvent,
  );
  const next = reviewed || { ...ep, episode_no: episodeNo };
  return directOneEpisodeShots(
    next,
    {
      ...rewriteInput,
      innerVoice: input.innerVoice,
      shotModel: input.shotModel,
      wardrobe: input.wardrobe,
    },
    onEvent,
  );
}

async function directOneEpisodeShots(
  episode: GeneratedEpisodeScript,
  input: {
    hookStyle?: VideoScriptHookStyle | string;
    lookStyle?: string | null;
    seriesTitle: string;
    characterName?: string | string[];
    speakMode?: VideoSpeakMode;
    innerVoice?: InnerVoiceLevel;
    durationSec?: number;
    cards?: StanceCard[];
    shotModel?: string;
    wardrobe?: SeriesWardrobeLock | null;
  },
  onEvent?: (event: VideoScriptGenEvent) => void | Promise<void>,
): Promise<GeneratedEpisodeScript> {
  const [directed] = await directGeneratedEpisodes(
    [episode],
    {
      hookStyle: input.hookStyle,
      lookStyle: input.lookStyle,
      seriesTitle: input.seriesTitle,
      characterName: input.characterName,
      speakMode: input.speakMode,
      innerVoice: input.innerVoice,
      durationSec: input.durationSec,
      cards: input.cards,
      shotModel: input.shotModel,
      wardrobe: input.wardrobe,
    },
    onEvent,
  );
  return directed || episode;
}

export function shotsToJson(shots: VideoShot[]): string {
  return JSON.stringify(shots);
}

export function mergeShotsByIndex(
  base: VideoShot[],
  updates: VideoShot[],
): VideoShot[] {
  const byIndex = new Map(updates.map((shot) => [shot.index, shot]));
  const merged = base.map((shot) => {
    const next = byIndex.get(shot.index);
    return next ? { ...shot, ...next, index: shot.index } : shot;
  });
  const known = new Set(merged.map((shot) => shot.index));
  for (const shot of updates) {
    if (!known.has(shot.index)) merged.push(shot);
  }
  return merged.sort((a, b) => a.index - b.index);
}

export function bindShotSpeakers(
  shots: VideoShot[],
  cast: Array<{ id: string; name: string; voice_id?: string }>,
  speakMode?: VideoSpeakMode,
  narratorVoiceId?: string,
): VideoShot[] {
  return lockEpisodeVoices(shots, {
    cast,
    speakMode,
    narratorVoiceId,
  });
}

export function shotsHaveScenes(shots: VideoShot[]): boolean {
  return shots.length > 0 && shots.every((s) => shotHasKeyframes(s));
}

export function shotsMissingScenes(shots: VideoShot[]): number[] {
  return shots
    .filter((shot) => !shotHasKeyframes(shot))
    .map((shot) => shot.index)
    .sort((a, b) => a - b);
}

export function shotsMissingFrameApproval(shots: VideoShot[]): number[] {
  return shots
    .filter((shot) => shotHasKeyframes(shot) && !shot.framesOk)
    .map((shot) => shot.index)
    .sort((a, b) => a - b);
}

export function shotsHaveClips(shots: VideoShot[]): boolean {
  return shots.length > 0 && shots.every((s) => Boolean(s.clipUrl?.trim()));
}

export function shotsFromJson(raw: string): VideoShot[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeShots(parsed, "", episodePace(90), true);
  } catch {
    return [];
  }
}
