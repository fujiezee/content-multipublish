import {
  activeScriptLlmId,
  streamScriptLlm,
  withScriptLlm,
} from "@/lib/ai/script-llm";
import {
  applyShotEmotionGrammar,
  flowerRepeatsLine,
  inferSoundRole,
  innerVoiceWriteRules,
  normalizeShotBeat,
  scrubShotFlowers,
  SPEECH_CHARS_PER_SEC,
  spokenForPlay,
  type ShotEmotionBeat,
} from "@/lib/ai/emotion-beat";
import {
  inferShotPlate,
  normalizeShotMove,
  parseShotPlate,
  talkHookPlate,
} from "@/lib/ai/shot-plate";
import { resolveLookStyle } from "@/lib/ai/look-styles";
import { stripPhotoLook } from "@/lib/ai/manhua-look";
import {
  formatStanceCards,
  type StanceCard,
} from "@/lib/ai/stance-card";
import {
  normalizeDirectorClose,
  normalizeDirectorFeel,
  seriesWardrobeLine,
  type SeriesWardrobeLock,
  type ShotAgentLock,
} from "@/lib/ai/director-lock";
import { MAX_IMAGE_REFS_ARK } from "@/lib/ai/image-gen-models";
import {
  episodePace,
  isShowStyle,
  type EpisodeDurationSec,
  type VideoScriptHookStyle,
} from "@/lib/ai/video-script-styles";
import { shotRefLoad } from "@/lib/ai/video-scenes";
import {
  normalizeShotJoin,
  normalizeSoundRole,
  resolveInnerVoice,
  stripInnerTag,
  type InnerVoiceLevel,
  type ShotJoin,
  type VideoShot,
  type VideoSpeakMode,
} from "@/lib/types";

export type { ShotAgentLock };

export type ShotAgentEpisode = {
  episode_no: number;
  title: string;
  hook: string;
  voiceover: string;
  on_screen?: string;
  recap?: string;
  next_hook?: string;
  duration_sec?: number;
  shots: VideoShot[];
  director?: ShotAgentLock;
};

export type ShotAgentEvent =
  | { type: "status"; message: string }
  | { type: "meta"; model: string };

const CAMERAS = ["特写", "近景", "中景", "远景", "推镜", "拉镜", "横移", "固定", "切镜"];
const MODE_RE = /^【(?:对话|旁白)】\s*/;
const SPEAKER_RE =
  /^([\u4e00-\u9fffA-Za-z·]{1,8}(?:[（(](?:内心|独白|心里)[）)])?)[：:]/;
const SPEAKER_FIND =
  /[\u4e00-\u9fffA-Za-z·]{1,8}(?:[（(](?:内心|独白|心里)[）)])?[：:]/g;
const VISUAL_MAX = 280;

function compactPlay(text: string): string {
  return spokenForPlay(text).replace(/[\s，,。.!！？?、：:；;…—\-「」""]/g, "");
}

function labeledTurns(voiceover: string): string[] {
  const clean = String(voiceover || "").replace(MODE_RE, "").trim();
  if (!clean) return [];
  const indexes: number[] = [];
  SPEAKER_FIND.lastIndex = 0;
  for (;;) {
    const match = SPEAKER_FIND.exec(clean);
    if (!match) break;
    const prev = clean[match.index - 1] || "\n";
    if (match.index === 0 || /[\n。！？…\s]/.test(prev)) {
      indexes.push(match.index);
    }
  }
  if (indexes.length === 0) return [clean];
  return indexes
    .map((start, i) => clean.slice(start, indexes[i + 1]).trim())
    .filter(Boolean);
}

function speakerOf(line: string): string {
  return stripInnerTag(line.match(SPEAKER_RE)?.[1] || "");
}

function clip(text: unknown, max: number): string {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeCamera(raw: unknown): string {
  const t = String(raw || "").trim();
  return CAMERAS.includes(t) ? t : "";
}

function mergeVisual(blocking: string, charge: string, visual: string): string {
  const merged = [clip(blocking, 160), clip(charge, 120)]
    .filter(Boolean)
    .join("。");
  return (merged || clip(visual, VISUAL_MAX)).slice(0, VISUAL_MAX);
}

function secondsForSpeech(text: string, min: number, max: number): number {
  const n = compactPlay(text).length;
  const raw = Math.round(n / SPEECH_CHARS_PER_SEC) + 1;
  return Math.min(max, Math.max(min, raw || min));
}

function shotAgentSystemPrompt(input: {
  show: boolean;
  lookHint: string;
  innerVoice?: InnerVoiceLevel;
  shotMin: number;
  shotMax: number;
}): string {
  const inner = innerVoiceWriteRules(input.innerVoice);
  if (!input.show) {
    return `你是竖屏口播分镜导演，不是短剧导演。准稿已经锁死，你只排镜：让划走的拇指停在第一句。

先锁整集，不要写进 visual：
- root：这句话在怼谁的错法
- feel：冷|急|爽，这一下只准一种
- close：收在金句
- hookHit：开场第一句原话里最扎人的半句，必须是语言，不是帖拍上桌、不是身体一紧

节拍只能是 钩|共|顶|打|停。口播镜头语法：
- 钩：语言钩子。近景看说话的人。第一帧嘴已经张开，正在说第一句。join=cut，camera=近景。禁止酝酿、禁止「要开口」、禁止「结束时才开口」、禁止先冷脸盯镜头、禁止帖/跪/身体一紧。
- 共/顶/打：接着说，可换景别，不要插不说话的停。
- 停：口播少用。不要为了短剧节奏硬插闭嘴反应镜。

防划走节奏（口播）：
- 开播第一帧就必须出声。钩是第一句，不是画面铺垫。
- 不要顶完插停。不要连续切无声反应。
- 运镜少：默认近景固定或切镜。禁止每镜推拉摇移。
- 收在金句，不要另写下一集对白。

每镜 visual 写清：谁、近景、第一帧已经在说什么劲、衣服场。禁止抽象情绪词。
坐着口播可以同机位，结束也必须写出嘴/手/眼神哪变了，禁止头尾同一张。
每镜写 plate：size=近景（钩必须近景），angle，framing/light/grade/motion 各不超过 8 个字。构图写谁占画、看哪里，不要把 visual 整段抄进去。钩的 motion 必须是「已在说」。camera 只写运镜，不要把景别写进 camera。

定装与连贯：
- 第一镜写死每个人穿什么。后面写「同装」。
- 默认同一场同一发型同一光。换场必须写「从A到B」。
- 道具只写入画物件，写入 shots[].props。
- 出图预算 ${MAX_IMAGE_REFS_ARK} 张参考。说话镜同一镜只一个人。

花字 onScreen：观众心里那一句，禁止复述口播。

准稿纪律：
- 开口镜的 voiceover 必须是准稿原句，按顺序切开，禁止改词。
- 不要插入不说话的钩/停。第一镜必须有对白。
- speaker 跟准稿署名。
${inner}

${input.lookHint}
每集 ${input.shotMin}–${input.shotMax} 镜。只输出 JSON，不要解释。`;
  }
  return `你是竖屏短剧分镜导演，不是编剧，也不是讲师。准稿对白已经锁死，你只排镜：让划走的拇指停住，让观众替一个人着急。

先锁整集，不要写进 visual：
- root：观众替谁
- feel：怒|冤|怕|甜|爽，这一下只准一种
- close：收在气还是爽
- hookHit：开场 3 秒内哪一下扎人，必须是看得见的动作（帖拍上桌、纸撕开、人已经跪着），不是提问句

节拍只能是 钩|共|顶|打|停。镜头语法：
- 钩：黄金 3 秒。特写情绪物件或被压的身体一紧。禁止全景建立镜头，禁止两人端坐讲规矩，禁止「你可明白」。切在揭晓前，留下未完成感。join=cut，camera=特写。
- 共：停在替的人身上。近景微动作（手攥帖、喉结滚、眼睛不敢抬）。不要切去讲道理的人。
- 顶：压迫加码。压的人冷，被压的人绷。过肩或双人近景。下一镜必须是停。
- 打：反转或落地。结束帧必须变——拍桌、纸碎、帖甩脸上、人站起来。不要只张嘴。
- 停：反应镜。闭嘴，特写挨打的脸或手，不换调度、不加新动作。voiceover 可空。

防划走节奏（短剧）：
- 第一镜必须是钩，3 秒内身体一紧。
- 顶完立刻停。禁止连续三镜同一人张嘴不切反应。
- 景别要换：近景（情绪）→ 中景（关系）→ 特写（证据），不要连着两镜同一构图往前挪半步。切镜时 plate.size 必须换。
- 运镜少：默认切镜或固定。钩可以轻微推。禁止每镜推拉摇移。
- 收在 close 锁死的那一下，卡在最高点。有后续就留缺口，没有后续就落地，不要另写下一集对白。

每镜拆成两层，再合成 visual：
- blocking：开头谁在哪、站还是坐、表情、手里什么 → 结束变成什么样。头尾必须能看出差别。禁止开头结束同一姿势同一构图。口播坐着讲可以同机位，也必须写清结束时嘴/手/眼神哪变了。几秒到十几秒的镜头，结束帧不能还是开头那张。同场时下一镜开头=上一镜结束。
- charge：这一下怎么调用观众（先特写帖砸上桌 / 先看被压的眼）。
- visual = blocking。charge。只写能拍到的动作、脸、道具。禁止写「观众先替谁」「观众心又提起来」。禁止抽象情绪词（愤怒、悲伤）。

定装与连贯：
- 第一镜写死每个人穿什么。后面写「同装」。
- 默认同一场同一发型同一光。换场必须写「从A到B」。
- 道具只写入画物件，写入 shots[].props。同一件整集样子不要变。
- 出图预算 ${MAX_IMAGE_REFS_ARK} 张参考：这一镜画面里点名的每个人 1 张设定图，每件入画道具 1 张，同场再占 1 张上一镜尾帧。人+道具+尾帧合计不准超过 ${MAX_IMAGE_REFS_ARK}。超了必须拆镜，不要全员站一排。
- 群戏只特写/过肩这一下要看的 2–3 张脸，其余人写画外或下一镜再给。说话镜同一镜只一个人。

花字 onScreen：没说出口的那句，替观众骂或疼。禁止复述对白。

准稿纪律：
- 开口镜的 voiceover 必须是准稿原句，按顺序切开，禁止改词、禁止缩写、禁止另写一套。
- 可以插入不说话的钩/停/打。反应镜 voiceover 为空。
- speaker 跟准稿署名。内心镜 delivery=inner。
${inner}

${input.lookHint}
每集 ${input.shotMin}–${input.shotMax} 镜。只输出 JSON，不要解释。`;
}

function shotAgentUserPrompt(input: {
  episode: ShotAgentEpisode;
  show: boolean;
  seriesTitle?: string;
  cards?: StanceCard[];
  characterName?: string[];
  durationSec?: EpisodeDurationSec;
  speakMode?: VideoSpeakMode;
  issues?: string[];
  wardrobe?: SeriesWardrobeLock | null;
}): string {
  const pace = episodePace(input.durationSec ?? input.episode.duration_sec);
  const names = (input.characterName || []).filter(Boolean);
  const existing = (input.episode.shots || [])
    .map((shot) => {
      const vo = clip(shot.voiceover, 80);
      return `${shot.index}. [${shot.beat || "?"}/${shot.look || ""}/${shot.camera || ""}] ${clip(shot.visual, 80)}${vo ? ` ｜ ${vo}` : " ｜ （无对白）"}`;
    })
    .join("\n");
  return `${input.show ? "竖屏短剧。" : "口播短视频。钩是第一句语言，开播第一帧就必须出声，不要讲解全景，不要先酝酿再开口。"}
${
    input.speakMode === "narration"
      ? "旁白口播：第一帧人已经在讲，不必对口型，但不要先盯镜头半天。speaker 写旁白。"
      : input.show
        ? "对话短剧：说话镜张嘴，反应镜闭嘴。同一镜只一个人。"
        : "口播对话：第一镜说话的人第一帧就张嘴。同一镜只一个人。不要插闭嘴反应停。"
  }
剧名：${clip(input.seriesTitle, 24) || "本剧"}
第 ${input.episode.episode_no} 集《${clip(input.episode.title, 28)}》
预算约 ${pace.sec} 秒，${pace.shotMin}–${pace.shotMax} 镜。
钩子备忘：${clip(input.episode.hook, 64) || "（无）"}
收束备忘：${clip(input.episode.recap, 80) || "（无）"}
${names.length ? `出镜：${names.join("、")}` : ""}
${seriesWardrobeLine(input.wardrobe)}
${formatStanceCards(input.cards || [])}
${
    input.issues?.length
      ? `上一稿质检没过，必须改这些，不要改对白：\n${input.issues.map((row) => `- ${row}`).join("\n")}`
      : ""
  }

准稿（一字不改，只能切开或留空镜）：
${input.episode.voiceover}

剧本里的旧分镜只供参考，必须按导演语法重排：
${existing || "（还没有分镜）"}

输出：
{"lock":{"root":"替谁","feel":"怒|冤|怕|甜|爽","close":"气|爽","hookHit":"开场哪一下扎人"},"shots":[{"index":1,"beat":"钩","look":"镜头看谁","camera":"固定","join":"cut","plate":{"size":"近景","angle":"平视","framing":"构图一句","light":"光","grade":"色","motion":"已在说"},"props":[],"soundRole":"hit|hold|speak|inner","blocking":"开头谁在哪站坐手里什么→结束变成什么样","charge":"这一下镜头语法","visual":"blocking和charge合成的可拍画面","onScreen":"没说出口的那句","voiceover":"准稿原句或空","speaker":"角色名或旁白","seconds":5}]}`;
}

function parseShotAgentJson(raw: string): {
  lock?: Partial<ShotAgentLock>;
  shots: Record<string, unknown>[];
} | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    const shots = Array.isArray(parsed.shots) ? parsed.shots : [];
    if (shots.length === 0) return null;
    const lock =
      parsed.lock && typeof parsed.lock === "object"
        ? (parsed.lock as Partial<ShotAgentLock>)
        : undefined;
    return { lock, shots: shots as Record<string, unknown>[] };
  } catch {
    return null;
  }
}

function toDirectedShot(
  raw: Record<string, unknown>,
  index: number,
  pace: ReturnType<typeof episodePace>,
): VideoShot | null {
  const beat = normalizeShotBeat(raw.beat) || "共";
  const blocking = clip(raw.blocking, 160);
  const charge = clip(raw.charge, 120);
  const visual = mergeVisual(blocking, charge, clip(raw.visual, VISUAL_MAX));
  const voiceover = clip(raw.voiceover ?? raw.vo ?? raw.line, 800);
  if (!visual && compactPlay(voiceover).length < 2) return null;
  const speaker = stripInnerTag(clip(raw.speaker, 24));
  const look = clip(raw.look ?? raw.look_at, 24);
  const plate =
    parseShotPlate(raw.plate) ||
    inferShotPlate({
      camera: String(raw.camera ?? raw.lens ?? ""),
      visual,
      look,
      beat,
    });
  const camera =
    normalizeShotMove(raw.camera ?? raw.lens) ||
    normalizeCamera(raw.camera ?? raw.lens) ||
    "固定";
  const join =
    normalizeShotJoin(raw.join ?? raw.cut) || defaultJoin(beat);
  const soundRole =
    normalizeSoundRole(raw.soundRole ?? raw.sound_role) ||
    inferSoundRole({
      beat,
      voiceover,
      visual,
      soundRole: undefined,
    });
  const props = Array.isArray(raw.props)
    ? raw.props
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 12))
        .filter(Boolean)
        .slice(0, 6)
    : [];
  const secondsRaw = Number(raw.seconds ?? raw.duration);
  const seconds = Number.isFinite(secondsRaw)
    ? Math.min(pace.shotSecMax, Math.max(pace.shotSecMin, Math.round(secondsRaw)))
    : secondsForSpeech(voiceover, pace.shotSecMin, pace.shotSecMax);
  const shot: VideoShot = {
    index,
    seconds,
    visual: visual || `竖屏，配合「${spokenForPlay(voiceover).slice(0, 18)}」`,
    onScreen: clip(raw.onScreen ?? raw.on_screen, 36),
    voiceover,
    imagePrompt: "",
    beat,
    look: look || defaultLook(beat),
    camera,
    join,
    soundRole,
    plate,
  };
  if (speaker) shot.speaker = speaker;
  if (props.length) shot.props = props;
  if (soundRole === "inner") shot.delivery = "inner";
  return shot;
}

function defaultLook(beat: ShotEmotionBeat | ""): string {
  if (beat === "钩") return "特写手、帖或被压的脸";
  if (beat === "停" || beat === "共") return "挨打的人";
  if (beat === "打") return "特写手或反打的脸";
  return "说话的人";
}

function defaultJoin(beat: ShotEmotionBeat | ""): ShotJoin {
  if (beat === "共") return "continue";
  return "cut";
}

function voiceoversMatchScript(shots: VideoShot[], voiceover: string): boolean {
  const fromShots = compactPlay(
    shots.map((shot) => shot.voiceover).join(""),
  );
  const fromScript = compactPlay(voiceover);
  if (fromScript.length < 8) return true;
  return fromShots === fromScript;
}

function attachLockedVoiceover(
  shots: VideoShot[],
  voiceover: string,
): VideoShot[] {
  const lines = labeledTurns(voiceover);
  if (lines.length === 0) return shots;
  if (voiceoversMatchScript(shots, voiceover)) {
    return shots.map((shot, i) => ({ ...shot, index: i + 1 }));
  }
  let cursor = 0;
  const out: VideoShot[] = shots.map((shot) => {
    const silent =
      compactPlay(shot.voiceover).length < 2 ||
      shot.soundRole === "hold" ||
      shot.soundRole === "hit" ||
      (normalizeShotBeat(shot.beat) === "停" &&
        compactPlay(shot.voiceover).length < 2);
    if (silent) {
      return {
        ...shot,
        voiceover: "",
        soundRole:
          shot.soundRole ||
          (shot.beat === "打" || shot.beat === "钩" ? "hit" : "hold"),
      };
    }
    const line = lines[cursor];
    cursor += 1;
    if (!line) {
      return { ...shot, voiceover: "", soundRole: "hold" };
    }
    const who = speakerOf(line);
    return {
      ...shot,
      voiceover: line,
      speaker: who || shot.speaker,
    };
  });
  while (cursor < lines.length) {
    const line = lines[cursor];
    cursor += 1;
    const prev = out.at(-1);
    out.push({
      index: out.length + 1,
      seconds: secondsForSpeech(line, 4, 15),
      visual:
        prev?.visual ||
        "近景，同装同场，接着上一镜的体态往下演，不要重画开头。",
      onScreen: "",
      voiceover: line,
      imagePrompt: "",
      speaker: speakerOf(line) || prev?.speaker,
      beat: "共",
      look: "说话的人",
      camera: "近景",
      join: "continue",
      soundRole: "speak",
    });
  }
  return out.map((shot, i) => ({ ...shot, index: i + 1 }));
}

function dropShotMedia(shot: VideoShot): VideoShot {
  const next = { ...shot };
  delete next.sceneUrl;
  delete next.startUrl;
  delete next.endUrl;
  delete next.clipUrl;
  delete next.rawClipUrl;
  delete next.lastFrameUrl;
  delete next.speechUrl;
  return next;
}

function bakeImagePrompt(shot: VideoShot, lookAlias: string): VideoShot {
  return {
    ...shot,
    imagePrompt: stripPhotoLook(
      clip(
        `竖屏 9:16，${lookAlias}分镜，${shot.visual}，无水印无 logo 无网址`,
        220,
      ),
    ),
  };
}

async function completeShotAgent(
  messages: { role: "system" | "user"; content: string }[],
  onEvent?: (event: ShotAgentEvent) => void | Promise<void>,
): Promise<string> {
  const model = activeScriptLlmId();
  await onEvent?.({ type: "meta", model });
  let text = "";
  let thinking = "";
  let lastStatusAt = 0;
  for await (const chunk of streamScriptLlm(messages, {
    model,
    temperature: 0.4,
    maxTokens: 16384,
    timeoutMs: 180_000,
    thinkingEffort: "low",
  })) {
    if (chunk.type === "thinking") {
      thinking += chunk.text;
      if (Date.now() - lastStatusAt > 4000) {
        lastStatusAt = Date.now();
        await onEvent?.({
          type: "status",
          message: `分镜导演还在排镜（已思考 ${thinking.length} 字）…`,
        });
      }
      continue;
    }
    if (chunk.type === "content") text += chunk.text;
  }
  if (!text.trim()) {
    throw new Error(
      thinking.trim()
        ? "分镜导演想完了但没吐出镜表，换一个更快的分镜模型再试"
        : "分镜导演超时或返回空内容，换一个更快的分镜模型再试",
    );
  }
  return text;
}

export async function directEpisodeShots(
  input: {
    episode: ShotAgentEpisode;
    hookStyle?: VideoScriptHookStyle | string;
    lookStyle?: string | null;
    seriesTitle?: string;
    characterName?: string | string[];
    speakMode?: VideoSpeakMode;
    innerVoice?: InnerVoiceLevel;
    durationSec?: unknown;
    cards?: StanceCard[];
    issues?: string[];
    wardrobe?: SeriesWardrobeLock | null;
  },
  onEvent?: (event: ShotAgentEvent) => void | Promise<void>,
): Promise<ShotAgentEpisode> {
  const episode = input.episode;
  const show = isShowStyle(input.hookStyle);
  const look = resolveLookStyle(input.lookStyle);
  const pace = episodePace(input.durationSec ?? episode.duration_sec);
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
    message: `第 ${episode.episode_no} 集分镜导演在排镜：先锁替谁和开场哪一下扎人…`,
  });
  const raw = await completeShotAgent(
    [
      {
        role: "system",
        content: shotAgentSystemPrompt({
          show,
          lookHint: look.visualHint,
          innerVoice: resolveInnerVoice(input.innerVoice),
          shotMin: pace.shotMin,
          shotMax: pace.shotMax,
        }),
      },
      {
        role: "user",
        content: shotAgentUserPrompt({
          episode,
          show,
          seriesTitle: input.seriesTitle,
          cards: input.cards,
          characterName: names,
          durationSec: pace.sec,
          speakMode: input.speakMode,
          issues: input.issues,
          wardrobe: input.wardrobe,
        }),
      },
    ],
    onEvent,
  );
  const parsed = parseShotAgentJson(raw);
  if (!parsed) throw new Error("分镜导演没有吐出可用 JSON");
  const drafted = parsed.shots
    .map((row, i) => toDirectedShot(row, i + 1, pace))
    .filter((shot): shot is VideoShot => Boolean(shot))
    .slice(0, pace.shotMax);
  if (drafted.length < Math.min(2, pace.shotMin)) {
    throw new Error("分镜导演镜数不够");
  }
  const locked = attachLockedVoiceover(drafted, episode.voiceover);
  const timed = locked.map((shot) => ({
    ...shot,
    seconds: secondsForSpeech(
      shot.voiceover,
      pace.shotSecMin,
      pace.shotSecMax,
    ),
  }));
  const grammar = applyShotEmotionGrammar(timed, {
    insert: show,
    mutateVisual: !show,
    shotMax: pace.shotMax,
    show,
  }).map((shot, i) => {
    if (!show && i === 0) {
      return {
        ...shot,
        plate: { ...talkHookPlate(), ...shot.plate, size: "近景" as const, motion: "已在说" },
      };
    }
    return { ...shot, plate: shot.plate || inferShotPlate(shot) };
  });
  const cleaned = scrubShotFlowers(
    grammar.map((shot) => {
      const next = dropShotMedia(bakeImagePrompt(shot, look.stillAlias));
      if (flowerRepeatsLine(next.onScreen || "", next.voiceover || "")) {
        next.onScreen = "";
      }
      return next;
    }),
  );
  const lock = parsed.lock;
  const hookHit = clip(lock?.hookHit, 64);
  await onEvent?.({
    type: "status",
    message: `第 ${episode.episode_no} 集分镜已排好：替${clip(lock?.root, 8) || "人"}，${normalizeDirectorFeel(lock?.feel)}，收在${normalizeDirectorClose(lock?.close)}，${cleaned.length} 镜`,
  });
  const director: ShotAgentLock = {
    root: clip(lock?.root, 16),
    feel: normalizeDirectorFeel(lock?.feel),
    close: normalizeDirectorClose(lock?.close),
    hookHit,
  };
  return {
    ...episode,
    hook: episode.hook?.trim() || hookHit,
    shots: cleaned,
    director,
  };
}

const LECTURE_WIDE =
  /端坐|两人.{0,8}(坐|站)|全景|讲解|讲规矩|对面坐|并排坐|竖屏讲解画面/;
const HOOK_CLOSE = /特写|帖|折子|跪|手|脸|眼睛|手机|纸|拍上桌|身体一紧/;

export function reviewDirectedShots(
  episode: ShotAgentEpisode,
  names: string[] = [],
  show = true,
): { pass: boolean; issues: string[] } {
  const issues: string[] = [];
  const shots = episode.shots || [];
  const roster = [
    ...new Set(
      [
        ...names.map((name) => name.trim()),
        ...shots.map((shot) => String(shot.speaker || "").trim()),
      ].filter((name) => name && name !== "旁白"),
    ),
  ];
  const first = shots[0];
  if (!first || normalizeShotBeat(first.beat) !== "钩") {
    issues.push("第一镜必须是钩");
  }
  const firstVisual = `${first?.visual || ""} ${first?.look || ""} ${first?.camera || ""}`;
  if (show) {
    if (first && LECTURE_WIDE.test(firstVisual)) {
      issues.push("开场是两人端坐全景，没有特写扎人");
    }
    if (first && !HOOK_CLOSE.test(firstVisual)) {
      issues.push("第一镜没有特写物件或身体一紧");
    }
    const hasPress = shots.some((shot) => normalizeShotBeat(shot.beat) === "顶");
    const hasHold = shots.some((shot) => normalizeShotBeat(shot.beat) === "停");
    if (hasPress && !hasHold) {
      issues.push("有顶必须有停");
    }
  } else {
    if (first && spokenForPlay(first.voiceover).length < 2) {
      issues.push("口播第一镜必须开口");
    }
    if (first && /要开口|嘴角微动|酝酿/.test(firstVisual)) {
      issues.push("口播第一镜不能先酝酿再开口");
    }
    const hookPlate = inferShotPlate(first);
    if (first && hookPlate.motion !== "已在说") {
      issues.push("口播钩的动势必须是已在说");
    }
  }
  for (let i = 0; i < shots.length; i += 1) {
    const shot = shots[i];
    const prev = i > 0 ? shots[i - 1] : undefined;
    if (
      shot.join === "cut" &&
      prev &&
      inferShotPlate(shot).size === inferShotPlate(prev).size
    ) {
      issues.push(`第${shot.index}镜切镜但景别没换`);
    }
  }
  for (const shot of shots) {
    if (flowerRepeatsLine(shot.onScreen || "", shot.voiceover || "")) {
      issues.push(`第${shot.index}镜花字复述对白`);
    }
    const load = shotRefLoad({ shot, names: roster });
    if (load.total > MAX_IMAGE_REFS_ARK) {
      issues.push(
        `第${shot.index}镜入画${load.people}人、${load.props}件道具，加上衔接帧共${load.total}张，超过 ${MAX_IMAGE_REFS_ARK} 张参考，拆镜不要全员入画`,
      );
    }
  }
  if (!voiceoversMatchScript(shots, episode.voiceover)) {
    issues.push("开口镜拼起来必须等于准稿");
  }
  return { pass: issues.length === 0, issues };
}

export async function directGeneratedEpisodes<T extends ShotAgentEpisode>(
  episodes: T[],
  input: {
    hookStyle?: VideoScriptHookStyle | string;
    lookStyle?: string | null;
    seriesTitle?: string;
    characterName?: string | string[];
    speakMode?: VideoSpeakMode;
    innerVoice?: InnerVoiceLevel;
    durationSec?: unknown;
    cards?: StanceCard[];
    shotModel?: string;
    wardrobe?: SeriesWardrobeLock | null;
  },
  onEvent?: (event: ShotAgentEvent) => void | Promise<void>,
): Promise<T[]> {
  const run = async () => {
    const out: T[] = [];
    for (const episode of episodes) {
      try {
        let directed = await directEpisodeShots(
          { ...input, episode },
          onEvent,
        );
        const judged = reviewDirectedShots(
          directed,
          Array.isArray(input.characterName)
            ? input.characterName
            : input.characterName
              ? [input.characterName]
              : [],
          isShowStyle(input.hookStyle),
        );
        const short = Number(input.durationSec) === 15;
        if (!judged.pass && !short) {
          await onEvent?.({
            type: "status",
            message: `第 ${episode.episode_no} 集分镜质检没过，打回导演重排…`,
          });
          directed = await directEpisodeShots(
            { ...input, episode: directed, issues: judged.issues },
            onEvent,
          );
        }
        out.push({ ...episode, ...directed, episode_no: episode.episode_no });
      } catch {
        await onEvent?.({
          type: "status",
          message: `第 ${episode.episode_no} 集分镜导演没写成，沿用剧本分镜`,
        });
        out.push(episode);
      }
    }
    return out;
  };
  return withScriptLlm(input.shotModel || activeScriptLlmId(), run);
}
