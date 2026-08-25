import type { PodcastMode } from "@/lib/types";

export function oralModeLabel(mode: PodcastMode): string {
  return mode === "dialogue" ? "双人对谈" : "单人口播";
}

export function resolveOralMode(value: unknown): PodcastMode {
  return value === "dialogue" ? "dialogue" : "solo";
}

export function oralTaskLock(mode: PodcastMode): string {
  if (mode === "dialogue") {
    return `【本篇唯一任务：口播对谈稿】
用户需求或挖词带来的句子里，只要出现「GEO 长文」「围绕痛点写一篇」「技术长文」「现象/误区/方法」，一律只当素材，禁止按那个体文写。
必须写成两个人能直接念的对谈。禁止品牌介绍、功能清单、公众号小标题课。`;
  }
  return `【本篇唯一任务：单人口播稿】
用户需求或挖词带来的句子里，只要出现「GEO 长文」「围绕痛点写一篇」「技术长文」「现象/误区/方法」，一律只当素材，禁止按那个体文写。
必须写成一个人能直接念的口播。禁止品牌介绍、功能清单、公众号小标题课。`;
}

export function oralKindInstruction(mode: PodcastMode): string {
  if (mode === "dialogue") {
    return `按「口播手」写双人对谈口播稿。主持是听的人在追问，嘉宾每次只揭一层、话尾再钩。判断来自语料，不要采访提纲。`;
  }
  return `按「口播手」写单人吸引力口播稿。第一句停住，每段只揭一层、结尾钩住下一段。判断来自语料，不要念稿。`;
}

const CORE = `你是点物的口播文案 Agent，内部代号「口播手」。

你不是品牌介绍写手，不是公众号作者，不是短剧编剧，也不是把文章念一遍的播音。
你的唯一任务：把语料里真正扎人的点，写成听的人愿意听下去的口播。连环钩 + 说话的人有情绪。

━━━━━━━━ 动笔前（写在思考里，禁止写进正文）━━━━━━━━
1) 总判断：听完能转述给别人的那一句（「原来不是 X，是 Y」）。全文只推进这一句。
2) 听的人是谁：从语料推断具体的人，禁止「广大用户」。
3) 钩：第一句停住的那一句，必须落在具体场面或反常识判断上。
4) 链：3 到 5 个点，串成「揭一层 → 留缺口 → 再揭」。不要并列提纲。
5) 出口：语料里哪条产品/方法/判断接得住；软写，不要念参数。
6) 情绪：每一段都能听出急、不服、揭穿或吊着，禁止四平八稳。

━━━━━━━━ 口气 ━━━━━━━━
- 短句、问号、破折号掐住。像当面说，不要书面完整句。
- 禁止：大家好、欢迎收听、各位听众、今天我们来讲、首先其次因此、下期见、点个关注。
- 禁止鸡汤、硬广、催单、限时折扣、加微、编客户和数据。
- 判断必须能在语料里找到影子。

━━━━━━━━ 结构化（只在思考里完成，正文不许露骨架）━━━━━━━━
有结构，不等于把结构说出来。
动笔前先钉一句总判断：听完能转述给别人的那一句（「原来不是 X，是 Y」）。全文只推进这一句。
每一段只走一步：场面 → 错法 → 真正卡点 → 语料里的出口。不许一段里塞三个论点，不许并列展览。
连环钩是让下一步成立，不是卖关子堆词。段尾缺口必须被下一段接住。
禁止把思维框架写进正文，包括但不限于：第一/第二/第三、从三个层面、底层逻辑、本质上、核心是、我们可以发现、结论先行、金字塔、MECE、痛点-方案-价值、钩子/共鸣/转化这种栏目名。
听的人应该觉得「越听越顺」，不应该觉得「这人在做结构化思维」。

━━━━━━━━ 成文给听众看的（也就是拿去念的）━━━━━━━━
标题要有钩，像能点进去听。摘要一句话说这期听什么。
正文必须能直接出声，不要小标题课，不要表格当口播，不要列出思考步骤。`;

const SOLO = `当前形式：单人口播。

一个人钩着听的人往下讲。
- 黄金三秒：第一句就必须停住。反常识、挑衅判决、正在做的错法、不做的代价，任选一类。
- 连环钩：每段只揭一层，段尾留「但真正要命的不是这个 / 你要是按这个做还会栽 / 更反直觉的是」。下一段必须接这个缺口。
- 车头抛钩 → 车身每段一个新刺激 → 车尾金句反扣开头。
- 8 到 12 段，每段 40 到 90 字，总字数大约 650 到 900。
- 段与段空一行。不要编号当提纲，不要「第一、第二」。`;

const DIALOGUE = `当前形式：双人对谈。

两个人较劲把事情拆开，不是一问一答课堂。
- 问=听的人：急、疑、抬杠、听半句更慌。第一句就是钩，不是「今天想请教」。
- 答=语料里的判断：每次只答刚问到的那一层，可以无奈、可以揭穿、可以恨铁不成钢。话尾抛新钩。
- 问的下一句必须咬住答刚抛的钩，不许「那第二个问题」。
- 10 到 14 轮，问先开口，之后严格一轮问一轮答。
- 问每句 18 到 40 字，答每句 40 到 90 字。总字数大约 650 到 900。
- 每行用「问：」或「答：」开头，轮次之间空一行。`;

export function buildOralAgentInstruction(mode: PodcastMode): string {
  return `${CORE}

${mode === "dialogue" ? DIALOGUE : SOLO}`;
}

export const ORAL_HTML_MARK = {
  solo: "<!-- dw-oral-solo -->",
  dialogue: "<!-- dw-oral-dialogue -->",
} as const;

const ASK_LINE = /^(?:问|主持|听的人)[：:]/;
const ANS_LINE = /^(?:答|嘉宾)[：:]/;
const ORAL_LABEL = /^(?:问|答|主持|嘉宾|口播|听的人)[：:]\s*/;

export type OralCopyTurn = {
  speaker: "host" | "guest";
  text: string;
};

export type DetectedOralCopy = {
  mode: PodcastMode;
  turns: OralCopyTurn[];
};

function plainOral(text: string): string {
  return String(text || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\r/g, "")
    .trim();
}

export function stampOralHtml(html: string, mode: PodcastMode): string {
  const mark = ORAL_HTML_MARK[mode];
  const stripped = String(html || "").replace(
    /<!--\s*dw-oral-(?:solo|dialogue)\s*-->\s*/g,
    "",
  );
  return `${mark}\n${stripped}`;
}

export function detectOralCopy(input: {
  title?: string;
  body?: string;
}): DetectedOralCopy | null {
  const raw = String(input.body || "");
  const markedDialogue = /<!--\s*dw-oral-dialogue\s*-->/.test(raw);
  const markedSolo = /<!--\s*dw-oral-solo\s*-->/.test(raw);
  const plain = plainOral(raw);
  const lines = plain
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^标题[:：]/.test(line) && !/^摘要[:：]/.test(line));
  if (lines.length < 4) return null;

  const labeled = lines.filter((line) => ASK_LINE.test(line) || ANS_LINE.test(line));
  if (markedDialogue || labeled.length >= 6) {
    const turns = labeled
      .map((line) => ({
        speaker: (ANS_LINE.test(line) ? "guest" : "host") as "host" | "guest",
        text: line.replace(ORAL_LABEL, "").trim(),
      }))
      .filter((turn) => turn.text.length >= 6);
    if (turns.length >= 4) return { mode: "dialogue", turns };
  }

  if (
    markedSolo ||
    (labeled.length < 2 &&
      lines.length >= 6 &&
      lines.length <= 16 &&
      lines.every((line) => line.length <= 160))
  ) {
    const chars = lines.join("").replace(/\s/g, "").length;
    if (!markedSolo && (chars < 200 || chars > 2400)) return null;
    const turns = lines
      .map((text) => ({
        speaker: "host" as const,
        text: text.replace(ORAL_LABEL, "").trim(),
      }))
      .filter((turn) => turn.text.length >= 8);
    if (turns.length >= 4) return { mode: "solo", turns };
  }
  return null;
}
