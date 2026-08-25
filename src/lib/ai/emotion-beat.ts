import { chatCompletion } from "@/lib/ai/deepseek";
import {
  normalizeSoundRole,
  resolveInnerVoice,
  shotIsInner,
  type InnerVoiceLevel,
  type ShotJoin,
  type ShotSoundRole,
  type VideoShot,
} from "@/lib/types";

export const SHOT_BEATS = ["钩", "共", "顶", "打", "停"] as const;
export type ShotEmotionBeat = (typeof SHOT_BEATS)[number];

export type ShotEmotionPatch = {
  index?: number;
  beat?: string;
  look?: string;
  visual?: string;
  onScreen?: string;
  soundRole?: ShotSoundRole | "";
};

export const SOUND_ROLE_LABEL: Record<ShotSoundRole, string> = {
  speak: "开口",
  inner: "内心",
  hit: "一声",
  hold: "留白",
};

export const JOIN_LABEL: Record<ShotJoin, string> = {
  continue: "接戏",
  cut: "切镜",
  away: "换场",
};

/** 短剧故事板：钩特写、顶看对手、停切反应、打再切特写。 */
export const STORYBOARD_TEMPLATES: Record<
  ShotEmotionBeat,
  { look: string; camera: string; join: ShotJoin }
> = {
  钩: { look: "特写手、帖或被压的脸", camera: "特写", join: "cut" },
  共: { look: "被压的人", camera: "近景", join: "continue" },
  顶: { look: "说话的人", camera: "近景", join: "cut" },
  停: { look: "挨打的人", camera: "特写", join: "cut" },
  打: { look: "特写手或反打的脸", camera: "特写", join: "cut" },
};

/** 口播故事板：钩是第一句语言，不是先酝酿再开口。 */
export const TALK_STORYBOARD_TEMPLATES: Record<
  ShotEmotionBeat,
  { look: string; camera: string; join: ShotJoin }
> = {
  钩: { look: "说话的人", camera: "近景", join: "cut" },
  共: { look: "说话的人", camera: "近景", join: "continue" },
  顶: { look: "说话的人", camera: "近景", join: "cut" },
  停: { look: "听的人", camera: "特写", join: "cut" },
  打: { look: "说话的人", camera: "近景", join: "cut" },
};

const DRAMA_HOOK_VISUAL = /帖|折子|跪|拍上桌|被压的脸|身体一紧|纸撕|旨已经/;
const TALK_WARMUP_VISUAL =
  /要开口|嘴角微动|酝酿|结束时.{0,16}开口|先盯镜头|冷峻.{0,24}直视镜头/;

const LECTURE_WIDE =
  /端坐|两人.{0,8}(坐|站)|全景|讲解|讲规矩|对面坐|并排坐|竖屏讲解画面/;
const HOOK_CLOSE = /特写|帖|折子|跪|手|脸|眼睛|手机|纸|拍上桌/;
const HIT_ACTION = /拍桌|摔帖|摔上桌|顿住|砸|拍上桌|杯子顿/;

export function inferSoundRole(
  shot: Pick<VideoShot, "soundRole" | "beat" | "delivery" | "voiceover" | "visual">,
): ShotSoundRole {
  const stored = normalizeSoundRole(shot.soundRole);
  if (stored) return stored;
  if (shotIsInner(shot)) return "inner";
  const spoken = spokenForPlay(shot.voiceover);
  const beat = normalizeShotBeat(shot.beat);
  if (spoken.length < 2) {
    if (beat === "钩" || beat === "打" || HIT_ACTION.test(shot.visual || "")) {
      return "hit";
    }
    return "hold";
  }
  if (beat === "停") return "inner";
  return "speak";
}

export function isSilentEmotionShot(shot: Pick<VideoShot, "voiceover" | "beat" | "soundRole" | "delivery">): boolean {
  if (spokenForPlay(shot.voiceover).length >= 2) return false;
  const role = normalizeSoundRole(shot.soundRole);
  const beat = normalizeShotBeat(shot.beat);
  return beat === "停" || role === "hold" || role === "hit";
}

export function shotIsDramaHookVisual(visual?: string): boolean {
  return DRAMA_HOOK_VISUAL.test(visual || "");
}

export function shotHasTalkWarmup(visual?: string): boolean {
  return TALK_WARMUP_VISUAL.test(visual || "");
}

/** 口播开口镜：第一帧就必须出声，不能先冷脸盯镜头。短剧物件特写除外。 */
export function shotSpeaksFromStart(
  shot?: Pick<
    VideoShot,
    "index" | "visual" | "voiceover" | "soundRole" | "delivery" | "beat"
  > | null,
): boolean {
  if (!shot) return false;
  if (shotIsInner(shot)) return false;
  if (inferSoundRole(shot) !== "speak") return false;
  if (spokenForPlay(shot.voiceover).length < 2) return false;
  if (shotIsDramaHookVisual(shot.visual)) return false;
  if (shot.index === 1) return true;
  return shotHasTalkWarmup(shot.visual);
}

export function ensureTalkHookVisual(visual: string): string {
  let text = String(visual || "").trim();
  text = text
    .replace(/结束时[^。]{0,32}(要开口|开口|嘴角微动)[^。]*/g, "")
    .replace(/嘴角微动[，。,]?/g, "")
    .replace(/要开口[，。]?/g, "")
    .replace(/[。.]{2,}/g, "。")
    .replace(/^[。\s]+|[。\s]+$/g, "");
  if (/已经开口|正在说|张嘴在说|已经张嘴/.test(text)) return text.slice(0, 240);
  return `${text}${text ? "。" : ""}第一帧已经张嘴在说，不要先盯镜头酝酿。`.slice(
    0,
    240,
  );
}

function grammarIsShow(
  shots: VideoShot[],
  show?: boolean,
): boolean {
  if (show === true) return true;
  if (show === false) return false;
  const visual = shots[0]?.visual || "";
  if (shotIsDramaHookVisual(visual) || LECTURE_WIDE.test(visual)) return true;
  if (spokenForPlay(shots[0]?.voiceover).length >= 2) return false;
  return true;
}

function needsHookCloseup(shot: Pick<VideoShot, "visual" | "look" | "camera">): boolean {
  const v = `${shot.visual || ""} ${shot.look || ""} ${shot.camera || ""}`;
  if (HOOK_CLOSE.test(v)) return false;
  return !shot.visual?.trim() || LECTURE_WIDE.test(v);
}

function hookCloseupVisual(shot: VideoShot): string {
  const prop = shot.props?.[0];
  return prop
    ? `特写${prop}已经拍上桌，只看见被压的半张脸和手，不要两人端坐全景。`
    : "特写帖或手机已经拍上桌，跪着的手、被压的半张脸。不要两人端坐讲规矩的全景。";
}

function holdReactionShot(_after: VideoShot, index: number, seconds: number): VideoShot {
  return {
    index,
    seconds: Math.max(4, Math.min(6, seconds || 4)),
    visual:
      "反应镜：切到被压的人，闭嘴，眼睛和喉结还没缓过来。结束停在这张脸上。",
    onScreen: "",
    voiceover: "",
    imagePrompt: "竖屏 9:16，反应镜特写被压的脸，闭嘴，无水印无 logo 无网址",
    beat: "停",
    look: "挨打的人",
    camera: "特写",
    join: "cut",
    soundRole: "hold",
  };
}

function bakeReactionIntoVisual(visual: string): string {
  const text = String(visual || "").trim();
  if (/被压的脸|反应镜|闭嘴停/.test(text)) return text;
  return `${text}${text ? "。" : ""}这一镜结束切到被压的脸，闭嘴停住。`.slice(0, 240);
}

export function weaveSilentEmotionShots(
  original: VideoShot[],
  spoken: VideoShot[],
): VideoShot[] {
  const silents = original.filter((shot) => isSilentEmotionShot(shot));
  if (!silents.length) return spoken;
  const out = [...spoken];
  for (const hold of silents) {
    if (out.some((row) => isSilentEmotionShot(row) && row.visual === hold.visual)) {
      continue;
    }
    const prevSpoken = [...original]
      .filter((row) => row.index < hold.index && !isSilentEmotionShot(row))
      .at(-1);
    const after = prevSpoken
      ? out.findIndex(
          (row) =>
            row.index === prevSpoken.index ||
            spokenForPlay(row.voiceover) === spokenForPlay(prevSpoken.voiceover),
        )
      : -1;
    out.splice(after >= 0 ? after + 1 : out.length, 0, hold);
  }
  return out.map((shot, i) => ({ ...shot, index: i + 1 }));
}

export function applyShotEmotionGrammar(
  shots: VideoShot[],
  opts?: {
    insert?: boolean;
    mutateVisual?: boolean;
    shotMax?: number;
    show?: boolean;
  },
): VideoShot[] {
  if (shots.length === 0) return shots;
  const insert = opts?.insert === true;
  const mutateVisual = opts?.mutateVisual === true;
  const shotMax = Math.max(1, Number(opts?.shotMax) || 32);
  const show = grammarIsShow(shots, opts?.show);
  const plates = show ? STORYBOARD_TEMPLATES : TALK_STORYBOARD_TEMPLATES;
  const next = shots.map((shot) => ({ ...shot }));

  if (!next[0].beat) next[0].beat = "钩";
  else next[0].beat = normalizeShotBeat(next[0].beat) || "钩";
  if (show && mutateVisual && needsHookCloseup(next[0])) {
    next[0].visual = hookCloseupVisual(next[0]);
    next[0].look = next[0].look || "特写手、帖或被压的脸";
    next[0].camera = next[0].camera || "特写";
  }
  if (
    !show &&
    mutateVisual &&
    spokenForPlay(next[0].voiceover).length >= 2 &&
    !shotIsInner(next[0])
  ) {
    next[0].visual = ensureTalkHookVisual(next[0].visual);
    next[0].look = next[0].look || "说话的人";
    next[0].camera = next[0].camera || "近景";
    next[0].soundRole = "speak";
    next[0].plate = {
      size: "近景",
      angle: next[0].plate?.angle || "平视",
      framing: next[0].plate?.framing || "说话的人占画，嘴已经张开",
      light: next[0].plate?.light || "面光清楚",
      grade: next[0].plate?.grade || "跟本剧画风",
      motion: "已在说",
    };
  }

  const out: VideoShot[] = [];
  for (let i = 0; i < next.length; i += 1) {
    const shot = next[i];
    out.push(shot);
    if (!show) continue;
    const beat = normalizeShotBeat(shot.beat);
    if (beat !== "顶") continue;
    const following = next[i + 1];
    const followBeat = following ? normalizeShotBeat(following.beat) : "";
    if (
      following &&
      (followBeat === "停" || looksLikeReactionShot(following))
    ) {
      following.beat = "停";
      following.look = following.look || "挨打的人";
      continue;
    }
    const remaining = next.length - i - 1;
    if (
      insert &&
      followBeat !== "停" &&
      out.length + 1 + remaining <= shotMax
    ) {
      out.push(holdReactionShot(shot, out.length + 1, shot.seconds));
      continue;
    }
    if (mutateVisual) {
      shot.visual = bakeReactionIntoVisual(shot.visual);
      shot.look = shot.look || "先对手后挨打的人";
    }
  }

  let speakStreak = 0;
  let lastSpeaker = "";
  if (show) {
    for (const shot of out) {
      const speaker = String(shot.speaker || "").trim();
      const talking =
        spokenForPlay(shot.voiceover).length >= 2 && !shotIsInner(shot);
      if (talking && speaker && speaker === lastSpeaker) {
        speakStreak += 1;
        if (speakStreak >= 3 && normalizeShotBeat(shot.beat) !== "打") {
          shot.look = shot.look || "挨打的人";
          shot.camera = shot.camera || "特写";
        }
      } else {
        speakStreak = talking ? 1 : 0;
        lastSpeaker = talking ? speaker : "";
      }
    }
  }

  return out.map((shot, i) => {
    const beat = normalizeShotBeat(shot.beat) || shot.beat;
    const prev = i > 0 ? out[i - 1] : undefined;
    const plate =
      beat && beat in plates
        ? plates[beat as ShotEmotionBeat]
        : null;
    let look = shot.look;
    let camera = shot.camera;
    let join = shot.join;
    if (plate && (mutateVisual || insert || !look || !camera || !join)) {
      if (!look) look = plate.look;
      if (!camera || camera === "固定") camera = plate.camera;
      if (!join) join = plate.join;
    }
    if (prev?.look && look && prev.look !== look) join = "cut";
    let delivery = shot.delivery;
    if (beat === "停" && spokenForPlay(shot.voiceover).length >= 2) {
      delivery = "inner";
    }
    const soundRole =
      inferSoundRole({ ...shot, beat, delivery, soundRole: shot.soundRole }) ||
      inferSoundRole({ ...shot, beat, delivery, soundRole: undefined });
    if (soundRole === "inner") delivery = "inner";
    return {
      ...shot,
      index: i + 1,
      beat,
      look,
      camera,
      join,
      delivery,
      soundRole,
    };
  });
}

export function normalizeShotBeat(raw: unknown): ShotEmotionBeat | "" {
  const t = String(raw || "").trim();
  if ((SHOT_BEATS as readonly string[]).includes(t)) {
    return t as ShotEmotionBeat;
  }
  if (/钩|开场|扎人|身体一紧/.test(t)) return "钩";
  if (/共|代入|共鸣|这就是我/.test(t)) return "共";
  if (/顶|对峙|压他|对手/.test(t)) return "顶";
  if (/打|反转|打脸|爽/.test(t)) return "打";
  if (/停|留白|反应/.test(t)) return "停";
  return "";
}

export function innerVoiceWriteRules(level?: InnerVoiceLevel): string {
  const lv = resolveInnerVoice(level);
  if (lv === "off") {
    return "不要写内心独白。对手说完可以切反应镜闭嘴，但准稿不要出现「角色名（内心）：」。";
  }
  const mark = lv === "high" ? "炸" : lv === "low" ? "压" : "震";
  const feel =
    lv === "high"
      ? "短、狠、夸张，像「卧槽」「签了就是死」这种心里炸开的一句，不要文绉绉，不要咽回去的气声。"
      : lv === "low"
        ? "咬着牙没骂出声，短，有火，不要抒情。"
        : "心里一震的一句，比对白更冲，不要小声嘀咕。";
  return `必须开内心独白（强烈度：${mark}）。对手刚压完、甩完、踩完一句，立刻切被压的人，写成「角色名（内心·${mark}）：」一句没说出口的话，调用观众替他急、替他骂。每集 1–2 句，不要整集内心。独白要${feel} 内心镜 delivery=inner，innerLevel=${lv}，画面闭嘴，花字可以就是这句心里话。`;
}

export function innerSpeechTone(
  level?: Exclude<InnerVoiceLevel, "off"> | "" | null,
): string {
  if (level === "low") {
    return "这是压着的心里话。近、实、咬字清楚，有火，语速偏快，不要气声，不要温柔，不要播音，不要念稿。";
  }
  if (level === "mid") {
    return "这是心里一震的一句。清楚、有火、比对白更夸张，音量够，语速快，不要小声嘀咕，不要播音，不要念稿。";
  }
  return "这是心里炸出来的一句。夸张、短、狠，音量拉满，语速快，像差点骂出声。不要小声，不要气声，不要温柔，不要播音，不要念稿。";
}

export function innerSpeechSpeed(
  level?: Exclude<InnerVoiceLevel, "off"> | "" | null,
): number {
  if (level === "low") return 1.16;
  if (level === "mid") return 1.24;
  return 1.32;
}

/** Seedance 自己出内心声：闭嘴，画外那一句要有火。 */
export function innerNativeVoiceLine(input: {
  speaker?: string;
  voiceover?: string;
  level?: Exclude<InnerVoiceLevel, "off"> | "" | null;
}): string {
  const line = spokenForPlay(input.voiceover);
  const who = String(input.speaker || "他").replace(/\s+/g, "") || "他";
  const mark = input.level === "low" ? "压" : input.level === "mid" ? "震" : "炸";
  const punch =
    mark === "炸"
      ? "像短剧里心里骂出来的那一下，火要够，音量拉满，让观众替他骂。"
      : mark === "压"
        ? "压着，但每个字要砸到，不要虚。"
        : "心里一震，要比对白更冲，不要嘀咕。";
  return [
    `这一镜是「${who}」的内心独白，不是对白，不是旁白播报。`,
    "画面里所有人必须闭嘴，嘴唇不要动，不要对口型，不要把这句从嘴里念出来。",
    line
      ? `声音由模型自己生成：画外心里的一声，只说「${line.slice(0, 40)}」，一个字都不要加。`
      : "声音由模型自己生成：画外心里的一声。",
    innerSpeechTone(input.level),
    punch,
    "不要配乐，不要BGM，不要殿堂回声，不要气声念稿。",
  ].join("");
}

export function emotionRules(show: boolean, innerVoice?: InnerVoiceLevel): string {
  if (show) {
    return `调用观众情绪（短剧共用，具体怒/冤/怕/甜/爽只看本集发动机，不要串题）：
观众是第三个人。每一拍要让他替人着急，不是听懂一个知识点，也不是看懂案情。
整集先锁：观众替谁、这一下是哪种情绪、开场哪一下扎人、收在气还是爽。
节拍：钩（身体一紧）→ 共（这就是我）→ 顶（对手压他）→ 打/停（花字替观众说话，或反应镜闭嘴）。
对白按人设卡，但每句还要推这根情绪线，必须带口气：压、顶、冷、急、咽。禁止把冲突写成把事说清楚，禁止上课点名「你是不是也…」。
第一镜必须先让观众站队。禁止开场只交代案情，禁止「怎么回事、你解释一下、客户投诉了」当钩。
禁止开场用「你可明白 / 你可知 / 总要有个规矩 / 祖制如此」把规矩讲清楚。第一句必须是帖已经拍上桌、人已经跪着接或拒。
特写必须是情绪物件：这张纸/这道旨为什么让观众火或疼。禁止开场只拍物件再慢慢拉远介绍谁在场。
第一镜禁止两人端坐讲规矩的全景，必须特写帖、跪着的手或被压的脸。
分镜不是人人张嘴：
- beat 必填：钩|共|顶|打|停
- look 必填：镜头看谁（说话的人 / 挨打的人 / 特写手、折子、眼睛）
- 骂完必须有反应镜：切到被骂的脸，这一镜可以少说话或闭嘴
- ${innerVoiceWriteRules(innerVoice)}
- visual 只写人的动作、脸、手里的东西。禁止每镜写「观众先替/观众先松口气/观众心又提起来」
- onScreen 是没说出口的那句，替观众说话，禁止复述对白`;
  }
  return `调用观众情绪（口播，不是短剧）：
钩是第一句语言，不是画面酝酿。开播第一帧就必须出声，第一句停住拇指。
禁止第一镜先冷脸盯镜头、嘴角微动、结束时才开口。禁止帖拍上桌、跪、身体一紧当口播钩。
共鸣用观众自己做过的错法演出来，不要上课点名「你是不是也踩过这个坑」。
花字短狠，是观众心里那一句，不要复述口播。
分镜写 look：默认看说话的人。不要插不说话的反应停。`;
}

const SPEAKER_PREFIX = /^[\u4e00-\u9fffA-Za-z·]{1,8}[：:]/;
const STAGE_DIR = /[（(][^）)]{0,20}[）)]/g;
const STAGE_HINT = /冷|顶|怒|压|盯|笑|沉|慢|拍|低|咽|急|狠|停|跪/;
const LECTURE_ASK =
  /你可明白|你可知|你可懂|你明白了吗|总要有个.{0,8}规矩|祖制如此|历来.{0,8}皆要/;

const SPEECH_PUNCH =
  "近讲，口齿清楚，胸腔有力，齿音在，音量够，不要虚、不要气声、不要远处喊、不要殿里回声。";
const SPEECH_COLD =
  "近、实、有轻重，该咬的字咬住，像当面甩一句，不要拖腔，不要播音，不要殿里回声。";

export type SpeechPerformanceInput = {
  beat?: string;
  voiceover?: string;
  speaker?: string;
  role?: string;
  stance?: string;
  delivery?: string;
  innerLevel?: string;
  talk?: boolean;
};

export function isLectureAskLine(voiceover?: string): boolean {
  return LECTURE_ASK.test(spokenForPlay(voiceover));
}

/** 配音/出片用：去掉署名和（冷）（顶）这类演法括号，括号不要念出声。 */
export function spokenForPlay(voiceover?: string): string {
  return stripStageDirections(String(voiceover || "").replace(SPEAKER_PREFIX, "").trim());
}

export function stripStageDirections(text: string): string {
  return String(text || "")
    .replace(STAGE_DIR, (chunk) => (STAGE_HINT.test(chunk) ? "" : chunk))
    .replace(/\s+/g, " ")
    .replace(/^[，、；:：\s]+/, "")
    .trim();
}

export function stageDirectionHints(voiceover?: string): string[] {
  const raw = String(voiceover || "").replace(SPEAKER_PREFIX, "");
  return [...raw.matchAll(STAGE_DIR)]
    .map((row) => row[0].slice(1, -1).replace(/\s+/g, " ").trim())
    .filter((hint) => hint && STAGE_HINT.test(hint))
    .slice(0, 3);
}

function spokenLine(voiceover?: string): string {
  return spokenForPlay(voiceover);
}

function lineMarks(line: string, voiceover?: string): string[] {
  const marks: string[] = [];
  const hints = stageDirectionHints(voiceover);
  if (hints.length) marks.push(`括号里的演法要做进口气，不要念出来：${hints.join("，")}`);
  if (isLectureAskLine(line)) {
    marks.push("这是拿规矩压人，不是讲课，问号要冷、要堵，不要客客气气问懂不懂");
  }
  if (/——|—$/.test(line)) marks.push("说到破折号必须掐住，气还在，后半句不要补完");
  if (/[？?]/.test(line) && !isLectureAskLine(line)) {
    marks.push("问号要顶上去，不要客客气气收尾");
  }
  if (/[！!]/.test(line)) marks.push("感叹要短促砸下去，不要拉长");
  if (line.length <= 8) marks.push("整句短，一口气，不要拆成讲解");
  if (/你胡说|怎么可能|不可能|凭什么/.test(line)) marks.push("火在第一个重音上");
  return marks;
}

function presenceFor(beat: ShotEmotionBeat | "", line: string): string {
  if (beat === "停" || beat === "顶" || isLectureAskLine(line)) return SPEECH_COLD;
  return SPEECH_PUNCH;
}

/** 模型自己出声时用：只要情绪，不要把声音锁成近讲播音。 */
export function speechActLine(input: {
  beat?: string;
  voiceover?: string;
  talk?: boolean;
}): string {
  const beat = normalizeShotBeat(input.beat);
  const line = spokenForPlay(input.voiceover);
  const asked = /[？?]/.test(line);
  const cut = /——|—$/.test(line);
  const lecture = isLectureAskLine(line);
  if (lecture) return "拿规矩压人，冷、短，字有轻重，语速快，不要拖腔，不要讲解，不要念稿。";
  if (beat === "钩") {
    return input.talk
      ? "当面第一句，像刚跟人说话，有轻重，语速快，不要播音念稿，不要一字一顿读稿，不要短剧开场腔。"
      : "第一句就扎人，短、狠，语速快，像短剧开场，不要念稿。";
  }
  if (beat === "共") return "压着说，像咽回去又忍不住，语速偏快，不要匀速读。";
  if (beat === "顶") {
    if (cut) return "质问到一半被打断，火还在，语速快，不要把后半句补完，不要念稿。";
    return asked ? "质问，带着火，语速快，不要念稿。" : "压人，冷、硬，语速快，不要拖。";
  }
  if (beat === "打") {
    return asked || /[！!]/.test(line)
      ? "打回来，短促，语速快，像短剧反打。"
      : "反转落地，快砸，不要慢慢念结论。";
  }
  if (beat === "停") return "压低，快收住，像没说完，不要慢慢念完。";
  if (cut) return "说到一半被打断，语速快。";
  if (asked) return "质问，带着火，语速快。";
  return "像当面吵，有轻重，语速快，像短剧对口，不要念稿。";
}

/** 给配音和出片用：这一镜该用什么口气，不要平念。 */
export function speechToneLine(input: {
  beat?: string;
  voiceover?: string;
  talk?: boolean;
}): string {
  const beat = normalizeShotBeat(input.beat);
  const line = spokenForPlay(input.voiceover);
  const asked = /[？?]/.test(line);
  const yelled = /[！!]/.test(line);
  const presence = presenceFor(beat, line);
  if (isLectureAskLine(line)) {
    return `用拿规矩压人的口气，冷、短，语速快，像当面甩一句，不要拖腔，不要讲解，不要念稿。${presence}`;
  }
  if (beat === "钩") {
    return input.talk
      ? `像抖音口播第一句，当面说，有轻重，语速快。不要播音腔，不要匀速念稿，不要短剧揭穿腔。${presence}`
      : `用当众揭穿、让人身体一紧的语气，短、狠，语速快，像抖音第一句，不要平铺直叙，不要念稿。${presence}`;
  }
  if (beat === "共") {
    return `用自己也挨过这一下的口气，压着说，语速偏快，像咽回去又忍不住，不要讲解，不要匀速读。${presence}`;
  }
  if (beat === "顶") {
    return asked
      ? `用顶回去的质问，带着火，语速快，不要客客气气请教，不要念稿。${presence}`
      : `用压人的口气，冷、硬，一句砸死，语速快，不要商量，不要念稿。${presence}`;
  }
  if (beat === "打") {
    return yelled
      ? `用打回来的痛快，短促，语速快，带着赢了那一下，不要念结论。${presence}`
      : `用反转落地的冷笑，快砸，不要播音，不要念稿。${presence}`;
  }
  if (beat === "停") {
    return "声音压低，快收住，像没说完、咽回去，字要实、近、听得清，不要慢慢念完，不要气声虚掉。";
  }
  if (asked) return `用质问，带着火，语速快，不要客客气气，不要念稿。${presence}`;
  if (yelled) return `带着情绪说完，短、狠，语速快，不要念稿。${presence}`;
  return `像当面说，有轻重，语速快，像抖音口播/短剧对口，该急就急，不要播音腔，不要匀速念稿。${presence}`;
}

/** 两人同框时，模型容易把一句对白拆给两张嘴。出片必须锁死说话的人。 */
export function shotSpeakerLockLine(input: {
  speaker?: string;
  voiceover?: string;
}): string {
  const who = String(input.speaker || "").trim();
  const line = spokenForPlay(input.voiceover);
  if (!line) return "这一镜不要说话，不要念提示词。画面里所有人闭嘴。";
  if (!who || who === "旁白") {
    return `这一镜只说参考音频里的这一句，对白用引号锁死：「${line.slice(0, 160)}」。不要加开场白，不要复述上一镜，不要把提示词念出声。`;
  }
  return `这一镜只有「${who}」张嘴，整句由他一个人说完，对白用引号锁死：「${line.slice(0, 160)}」。画面里其他人必须闭嘴、不要对口型、不要接话、不要把这句拆成两个人说。`;
}

/** 抖音/短剧语速：中文大约每秒 6 字，不要按念稿估时长。 */
export const SPEECH_CHARS_PER_SEC = 6.2;

export function speechToneSpeed(beat?: string): number {
  const b = normalizeShotBeat(beat);
  if (b === "停") return 1.14;
  if (b === "共") return 1.2;
  if (b === "钩" || b === "打") return 1.3;
  return 1.24;
}

/** 对白配音用：像短剧当面说，不要匀速慢念。 */
export function speechActSpeed(beat?: string, voiceover?: string): number {
  const b = normalizeShotBeat(beat);
  if (b === "停") return 1.12;
  if (b === "共") return 1.18;
  if (isLectureAskLine(voiceover) || b === "顶") return 1.24;
  if (b === "钩" || b === "打") return 1.3;
  return 1.22;
}

/** 写进 Seed TTS 正文的短演法标签，模型不当字念。 */
export function speechActTag(input: { beat?: string; voiceover?: string }): string {
  const act = speechActLine(input)
    .replace(/[。．.！!？?]/g, "")
    .replace(/不要[^，,]{0,16}/g, "")
    .replace(/[，,、\s]+/g, "，")
    .replace(/^，|，$/g, "")
    .slice(0, 18);
  return act || "冷，压着说";
}

export function actingSpeechText(input: {
  beat?: string;
  voiceover?: string;
}): string {
  return spokenForPlay(input.voiceover);
}

/** 给先出的音频写演法：按这句演，不要念口播。 */
export function speechPerformance(
  input: SpeechPerformanceInput,
  act = speechActLine(input),
): string {
  const line = spokenLine(input.voiceover);
  const who = String(input.speaker || "").trim();
  const inner = shotIsInner({
    delivery: input.delivery === "inner" ? "inner" : undefined,
    speaker: input.speaker,
    voiceover: input.voiceover,
  });
  const whoLine = inner
    ? `你是「${who || "他"}」心里炸开的那一句，不是旁白，也不要对着镜头讲课。`
    : who && who !== "旁白"
    ? `你是「${who}」${input.role ? `，${input.role}` : ""}，对着对面的人说，不是旁白。`
    : "对着听的人说，像当面讲，不是播音。";
  return [
    inner
      ? innerSpeechTone(
          input.innerLevel === "low" ||
            input.innerLevel === "mid" ||
            input.innerLevel === "high"
            ? input.innerLevel
            : "high",
        )
      : input.talk
        ? "你在当面讲，不是念稿，不是播音，不是短剧开场腔。"
        : "你在演戏，不是念旁白，也不是抖音口播。",
    whoLine,
    input.stance ? `立场：${input.stance}` : "",
    `演法：${act}`,
    ...lineMarks(line, input.voiceover),
    line ? `只说这一句，一个字都不要加：「${line.slice(0, 160)}」` : "",
    "要有轻重和气口，像当面说话，不要拖腔，不要每个字一样长，不要播音腔。",
  ]
    .filter(Boolean)
    .join("");
}

/** 按这一句写演法；模型写不出就用规则演法，不挡配音。 */
export async function directSpeechPerformance(
  input: SpeechPerformanceInput,
): Promise<string> {
  const fallback = speechPerformance(input);
  const line = spokenLine(input.voiceover);
  if (!line) return fallback;
  const who = String(input.speaker || "").trim();
  try {
    const raw = await chatCompletion(
      [
        {
          role: "system",
          content:
            "你给漫剧对白写配音演法。只写怎么说，不改原话，不解释，不超过40字。要有重音、气口、火或咽。",
        },
        {
          role: "user",
          content: [
            who ? `角色：${who}` : "",
            input.role ? `身份：${input.role}` : "",
            input.stance ? `立场：${input.stance}` : "",
            `节拍：${normalizeShotBeat(input.beat) || "对白"}`,
            `原话：${line}`,
            "用一句话写演法：重音在哪、哪里停、火还是咽。",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      { temperature: 0.4, maxTokens: 80, timeoutMs: 8_000 },
    );
    const act = raw.replace(/\s+/g, " ").replace(/^["「]|["」]$/g, "").trim().slice(0, 80);
    if (act.length < 6) return fallback;
    return speechPerformance(input, act);
  } catch {
    return fallback;
  }
}

export function emotionFaceLine(
  beat?: string,
  look?: string,
  inner = false,
  extras?: { feel?: string; hookHit?: string; landing?: boolean; talk?: boolean },
): string {
  const b = normalizeShotBeat(beat);
  const who = String(look || "").trim();
  const feel = String(extras?.feel || "").trim();
  const hookHit = String(extras?.hookHit || "").trim();
  const lookLine = who ? `这一镜镜头必须看清：${who}。` : "";
  const face =
    feel === "怒"
      ? "眉心拧着，牙关咬死，鼻翼绷紧"
      : feel === "怕"
        ? "眼睛不敢抬，喉结滚一下，肩膀缩"
        : feel === "甜"
          ? "耳根红，嘴角压住又漏出来"
          : feel === "爽"
            ? "眼神先冷后亮，下巴微抬"
            : extras?.talk
              ? "有口气，眉眼带着这句话，不要冷脸摆拍"
              : "半张脸绷着，眼眶压着火";
  if (inner) {
    return `${lookLine}这是内心独白。人必须闭嘴，${face}，靠眼睛、手、停顿，不要对口型，不要张嘴念。`;
  }
  if (b === "钩" && extras?.talk) {
    return `${lookLine}这是口播钩。第一帧嘴已经张开，正在说第一句。${hookHit ? `这句话的劲：${hookHit}。` : ""}脸是${face}。禁止先盯镜头酝酿，禁止「要开口」，禁止闭嘴冷脸。`;
  }
  if (b === "钩") {
    return `${lookLine}这是钩。${hookHit ? `必须看见：${hookHit}。` : "特写情绪物件或被压的身体一紧。"}脸是${face}。禁止两人端坐全景，禁止聊天脸。`;
  }
  if (b === "打") {
    return `${lookLine}这是打。结束帧手或物件必须已经落下（拍桌、纸碎、帖甩上）。脸是${face}。不要只张嘴。`;
  }
  if (b === "共") {
    return `${lookLine}这是共。停在替的人身上，微动作：手攥着、喉结滚、眼睛不敢抬。脸是${face}。不要切去讲道理的人。`;
  }
  if (b === "停") {
    return `${lookLine}这是反应镜。闭嘴，${face}，不换调度。不要画成对口型人头。`;
  }
  if (b === "顶") {
    return `${lookLine}这是压人拍。压的人冷，被压的人绷，${face}。禁止端坐讲解脸，禁止自然聊天。`;
  }
  if (extras?.landing) {
    return `${lookLine}收在这一下。脸是${face}，停在最高点，不要另起动作。`;
  }
  return lookLine || `表情按这一镜来：${face}。禁止端坐讲解，禁止自然聊天脸。`;
}

export function scrubShotFlowers(shots: VideoShot[]): VideoShot[] {
  return shots.map((shot) => {
    if (!flowerRepeatsLine(shot.onScreen || "", shot.voiceover || "")) return shot;
    return { ...shot, onScreen: "" };
  });
}

function compactPlayText(text: string): string {
  return spokenForPlay(text).replace(/[\s，,。.!！？?、：:；;…—\-]/g, "");
}

export function flowerRepeatsLine(onScreen: string, voiceover: string): boolean {
  const flower = compactPlayText(onScreen);
  const line = compactPlayText(voiceover);
  if (flower.length < 2 || line.length < 2) return false;
  return line.startsWith(flower) || line.includes(flower);
}

export function looksLikeReactionShot(shot: Pick<VideoShot, "beat" | "look" | "visual">): boolean {
  const beat = normalizeShotBeat(shot.beat);
  if (beat === "停" || beat === "共") return true;
  return /挨打|被骂|反应|特写|愣住|咽回去|手|眼睛|折子/.test(
    `${shot.look || ""} ${shot.visual || ""}`,
  );
}

export function applyShotEmotionPatches(
  shots: VideoShot[],
  patches: ShotEmotionPatch[],
): VideoShot[] {
  if (!patches.length) return shots;
  return shots.map((shot) => {
    const patch = patches.find((row) => Number(row.index) === shot.index);
    if (!patch) return shot;
    const next: VideoShot = { ...shot };
    const beat = normalizeShotBeat(patch.beat);
    if (beat) next.beat = beat;
    const look = String(patch.look || "").replace(/\s+/g, " ").trim().slice(0, 24);
    if (look) next.look = look;
    const soundRole = normalizeSoundRole(patch.soundRole);
    if (soundRole) next.soundRole = soundRole;
    const visual = String(patch.visual || "").replace(/\s+/g, " ").trim();
    if (visual) next.visual = visual.slice(0, 240);
    const onScreen = String(patch.onScreen || "").replace(/\s+/g, " ").trim();
    if (onScreen) next.onScreen = onScreen.slice(0, 36);
    return next;
  });
}

export function parseShotCopyPatch(raw: string): ShotEmotionPatch | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const visual = typeof o.visual === "string" ? o.visual.trim() : "";
    const look = typeof o.look === "string" ? o.look.trim() : "";
    const beat = normalizeShotBeat(o.beat);
    const onScreen =
      typeof o.onScreen === "string"
        ? o.onScreen.trim()
        : typeof o.on_screen === "string"
          ? o.on_screen.trim()
          : "";
    if (!visual && !look && !beat && !onScreen) return null;
    return { beat, look, visual, onScreen };
  } catch {
    return null;
  }
}

export async function rewriteShotCopy(input: {
  shot: VideoShot;
  intent: "visual" | "emotion";
  prev?: VideoShot;
  next?: VideoShot;
  title?: string;
  hook?: string;
}): Promise<ShotEmotionPatch> {
  const shot = input.shot;
  const emotion = input.intent === "emotion";
  const raw = await chatCompletion(
    [
      {
        role: "system",
        content: emotion
          ? `你给这一镜加情绪。只改 beat/look/visual/onScreen，对白一字不动。
beat 只能是 钩|共|顶|打|停。
visual 写镜头怎么切、人的脸/手/物件怎么动，把情绪做进身体，禁止写「观众先替谁」。
若对白是「你可明白/祖制/规矩」这类讲课句，画面必须是帖已经拍上桌、跪着的手、被压的脸，禁止两人端坐把规矩说清楚。
look 写镜头看谁（说话的人 / 挨打的人 / 特写手、折子、眼睛）。
onScreen 是没说出口的那句，禁止复述对白。
只输出 JSON：{"beat":"钩","look":"…","visual":"…","onScreen":"…"}`
          : `你重写这一镜的画面 visual。对白一字不动。
把镜头写具体：从哪切到哪，手/眼/折子怎么动。不要写观众先替谁。
可顺手补 look。不要改对白，不要另起剧情。
只输出 JSON：{"visual":"…","look":"…"}`,
      },
      {
        role: "user",
        content: [
          input.title ? `集名：${input.title}` : "",
          input.hook ? `钩子：${input.hook}` : "",
          input.prev ? `上一镜画面：${input.prev.visual}` : "",
          `这一镜 beat=${shot.beat || "无"} look=${shot.look || "无"} 花字=${shot.onScreen || "无"}`,
          `对白（不要改）：${shot.voiceover || "无"}`,
          `现画面：${shot.visual || "无"}`,
          input.next ? `下一镜画面：${input.next.visual}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    {
      model: "deepseek-chat",
      temperature: 0.35,
      maxTokens: 500,
      timeoutMs: 45_000,
    },
  );
  const patch = parseShotCopyPatch(raw);
  if (!patch) throw new Error(emotion ? "这一镜情绪没写下来，请再试" : "这一镜画面没写下来，请再试");
  return { ...patch, index: shot.index };
}
