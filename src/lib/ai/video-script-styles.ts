import type { VideoScriptGenre, VideoScriptHookStyle } from "@/lib/types";

export type { VideoScriptHookStyle };

export const MAX_EPISODE_COUNT = 80;
/** 本剧角色名单上限。一镜参考图最多 10 张（人+道具+尾帧），超了分镜要拆，和这个不是一回事。 */
export const MAX_SERIES_CAST = 16;
export const PREMISE_MAX = 1000;
export const EPISODE_DURATION_OPTIONS = [15, 90] as const;
export type EpisodeDurationSec = (typeof EPISODE_DURATION_OPTIONS)[number];
export const DEFAULT_EPISODE_DURATION: EpisodeDurationSec = 90;

export function clampEpisodeCount(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.min(MAX_EPISODE_COUNT, Math.max(1, Math.round(v)));
}

export function clampEpisodeDuration(n: unknown): EpisodeDurationSec {
  return Number(n) === 15 ? 15 : 90;
}

/** 把存下来的秒数认回 15/90 预算。15 秒成片常是 8–16，不能当成 90。 */
export function durationBudget(n: unknown): EpisodeDurationSec {
  if (Number(n) === 15) return 15;
  const v = Number(n);
  if (Number.isFinite(v) && v > 0 && v <= 20) return 15;
  return 90;
}

export type EpisodePace = {
  sec: EpisodeDurationSec;
  voiceMin: number;
  voiceMax: number;
  shotMin: number;
  shotMax: number;
  shotSecMin: number;
  shotSecMax: number;
  shotCharsMin: number;
  shotCharsMax: number;
  secondsSumMin: number;
  secondsSumMax: number;
  beats: Array<{ at: string; talk: string; show: string }>;
};

export function defaultRenderVoicePath(
  hookStyle?: string | null,
): "native" | "tts" {
  return isShowStyle(hookStyle) ? "native" : "tts";
}

export function videoWaitLimitMs(durationSec?: number): number {
  const dur = Math.max(4, Number(durationSec) || 15);
  return Math.max(180_000, dur * 20_000);
}

function modelShotSecMax(modelMaxSec?: number): number {
  const n = Math.round(Number(modelMaxSec));
  if (!Number.isFinite(n) || n <= 0) return 15;
  return Math.min(30, Math.max(15, n));
}

export function episodePace(sec?: unknown, modelMaxSec?: number): EpisodePace {
  if (clampEpisodeDuration(sec) === 15) {
    return {
      sec: 15,
      voiceMin: 50,
      voiceMax: 110,
      shotMin: 2,
      shotMax: 4,
      shotSecMin: 4,
      shotSecMax: 8,
      shotCharsMin: 12,
      shotCharsMax: 48,
      secondsSumMin: 8,
      secondsSumMax: 16,
      beats: [
        {
          at: "0–2 秒",
          talk: "钩。第一句停住拇指，要扎人。",
          show: "钩。开场画面先让人身体一紧（被扔、被揭穿、被当众压），第一句停住拇指。不要提问句。",
        },
        {
          at: "2–10 秒",
          talk: "共。用观众自己做过的错法演出来，不要点名「你是不是也…」。只讲一件事。",
          show: "共/顶。让观众代入受辱或想赢的那一方，对手在场，只演这一个冲突拍。必须有反应镜。",
        },
        {
          at: "10–15 秒",
          talk: "落地或金句，花字是观众心里那一句。",
          show: "打/停。反转或花字替观众说话，留下缺口。",
        },
      ],
    };
  }
  return {
    sec: 90,
    voiceMin: 180,
    voiceMax: 400,
    shotMin: 4,
    shotMax: 16,
    shotSecMin: 4,
    shotSecMax: modelShotSecMax(modelMaxSec),
    shotCharsMin: 12,
    shotCharsMax: 80,
    secondsSumMin: 40,
    secondsSumMax: 90,
    beats: [
        {
          at: "0–3 秒",
          talk: "钩。反常识、扎心、好奇缺口。第一句停住拇指。",
          show: "钩。开场画面先让人身体一紧（被扔、被揭穿、被当众压），第一句停住拇指。不要提问句。",
        },
        {
          at: "3–15 秒",
          talk: "共。用观众自己做过的错法演出来，不要上课点名「你是不是也踩过这个坑」。",
          show: "共。让观众代入受辱、被误解或想赢的那一方。对手进场把关系顶起来，不是点名「你是不是也…」。",
        },
        {
          at: "15–70 秒",
          talk: "只推进一件事。口播接着上一句，不许每镜换论点。",
          show: "顶。只演这一个冲突拍，对白来回。骂完必须切反应镜：看挨打的人的脸。每镜只说新的话。",
        },
        {
          at: "70–90 秒",
          talk: "落地、金句，花字是观众心里那一句，或留下一集的缺口。",
          show: "打/停。金句或反转落地，花字是观众没说出口的那句。留下一集的缺口。",
        },
    ],
  };
}

export function paceRules(show: boolean, sec?: unknown): string {
  const p = episodePace(sec);
  const beats = p.beats
    .map((b) => `- ${b.at}：${show ? b.show : b.talk}`)
    .join("\n");
  return `约 ${p.sec} 秒是预算，第一要务是把这一拍剧情演清楚，不要为了凑秒数注水。
${beats}

${show ? "对白" : "口播"}写到冲突能看懂就停，大约 ${p.voiceMin}–${p.voiceMax} 字，不要复读凑时长。竖屏 9:16。
分镜按准稿来：一镜一个人一句原话，${p.shotMin}–${p.shotMax} 个即可，禁止改对话。
seconds 按抖音/短剧语速来写，一句一口气，${p.shotSecMin}–${p.shotSecMax} 秒，短句就短、长句就长，禁止每镜都写成 10 秒，禁止按慢慢念稿估时长。
口播和对白都要能快说：短句，口语，有轻重，像当面说，不要书面长句，不要「首先、其次、因此」，不要念稿腔。${show ? "该急就急，该停就停在反应镜，不要匀速读完。" : "开播第一帧就必须出声，不要先酝酿再开口，不要匀速读完。"}
整集 duration_sec 用各镜 seconds 相加，不要硬写成 ${p.sec}。
hook 必填，就是开场第一句原话，不能空。
对白可以在冲突最紧处用——被下一个人打断，但换人必须另起「角色名：」，不要两个人写进同一镜。不是打断的句子用。！？收束。禁止把前面说过的半句再抄一遍当结尾。
禁止写成 ${p.sec === 15 ? "90 秒长课" : "15 秒碎片或空镜注水"}。`;
}

export type VideoScriptStyleGroup = "口播讲法" | "短剧题材";
export type VideoScriptStyleFamily = "talk" | "show";

export const VIDEO_SCRIPT_STYLE_GROUPS: VideoScriptStyleGroup[] = [
  "口播讲法",
  "短剧题材",
];

export const VIDEO_SCRIPT_HOOK_STYLES: Array<{
  id: VideoScriptHookStyle;
  label: string;
  hint: string;
  genre: VideoScriptGenre;
  group: VideoScriptStyleGroup;
  family: VideoScriptStyleFamily;
  pick?: boolean;
}> = [
  {
    id: "talk",
    label: "科普口播",
    hint: "直接讲清一件事，像跟朋友说话",
    genre: "edu",
    group: "口播讲法",
    family: "talk",
  },
  {
    id: "roast",
    label: "打脸反转",
    hint: "先顺着常见错法，再一巴掌打回来",
    genre: "drama",
    group: "口播讲法",
    family: "talk",
  },
  {
    id: "confess",
    label: "忏悔自述",
    hint: "我以前也踩过这个坑，现在才想通",
    genre: "drama",
    group: "口播讲法",
    family: "talk",
  },
  {
    id: "argue",
    label: "抬杠抬死",
    hint: "先抬一句反对，当场拆掉",
    genre: "drama",
    group: "口播讲法",
    family: "talk",
  },
  {
    id: "expose",
    label: "揭底内幕",
    hint: "揭一层别人不说的，但必须来自文章和语料",
    genre: "drama",
    group: "口播讲法",
    family: "talk",
  },
  {
    id: "contrast",
    label: "前后对比",
    hint: "错法和对法并排，一眼看出差别",
    genre: "edu",
    group: "口播讲法",
    family: "talk",
  },
  {
    id: "isekai",
    label: "穿越",
    hint: "今人入异时空，反差来自我会、他们不会",
    genre: "drama",
    group: "短剧题材",
    family: "show",
  },
  {
    id: "rebirth",
    label: "重生",
    hint: "同一世界重来，靠预知改命",
    genre: "drama",
    group: "短剧题材",
    family: "show",
  },
  {
    id: "system",
    label: "系统",
    hint: "任务和奖惩推剧情，花字可当系统提示",
    genre: "drama",
    group: "短剧题材",
    family: "show",
  },
  {
    id: "tycoon",
    label: "豪门",
    hint: "家产、身份、联姻，冲突在家里",
    genre: "drama",
    group: "短剧题材",
    family: "show",
  },
  {
    id: "revenge",
    label: "复仇",
    hint: "被亏待之后反杀，每集只报一笔账",
    genre: "drama",
    group: "短剧题材",
    family: "show",
  },
  {
    id: "romance",
    label: "甜宠",
    hint: "两人关系往前推，误会和吃醋，不是讲课",
    genre: "drama",
    group: "短剧题材",
    family: "show",
  },
  {
    id: "workplace",
    label: "职场",
    hint: "文章里的行业当舞台，一次站队或选择",
    genre: "drama",
    group: "短剧题材",
    family: "show",
  },
  {
    id: "court",
    label: "古装权谋",
    hint: "朝堂或府里站队，衣服和称呼要对时代",
    genre: "drama",
    group: "短剧题材",
    family: "show",
  },
  {
    id: "drama",
    label: "剧情短剧",
    hint: "旧系列兜底，新剧请改选具体题材",
    genre: "drama",
    group: "短剧题材",
    family: "show",
    pick: false,
  },
];

export const VIDEO_SCRIPT_STYLE_OPTIONS = VIDEO_SCRIPT_HOOK_STYLES.filter(
  (s) => s.pick !== false,
);

export function normalizeHookStyle(raw: unknown): VideoScriptHookStyle {
  const id = typeof raw === "string" ? raw.trim() : "";
  return VIDEO_SCRIPT_HOOK_STYLES.some((s) => s.id === id)
    ? (id as VideoScriptHookStyle)
    : "talk";
}

export function hookStyleMeta(id?: string | null) {
  const style = normalizeHookStyle(id);
  return (
    VIDEO_SCRIPT_HOOK_STYLES.find((s) => s.id === style) ||
    VIDEO_SCRIPT_HOOK_STYLES[0]
  );
}

export function genreFromHookStyle(id?: string | null): VideoScriptGenre {
  return hookStyleMeta(id).genre;
}

export function isShowStyle(id?: string | null): boolean {
  return hookStyleMeta(id).family === "show";
}

export function hookStyleLabel(id?: string | null): string {
  return hookStyleMeta(id).label;
}

/** 角色定装跟题材走，不要再写成「剧情短剧 / 科普口播」两分。 */
export function hookStyleLookLine(id?: string | null): string {
  const style = normalizeHookStyle(id);
  if (!isShowStyle(style)) {
    return "出镜是能讲这件事的现代日常的人，不要古装戏服，不要短剧定装。";
  }
  switch (style) {
    case "isekai":
      return "今人进了哪个世界，衣服称呼必须是那个时代，不要西装开会。";
    case "rebirth":
      return "同一世界同一天的衣服和场，不要另换一套穿越装。";
    case "system":
      return "按这场时代定装。系统是弹窗不是人，不要给系统单独画一张脸。";
    case "tycoon":
      return "衣服要看得出家里身份和排位，不要讲师马甲。";
    case "revenge":
      return "衣服和场要对被亏待的那一笔，不要口播路人。";
    case "romance":
      return "两人能看出口的日常或本场身份，不要讲课西装。";
    case "workplace":
      return "这个行业的人，工位或会场，不要古装。";
    case "court":
      return "朝堂或府里的衣服和发冠，禁止现代便装。";
    default:
      return "按这场戏的时代定装，不要口播路人。";
  }
}

export type ShowEngineCard = {
  feel: string;
  root: string;
  firstHit: string;
  talk: string;
  picture: string;
  flower: string;
  neverAs: string;
  premise: string;
  kickoff: string;
  beat: string;
  mark: RegExp;
};

const SHOW_ENGINE_CARDS: Record<string, ShowEngineCard> = {
  isekai: {
    feel: "错位的爽和险：他们不会、我会，可这个世界随时能压死他",
    root: "刚进这个世界的今人",
    firstHit: "这个世界的人已经当众压他或嘲他「哪来的」，他身上的今人习惯已经露馅。禁止自己宣布「我穿越了」。",
    talk: "对方用这个世界的规矩压他。他只用今人会的那一下顶回去，像对上同一本教材、随口一个现代词。禁止说明书，禁止问案情。",
    picture: "时代场。特写必须是这个世界看不懂、观众却懂的物件或习惯。",
    flower: "这个世界听不懂的现代词，短、刺。",
    neverAs: "禁止写成同一世界重生、现代开会、职场背锅。",
    premise: "必须一眼是「穿越」：进了哪个世界、今人会什么他们不会、已经露了哪一下金手指。禁止写成同一世界重生或现代职场。",
    kickoff: "先想清楚：人进了哪个世界、今人会什么他们不会、金手指露哪一下。观众替这个今人感到错位的爽和险。剧情介绍和准稿都必须一眼是穿越。",
    beat: "按时长拍完：先被这个世界当众压，再露一次金手指，留下这个世界的缺口。不要自行改秒数。",
    mark: /这个时代|你们这儿|本朝|穿越|这个世界|在这儿|哪来的/,
  },
  rebirth: {
    feel: "冤，和这一次我改得过的狠",
    root: "记得上一世怎么栽的人",
    firstHit: "上一世栽的那一下（被弃、被撕、吐血）只闪一次，立刻睁眼，对手已经进门还当第一次。禁止开场解说「我重生了」。",
    talk: "别人当第一次找茬。他用预知只改一件事，当场挡下或掀翻。禁止旁白宣布重生，禁止问「怎么回事」。",
    picture: "同一世界同一天。特写必须是上一世害过他的那件东西，不是空镜拉远。",
    flower: "没说出口的记忆，短、冷。",
    neverAs: "禁止写成换世界穿越、系统弹窗、现代口播课。",
    premise: "必须一眼是「重生」：同一世界重来、上一世栽在哪、这一世改了哪一件。禁止写成换世界穿越。",
    kickoff: "先想清楚：谁记得上一世、栽在哪、这一世只改哪一件。观众替他感到冤和要改的狠。剧情介绍必须一眼是重生。",
    beat: "按时长拍完：先上一世结局（只说一次），再睁眼用一次预知改一件事，留下缺口。不要自行改秒数，不要把上一世结局在集尾复读。",
    mark: /上一世|上一辈子|睁眼|重来|又来一遍|记得这[一天天]|这回别/,
  },
  system: {
    feel: "被逼着赌，倒计时压胸口",
    root: "被系统盯着、对面还有真人要他好看的人",
    firstHit: "弹窗任务砸下来的同时，场上有人在逼他接或撕。倒计时压的是这一句，不是装饰。禁止先拍一张纸再问询开场。",
    talk: "接还是瞒，必须有人开口赌。系统不是角色，不要念「宿主你好」。禁止只把弹窗贴在普通职场会上，禁止收尾讲方案（改对外说法、三个问法）。禁止「怎么回事、客户投诉了」。",
    picture: "弹窗和对手同框。特写必须是任务/倒计时/奖惩，不是普通文件特写作业。",
    flower: "系统提示，短、冷、像弹窗。",
    neverAs: "禁止写成穿越说明书、没有弹窗的普通职场、重生睁眼。",
    premise: "必须一眼是「系统」：谁被系统盯着、弹了哪条任务、倒计时或奖惩、现在接还是瞒。禁止只写职场/穿越而不提系统弹窗和任务。",
    kickoff: "先想清楚：系统下了哪条任务、倒计时多久、接还是瞒、跟谁赌。观众替他感到被逼着赌。剧情介绍和准稿都必须看得见弹窗/任务/奖惩。",
    beat: "按时长拍完：先弹窗下任务，再逼他接或瞒，奖惩落地留缺口。不要自行改秒数。",
    mark: /任务|倒计时|系统|奖励|扣分|宿主|弹窗|积分/,
  },
  tycoon: {
    feel: "名分被踩的火，或没名分的人被当众按着",
    root: "家里被按着的那一个",
    firstHit: "饭桌或客厅里已经在赶人：谁不能上桌、谁被当空气、谁被当众按着。禁止开场开会问案情。",
    talk: "第一句必须是赶人下桌或当空气。身份、联姻、谁配姓这个姓。至少两代或两房开口。禁止公司培训腔。",
    picture: "家里的场。特写必须是名分物件（戒指、遗嘱、座位、被撤的碗），不是报价单作业。",
    flower: "没说出口的身份。",
    neverAs: "禁止写成公司培训、职场背锅、客户听课。",
    premise: "必须一眼是「豪门」：家里谁和谁、名分或家产撕开了哪一层。禁止写成公司培训。",
    kickoff: "先想清楚：家里谁和谁、撕开哪一层名分。观众替被按着的人感到名分被踩的火。剧情介绍必须一眼是豪门家里的事。",
    beat: "按时长拍完：先家里赶人下桌，再撕开一层身份或一份文件，留下名分缺口。不要自行改秒数。",
    mark: /家里|爸|妈|联姻|股份|上桌|二房|遗嘱|名分/,
  },
  revenge: {
    feel: "恨，和必须报这一笔的狠",
    root: "被亏待、这集只报一笔的人",
    firstHit: "被夺的那件东西已经当众易手，对手还在笑。禁止开场审判独白或问询。",
    talk: "对手要还嘴、要慌、要反咬。这一集只把这一笔抢回来或亮出来，下一笔留着。禁止旁白骂人列罪状。",
    picture: "被亏待的现场。特写必须是那一笔账的物件（被抢的画、被撕的玉、被吞的奖金）。",
    flower: "没说完的账。",
    neverAs: "禁止写成口播打脸、讲课、系统任务清单。",
    premise: "必须一眼是「复仇」：当初怎么被亏待、已经报了哪一笔、还欠着哪一笔。禁止写成口播打脸。",
    kickoff: "先想清楚：先看见哪一笔被亏待、这一集只报哪一笔。观众替他感到恨。剧情介绍必须一眼是复仇。",
    beat: "按时长拍完：先看见被夺，再报这一笔，留下更大的账。不要自行改秒数。",
    mark: /当初|这笔|还回去|欠我|报复|你也有今天/,
  },
  romance: {
    feel: "甜、酸、护短，心里那句没说完",
    root: "想在一起的两人里更吃亏、更忍不住的那个",
    firstHit: "第三人已经当众踩她/他（嘲、抢、赶），另一方已经挡上去。禁止两人关起门盘问案情，禁止开场讲产品。",
    talk: "护短要当众说出口，像「谁准你动她 / 我的人 / 你惹她干嘛」。被护的人嘴硬或酸，不要立刻讲清楚。第三人必须在场开口踩。禁止「上周那单、AI推荐了谁」。收束必须是准稿里停住的那句。",
    picture: "当众的场。特写是被踩的脸和挡上去的手，不是文件、手机屏幕作业。",
    flower: "没说出口的那句，酸或甜，像「他护我了」。",
    neverAs: "禁止写成种草课、职场开会问询、系统任务、重生说明书。",
    premise: "必须一眼是「甜宠」：谁当众踩、谁护、被护的人酸在哪句。禁止写成种草课。",
    kickoff: "先想清楚：谁当众踩、谁护、被护的人酸还是嘴硬。观众替更吃亏的那个感到甜或酸。剧情介绍必须一眼是甜宠。",
    beat: "按时长拍完：先当众被踩、再护上，停在没说完的那句。不要自行改秒数。",
    mark: /居然|吃醋|误会|我偏|别碰他|别碰她|护短|查我|偏心|酸|谁准你|我的人|你惹她/,
  },
  workplace: {
    feel: "要被卖的怕，和必须站队的火",
    root: "会上要被背锅或被卖的人",
    firstHit: "当众已经被卖：开除、抢功、名字写上墙。禁止开场问「报价单怎么回事」。",
    talk: "站队、甩锅、谁签字、谁扛。最后一句必须是掀桌、接锅或亮身份，禁止收尾汇报「我试了三个问法」。禁止客户来听课，禁止把事情问清楚当钩。",
    picture: "会场、工位或洽谈宴。特写必须是被卖的证据（开除条、被抢的单、签字），不是慢慢拉远介绍谁在场。",
    flower: "没说出口的站队。",
    neverAs: "禁止写成客户听课、豪门家里撕、系统弹窗说明书。",
    premise: "必须一眼是「职场」：会上谁要被卖、站了哪边、锅还在谁身上。禁止写成客户听课。",
    kickoff: "先想清楚：会上谁要被卖、站哪边、锅给谁。观众替要被卖的人感到怕和火。剧情介绍必须一眼是职场站队。",
    beat: "按时长拍完：先当众被卖，再做一次站队，留下缺口。不要自行改秒数。",
    mark: /背锅|站队|谁签字|谁扛|被卖|会上|开除/,
  },
  court: {
    feel: "被规矩压得喘不过气，站错队就没了",
    root: "被旨或规矩逼着选的人",
    firstHit: "帖或旨已经宣读、已经拍在案上，人已经跪着接或拒。禁止开场问「你可明白」，禁止把祖制、投帖规矩讲清楚当钩，禁止慢慢讲朝堂背景，禁止开场现代开会或解说自己是穿越的。",
    talk: "时代称呼。第一句是逼他接或拒，不是解释祖制。禁止「你可明白/你可知/总要有个规矩」。每集只下一道旨、揭一层站队。禁止现代词讲课。",
    picture: "朝堂、府里或酒宴。第一镜必须特写帖、印、跪着的手或被压的脸，禁止两人端坐讲规矩的全景。",
    flower: "没说出口的站队。",
    neverAs: "禁止写成现代口播、会议室、穿越说明书（除非用户选的就是穿越）。",
    premise: "必须一眼是「古装权谋」：哪道旨或规矩压下来、逼了哪个选择。禁止写成现代口播。",
    kickoff: "先想清楚：哪道旨压下来、逼哪个选择。观众替被逼选的人感到险。剧情介绍必须一眼是古装权谋。",
    beat: "按时长拍完：先旨已经宣读，再逼一个选择，留下下一道旨。不要自行改秒数。",
    mark: /殿下|大人|臣|府上|旨|本官|奴才/,
  },
  drama: {
    feel: "替人着急，想看下一拍",
    root: "被对手压着的那个人",
    firstHit: "冲突已经发生：被揭穿、被压、被逼选。禁止开场铺垫超过一句，禁止问询或讲课。",
    talk: "对手在场、要开口。对白推关系，不把事情说清楚。",
    picture: "具体的人、具体的事。特写必须是情绪物件。",
    flower: "没说出口的那句。",
    neverAs: "禁止写成口播课、白板列一二三。",
    premise: "写清谁和谁、已经发生了什么冲突、现在卡在哪。不要广告词。",
    kickoff: "先想清楚：这集的冲突是谁和谁、观众替谁着急、这一下是怒还是怕。不要想「这集讲哪个知识点」。",
    beat: "按时长拍完：先冲突，再推进一拍，留下缺口。不要自行改秒数。",
    mark: /被|居然|你凭什么/,
  },
};

export function showEngineCard(id?: string | null): ShowEngineCard | null {
  if (!isShowStyle(id)) return null;
  return SHOW_ENGINE_CARDS[normalizeHookStyle(id)] || SHOW_ENGINE_CARDS.drama;
}

/** 剧情介绍必须写出这个发动机，不能写成别的题材。 */
export function hookStylePremiseLine(id?: string | null): string {
  return showEngineCard(id)?.premise || "写清这套在讲什么、已经说到哪、观众为什么要接着看。";
}

/** 开写前先锁死这套戏的发动机，避免所有短剧都写成重生。 */
export function showKickoffLine(id?: string | null): string {
  const card = showEngineCard(id);
  if (!card) return "先想清楚：这集凭什么不被划走？观众是谁？他正在烦什么？";
  return `${card.kickoff}不要想「这集讲哪个知识点」。`;
}

export function hookStyleShotContract(id?: string | null): {
  hook: string;
  look: string;
  visual: string;
  onScreen: string;
} {
  const card = showEngineCard(id);
  if (!card) {
    return {
      hook: "开场原话，必填不能空，必须能单独当开头",
      look: "镜头看谁：说话的人还是反应",
      visual: "开头谁在哪、站还是坐、表情；结束时变成什么样。换场写「从A到B」",
      onScreen: "花字短狠，是观众心里那一句，不要复述口播",
    };
  }
  return {
    hook: `必须让观众感到「${card.feel}」，禁止问询案情，禁止「怎么回事/你解释一下/客户投诉了/你可明白/总要有个规矩」`,
    look: "镜头看谁：说话的人 / 挨打的人 / 情绪物件的特写",
    visual: `第一镜：${card.firstHit}后面各镜写开头谁在哪、站坐、表情，结束时变成什么样。特写必须是情绪物件。同场下一镜开头=本镜结束。`,
    onScreen: card.flower,
  };
}

function formatShowEngine(id: string | null | undefined, card: ShowEngineCard): string {
  return `短剧发动机：${hookStyleLabel(id)}。只准用这一套，${card.neverAs}

观众感到：${card.feel}。替：${card.root}。
第一镜：${card.firstHit}
对白：${card.talk}
画面：${card.picture}
花字：${card.flower}
${card.beat}
文章和语料只当背景：行业、场景、人设、不能编的品牌和数据。不要求每集讲一个知识点。
金手指、穿越身份、重生记忆、系统绑定只在必须露的那一集露一次。后面各集换新的冲突拍，禁止每集重复同一句设定。
标题要像短剧，不要像公号提问。`;
}

export function hookStyleLine(id?: string | null): string {
  const card = showEngineCard(id);
  if (card) return formatShowEngine(id, card);
  switch (normalizeHookStyle(id)) {
    case "roast":
      return `叙事壳：打脸反转。不要写成忏悔，不要写成抬杠拌嘴。
前 3 秒先把观众正在做的错法说出来，让他点头；15 秒内一巴掌打回来：原来不是这样。
中间只推进「错在哪 → 对的做法是什么」一件事。不要骂人，不要编客户和数据。
花字狠、短，像打在脸上的那一句。`;
    case "confess":
      return `叙事壳：忏悔自述。不要写成打脸别人，不要写成揭内幕。
用第一人称「我以前也……」。钩子是自己踩过的坑，不是说教。
共鸣用「当时我也觉得自己挺对」，落地是现在才想通的那一句。
不要哭腔，不要英雄翻盘，像跟熟人承认一件事。`;
    case "argue":
      return `叙事壳：抬杠抬死。不要写成独白忏悔，不要写成揭底。
开头先抛一句观众会抬的杠：「不就是……吗 / 谁还不是……」。
立刻拆掉这句杠，只拆一个点，拆完给一个能用的小办法。
对白可以顶两句，但不要变成拌嘴小品，更不要人身攻击。`;
    case "expose":
      return `叙事壳：揭底内幕。不要写成打脸反转课，不要编不存在的黑幕。
钩子是「这件事大家一直没说破」。只揭文章和语料里已经有的一层，不许编内幕、客户、公司名。
节奏：先点破 → 为什么一直被掩盖/被忽略 → 你现在能怎么做。
像揭一层纸，不像爆料自媒体。`;
    case "contrast":
      return `叙事壳：前后对比。不要写成清单课，不要写成打脸独白。
整集只对比一件事的错法和对法。画面和口播都并排：左边这样会怎样，右边那样会怎样。
钩子用「就差这一点」。不要列清单，不要讲超过一个对比轴。`;
    default:
      return `叙事壳：科普口播。不要写成短剧，不要自我介绍。
一集只讲一个知识点。像聪明朋友拍着桌子讲，不要念稿，不要「大家好今天来讲」。
钩子用「原来不是这样 / 你一直做错了 / 一个很多人不知道的小区别」；共鸣用生活里的错法；中间用例子不用定义。`;
  }
}

export function showEngineMark(id?: string | null): RegExp | null {
  return showEngineCard(id)?.mark || null;
}

export function textHasShowEngine(
  text: string,
  id?: string | null,
): boolean {
  const mark = showEngineMark(id);
  if (!mark) return Boolean(String(text || "").trim());
  return mark.test(String(text || ""));
}
