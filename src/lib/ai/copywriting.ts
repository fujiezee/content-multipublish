import {
  corpusAssetsHay,
  formatCorpusAssetsBlock,
  insertCorpusAssetsIntoHtml,
} from "@/lib/corpus-assets";
import { markdownToHtml } from "@/lib/content/markdown";
import {
  corpusAssetUrls,
  stripUnauthorizedCopyImages,
} from "@/lib/content/copy-images";
import { listCorpusItems } from "@/lib/db";
import { streamScriptLlm, completeScriptLlm } from "@/lib/ai/script-llm";
import {
  defaultCatalogSlug,
  listCatalogCopywritingModels,
} from "@/lib/ai/model-catalog/legacy";
import { stripBodyLabel } from "@/lib/ai/strip-body-label";
import type {
  CopywritingKind,
  CopywritingStyle,
  CorpusCategory,
  CorpusItem,
  MarketingAngle,
  PlatformFamily,
  PodcastMode,
  WriterAgent,
} from "@/lib/types";
import { COPYWRITING_KINDS, COPYWRITING_STYLES, CORPUS_CATEGORIES } from "@/lib/types";
import {
  buildMarketingAgentInstruction,
  marketingAngleLabel,
  resolveMarketingAngle,
} from "@/lib/ai/marketing-copy-agent";
import {
  buildOralAgentInstruction,
  oralKindInstruction,
  oralModeLabel,
  oralTaskLock,
  resolveOralMode,
  stampOralHtml,
} from "@/lib/ai/oral-copy-agent";
import {
  marketingKindInstruction,
  marketingTaskLock,
  stripForcedMarketingLock,
} from "@/lib/ai/marketing-copy-brief";
import {
  FAMILY_INSTRUCTIONS,
  defaultFamilyForKind,
  familyLabel,
  isPlatformFamily,
} from "@/lib/content/platform-families";
import {
  COPY_STRUCTURE_PROMPT,
  inspectCopyStructure,
  needsStructureRewrite,
  structureRewritePrompt,
} from "@/lib/ai/copy-structure";

import {
  cleanScriptTitle,
  looksLikeManualScriptTitle,
} from "@/lib/ai/script-title";

export {
  cleanScriptTitle,
  looksLikeManualScriptTitle,
  pickScriptTitle,
} from "@/lib/ai/script-title";

export type GenerateCopyInput = {
  kind: CopywritingKind;
  brief: string;
  categories?: CorpusCategory[];
  corpusIds?: string[];
  tone?: string;
  style?: CopywritingStyle;
  /** Distilled custom writer; overrides built-in style copy. */
  writerAgent?: Pick<WriterAgent, "name" | "hint" | "instruction">;
  /** Target platform family for tone / length. */
  family?: PlatformFamily;
  /** Catalog slug; default first ready copywriting model */
  modelSlug?: string;
  /** 营销文案路子：贩卖焦虑 / 贩卖期待。仅 kind=marketing 生效。 */
  marketingAngle?: MarketingAngle;
  /** 口播形式：单人 / 对谈。仅 kind=oral 生效。 */
  oralMode?: PodcastMode;
};

export type GeneratedCopy = {
  title: string;
  summary: string;
  scriptTitle?: string;
  bodyMarkdown: string;
  bodyHtml: string;
  usedCorpus: { id: string; title: string }[];
  thinking?: string;
  raw?: string;
};

export type CopyStreamEvent =
  | { type: "meta"; usedCorpus: { id: string; title: string }[]; model: string }
  | { type: "thinking"; delta: string }
  | { type: "content"; delta: string; replace?: boolean }
  | { type: "status"; message: string }
  | { type: "done"; result: GeneratedCopy }
  | { type: "error"; message: string };

const KIND_INSTRUCTIONS: Record<CopywritingKind, string> = {
  brand_intro:
    "写一段品牌介绍文案，突出定位、差异化与信任感。开篇落一句能转述的定位判断，后面只推进这一句；适合官网或媒体资料页，不要「第一第二」提纲。",
  product:
    "写产品/服务推广文案，突出核心卖点、适用人群与使用场景。可用小标题分段，小标题必须是判断句或场面，不要「卖点一/场景二」栏目。",
  marketing:
    "按所选营销路子写文案：先挖点，再让语料产品成为出口。禁止写成 GEO 科普长文或功能清单。",
  oral:
    "按口播手写成能直接念的口播稿：连环钩、说话带情绪。禁止公众号课、禁止念稿。",
  social:
    "写适合微博、小红书、朋友圈的短文案。口语化、有记忆点，控制在 300 字以内，可加适量 emoji。",
  article:
    "写一篇可直接投放的长文初稿：标题必须吸引人（具体、有判断，不要公文题，不要「N件事/系统性/结构化框架」目录题）；开篇先落一句读者能转述的总判断并点出收益；正文用 5-8 个小标题展开，每个小标题必须是判断句或具体场面，禁止「现象/误区/原理/方法/底层逻辑」栏目名，禁止「一、现象」「从三个层面」。每节只推进一步，写透、有例子与可执行要点；结尾把总判断收回来并给轻量行动。总字数必须落在 3000-5000 字（按中文字符计，不含标题），宁写满勿缩水；结构要有，骨架不许写在脸上。",
  slogan: "生成 5-8 条品牌 Slogan 或广告语备选，每条单独一行，附一句简短说明。",
  script_outline: `写一份给后面拆短剧用的总谱，不是公众号长文，不是口播课，也不是分集对白。
必须写清四块，用小标题：
1) 利害：压的是什么（名额、面子、把柄、站队），落在一件具体的事上。
2) 场上的人：2–4 个。每人只写身份、立场、知道什么、要什么、绝不做什么。用中性称呼（上级 / 被压的人 / 知情的人 / 搅局的）。
3) 分集拍：按第 1 集、第 2 集…列出。每集只推进一个冲突拍，写清开头的钩、中间打哪一下、集末留给下一集的钩。
4) 不要写逐句对白、镜头、花字（那是后面拆集的事）。
禁止写成皮：不要写死古装/职场/穿越/重生/系统/豪门/甜宠；不要用大人、臣、后宫、系统音、总裁、重生记忆这些演法词。后面会另选怎么演，这份大纲换皮还得能用。
总字数 1200–2200 字（按中文计），每集拍都要写完，禁止空提纲，禁止「本系列将讲述」。`,
};

function maxTokensForKind(
  kind: CopywritingKind,
  family?: PlatformFamily,
  hasWriter?: boolean,
): number {
  // reasoner 的思考和正文共用 max_tokens。篇幅跟文案类型走，不要被平台族带偏。
  let tokens = 32768;
  if (kind === "article") tokens = 32768;
  else if (kind === "script_outline") tokens = 16384;
  else if (kind === "oral" || kind === "social" || kind === "slogan") tokens = 8192;
  else if (kind === "marketing" && family === "social") tokens = 8192;
  else if (kind === "brand_intro" || kind === "product") {
    tokens = family === "social" ? 8192 : 16384;
  } else if (family === "short_video") tokens = 16384;
  // 蒸馏写手提示词很长，思考容易把额度吃光，正文变空。
  if (hasWriter && tokens < 16384) tokens = 16384;
  return tokens;
}

function copywritingModelFallback(): string {
  return (
    process.env.DEEPSEEK_REASONING_MODEL?.trim() ||
    process.env.DEEPSEEK_STREAM_MODEL?.trim() ||
    "deepseek-reasoner"
  );
}

function resolveCopywritingSlug(input: GenerateCopyInput): string {
  if (input.modelSlug?.trim()) return input.modelSlug.trim();
  return defaultCatalogSlug(
    "text",
    "copywriting",
    copywritingModelFallback(),
  );
}

export function listCopywritingModelOptions() {
  const catalog = listCatalogCopywritingModels();
  if (catalog.length) {
    return catalog.map((m) => ({
      id: m.slug,
      label: m.label,
      hint: m.hint,
      cost: m.costHint,
      ready: m.ready,
      badges: m.badges,
    }));
  }
  return [
    {
      id: copywritingModelFallback(),
      label: "DeepSeek 思考",
      hint: "环境变量默认",
      cost: "",
      ready: true,
      badges: ["recommended" as const],
    },
  ];
}

function looksTruncated(
  text: string,
  finishReason?: string,
  kind?: CopywritingKind,
): boolean {
  if (finishReason === "length") return true;
  const t = text.replace(/\s+$/u, "");
  if (t.length < 120) return false;
  // 口播/短内容段尾本来就会留钩、破折号、问号，不能当成截断去续写。
  if (kind === "oral" || kind === "social" || kind === "slogan") {
    return /[的了在与和及或把被从对]\s*$/u.test(t);
  }
  if (/[，、：:；;（(\-—]$/u.test(t)) return true;
  const last = t.split(/\n/).filter((line) => line.trim()).pop() || "";
  if (/^#{1,6}\s+\S/.test(last) && last.length < 40) return true;
  if (/第[一二三四五六七八九十\d]+[，、.、]?\s*$/u.test(last)) return true;
  if (last.length >= 12 && !/[。！？…」》】)）]$/u.test(last) && !/^[-*]\s/.test(last)) {
    return /[的了在与和及或把被从对]\s*$/u.test(last) || last.length > 40;
  }
  return false;
}

function continueCopyPrompt(raw: string): string {
  const last =
    raw
      .trim()
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() || "";
  return `上文在半句处被截断了。已经写出的最后一句是：
「${last.slice(-80)}」
请从这句之后接着写完。不要重复已写出的段落，不要重写标题和摘要，不要解释截断，不要问我要哪一句。直接续写正文。`;
}

function looksLikeContinueRefusal(text: string): boolean {
  return /没有看到之前|无法判断从哪|被截断处的最后一句|最后一句发给我|不重写标题和摘要/.test(
    text,
  );
}

const CORPUS_FACT_LOCK = `事实来源（任何风格都必须遵守，风格不能覆盖）：
- 风格只决定语气、节奏、句式和结构，不决定写什么事实。
- 必须把下面语料里已经有的定位、产品、方法、案例或观点写进正文，用所选风格重新说；不能写成和语料无关的通用鸡汤、自我提升或行业空话。
- 语料里出现的品牌名、产品名、方法名，正文里要能看出来用上了（软写即可，不要硬广催单）。
- 不得编造语料中不存在的公司名、数据、客户案例、域名或资质（包括点物、dianwu.ai，除非语料里有）。`;

const CORPUS_IMAGE_LOCK = `- 语料配图必须写进正文：只用下面给出的 Markdown 图片，URL 一字不改。截图说明是图里有什么，插在讲到该事实的段落后。禁止丢掉这些配图。
- 禁止另写任何图片：不要编造 ![ ](url)、不要写 /public/、../public/、相对路径、占位图、示例图或示意图。正文里除给定语料图外不得出现其他图片。`;

const CORPUS_NO_FAKE_IMAGES = `- 禁止编造配图：不得插入语料未给出的 Markdown 图片、HTML 图片、/public/ 路径、相对路径或占位图。没有给定 URL 就不要插图。`;

const STYLE_INSTRUCTIONS: Record<CopywritingStyle, string> = {
  default:
    "专业、真诚、有温度，避免空洞形容词堆砌。结构藏在推进里：一句总判断，每段进一步；不要列一二三当提纲，不要把「现象/原理/方法」写成小标题。事实仍必须来自语料。",
  dan_koe: `模仿 Dan Koe（thedankoe）的写作气质，但必须用中文输出（专有名词可保留英文）：
- 开篇用一句强断言/原则句抓住注意力，而不是铺垫故事。
- 多用短句与单句成段，节奏干净，像「写给自己的笔记」。
- 少用套话与模糊词（很、非常、赋能、助力等）；主动语态，观点鲜明。
- 从身份与高能动（agency）切入：不是教人技巧清单，而是重塑读者如何看待自己与选择。
- 推进可参考：问题诊断 → 放大后果 → 给出可执行的新视角；不要把这三步写成小标题。CTA 轻、不硬推。
- 排版留白感强，避免 emoji 堆砌与鸡汤空话。
- 气质学他，落点必须落在语料里的产品/方法/选择上，不要写成和品牌无关的英文自我管理文。`,
  jinqiang: `模仿广告鬼才「金枪大叔」（岳华平）的口播/文案气质，必须用中文输出：
- 人设口吻：30 年广告老炮替中小老板说真话——不正经的智者，敢揭穿套路，不装专家腔。
- 黄金三秒起手，任选一类钩子：
  1) 挑衅判决：「X 可以开除了 / X 都混不下去了」；
  2) 反向常识：「X 不重要，Y 才重要 / 没有 X 就没有 Y」；
  3) 排比反问：连续 3–5 个「为啥你…？」把共鸣叠到峰值再给出口；
  4) 反讽断言：把公认事实倒过来说。
- 语言：口语 + 江湖味儿，像单口相声而不是领导发言；可用「忽悠」「三板斧」「跑江湖」这类烟火词，抖包袱，忌「品牌调性」「用户画像」「赋能」等空术语。
- 结构用「小火车 + 反扣」：车头抛反常识判断 → 车身每几句一个新刺激（类比/自嘲/真实场景/行业反讽）→ 车尾金句反扣开头。
- 核心招式：分类列举（三板斧、十六字诊断这类可转述判断）；提炼「语言钉」——短、浅、好记、可重复（如 Boss 直聘式致命卖点），效果优先于逼格。
- 价值落点：帮读者少被忽悠、敢做生意；解气但不人身攻击。
- 钩子和语言钉必须钉在语料里的产品/方法/误区上，不得编造客户案例或数据。`,
  lijiaoshou: `模仿「李叫兽」式认知营销文案气质，必须用中文输出：
- 开篇先抛一个「大多数人以为…其实…」的认知冲突，而不是堆卖点或鸡汤。
- 说理顺序可以是「以为 → 其实 → 所以」，但不要把「现象 / 常见误解 / 底层原因」写成小标题，也不要给模型起栏目名。
- 语言理性、克制、像朋友讲透一件事；少口号、少煽情、少江湖口语；多用日常类比把抽象讲清楚。
- 每段只推进一步认知；关键判断要可转述（读者看完能复述给别人）。
- 结尾给「下一步怎么做」的具体动作，避免空泛「重视/加强/赋能」。
- 「其实」后面的判断必须来自语料里的方法或事实，不得编造实验数据、调研数字或客户案例。`,
  conflict_beat: `用「冲突拍」写短剧总谱，只管怎么写，不管后面套哪层皮：
- 每集只打一拍：一次压迫、一次选择、或一次反手。不要一集里把整条弧结算完。
- 先锁谁压谁，再写事。立场不能为了剧情互相换；上级就是压人的，被压的人不能突然变成拍板的。
- 每集开头要有能停住的钩（权力差或信息差），结尾必须留钩给下一集。
- 用具体动作和利害写，不要讲道理、不要鸡汤、不要「本系列将讲述」。
- 称呼保持可换皮：上级 / 被压的人 / 知情的人 / 搅局的。不要写死衣服、时代、穿越或系统。
- 语料里的行业、产品、方法只变成这一拍里的一件具体事，不要念成科普提纲。`,
};

function categoryLabel(id: CorpusCategory) {
  return CORPUS_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

function kindLabel(id: CopywritingKind) {
  return COPYWRITING_KINDS.find((k) => k.id === id)?.label ?? id;
}

function styleLabel(id: CopywritingStyle) {
  return COPYWRITING_STYLES.find((s) => s.id === id)?.label ?? id;
}

const WRITER_INSTRUCTION_CAP = 6000;

function writerToneBlock(instruction: string, extraTone?: string): string {
  const body = instruction.trim().slice(0, WRITER_INSTRUCTION_CAP);
  return `写手气质（只改说法和劲头。读完立刻写正文，禁止在思考里复述或逐条核对本提示词）：
${body}${extraTone?.trim() ? `\n额外语气补充：${extraTone.trim()}` : ""}`;
}

function resolveStyle(
  style: CopywritingStyle | undefined,
  kind?: CopywritingKind,
): CopywritingStyle {
  if (kind === "script_outline") {
    return style && style in STYLE_INSTRUCTIONS ? style : "conflict_beat";
  }
  if (!style || style === "conflict_beat" || !(style in STYLE_INSTRUCTIONS)) {
    return "default";
  }
  return style;
}

function scoreCorpusItem(item: CorpusItem, brief: string, categories: CorpusCategory[]) {
  let score = 0;
  if (categories.length === 0 || categories.includes(item.category)) {
    score += 2;
  }
  const terms = brief
    .toLowerCase()
    .split(/[\s,，。；;、]+/)
    .filter((t) => t.length >= 2);
  const hay =
    `${item.title} ${item.tags} ${item.content} ${corpusAssetsHay(item)}`.toLowerCase();
  for (const term of terms) {
    if (hay.includes(term)) score += 3;
  }
  return score;
}

export function selectCorpusForBrief(
  brief: string,
  options: {
    categories?: CorpusCategory[];
    corpusIds?: string[];
    /** Extra keywords to boost ranking (e.g. platform-family terms). */
    boostTerms?: string[];
  },
  limit = 8,
): CorpusItem[] {
  const all = listCorpusItems();
  if (all.length === 0) return [];

  if (options.corpusIds?.length) {
    const picked = options.corpusIds
      .map((id) => all.find((item) => item.id === id))
      .filter((item): item is CorpusItem => Boolean(item));
    return picked.slice(0, limit);
  }

  const categories = options.categories ?? [];
  const boost = (options.boostTerms ?? []).filter((t) => t.trim().length >= 2);
  const scoredBrief =
    boost.length > 0 ? `${brief}\n${boost.join(" ")}` : brief;

  return [...all]
    .map((item) => {
      let score = scoreCorpusItem(item, scoredBrief, categories);
      const hay =
        `${item.title} ${item.tags} ${item.content} ${corpusAssetsHay(item)}`.toLowerCase();
      for (const term of boost) {
        if (hay.includes(term.toLowerCase())) score += 2;
      }
      return { item, score };
    })
    .filter((row) => row.score > 0 || categories.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.item);
}

export function buildCorpusContext(
  items: CorpusItem[],
  options?: { images?: "markdown" | "caption" | "none" },
) {
  if (items.length === 0) {
    return "（语料库暂无相关内容，请基于用户需求合理发挥，但不要编造具体数据或客户名称。）";
  }
  const images = options?.images ?? "caption";
  return items
    .map((item, i) => {
      const text =
        item.content.trim() ||
        (item.assets?.length
          ? "（这条语料以配图为主，按图下说明理解）"
          : "");
      const assets =
        images === "none" ? "" : formatCorpusAssetsBlock(item, images);
      return `### 语料 ${i + 1}：${item.title}（${categoryLabel(item.category)}）\n${text}${
        assets ? `\n\n${assets}` : ""
      }`;
    })
    .join("\n\n");
}

function embedCorpusImages(kind?: CopywritingKind) {
  return (
    kind === "article" ||
    kind === "product" ||
    kind === "brand_intro" ||
    kind === "marketing"
  );
}

const MARKETING_CORPUS_BOOST = [
  "产品",
  "功能",
  "客户",
  "场景",
  "痛点",
  "案例",
  "方法",
  "使用",
  "解决",
  "老板",
  "用户",
];

const COPY_OUTPUT_FORMAT = `输出格式（严格遵守）：
第一行：标题: （一行能停住的完整标题，不要说明书式，不要卡在二十字）
第二行：摘要: （50字以内摘要）
第三行：剧本名: （必填，≤16字，像抖音合集名，短、狠、像一句话钩子。禁止指南/攻略/五步/从0到1/全面解析/手册，不要说明书，不要照抄标题，不要写「短视频系列」）
空一行后直接输出 Markdown 正文，不要写「正文:」「正文：」等标签。
对比、对照、分档、清单优先用 Markdown 表格（表头下一行必须是 | --- | --- |），不要把表格写成普通段落。
${COPY_STRUCTURE_PROMPT}
必须写完整并收束：每个分点/档位都要写完，禁止停在半截句子、未写完的步骤或小标题后没有正文。`;

const ORAL_OUTPUT_FORMAT = `输出格式（严格遵守）：
第一行：标题: （能停住的口播标题，有钩，不要说明书）
第二行：摘要: （50字以内，说这期听什么）
空一行后直接输出可念的口播正文，不要写「正文:」标签，不要小标题课，不要表格，不要 emoji。
不要写出「钩子/痛点/方案」「第一第二」「三个层面」这种栏目。结构只体现在越听越顺。
篇幅以口播手为准（约 650–900 字），不要压成小红书短帖，也不要写成公众号长文。
必须写完整并收束：最后把钩收回成一句能记住的判断。`;

function familyWritingOverride(
  family: PlatformFamily,
  kind: CopywritingKind,
  extra: {
    marketing: boolean;
    oral: boolean;
    oralLabel: string;
    marketingLabel: string;
  },
): string {
  const tone = familyLabel(family);
  if (kind === "script_outline") {
    return `平台调性（必须遵守）：
${FAMILY_INSTRUCTIONS.short_video}`;
  }
  if (extra.oral) {
    return `平台调性：只借「${tone}」的口气松紧，不借它的篇幅和体裁。
口播覆盖（高于平台族，必须遵守）：
- 忽略本族总字数、小标题数量、emoji、行动号召、短剧总谱。
- 篇幅只跟口播手：约 650–900 字。单人 8–12 段，对谈 10–14 轮。
- 禁止压成社媒 150–400 字短帖，禁止写成 2000 字以上的课或长文。
- 必须能直接念。本篇只走${extra.oralLabel}。`;
  }
  if (kind === "social") {
    return `平台调性：只借「${tone}」的口气，不借长文/总谱篇幅。
短帖覆盖：控制在 300 字以内，口语、有钩，可适量 emoji。忽略 2000 字以上和小标题课。`;
  }
  if (kind === "slogan") {
    return `平台调性：只借「${tone}」的口气。
标语覆盖：生成 5–8 条 Slogan，每条单独一行并附一句说明。忽略一切总字数和小标题要求。`;
  }
  if (kind === "article") {
    return `平台调性：只借「${tone}」的口气和标题习惯，不借短帖/总谱篇幅。
长文覆盖：总字数仍 3000–5000，5–8 个判断句小标题。不要压成 150–400 字，不要写成短剧总谱。`;
  }
  if (kind === "brand_intro") {
    return `平台调性：只借「${tone}」的口气。
品牌介绍覆盖：写一段约 400–1200 字的介绍，不要 5–8 个小标题长文，不要短剧总谱，也不要压成 150 字短帖。`;
  }
  if (kind === "product") {
    return `平台调性：只借「${tone}」的口气。
产品文案覆盖：约 600–1800 字，可用判断句小标题。忽略 3000 字课、150 字短帖和短剧总谱。`;
  }
  if (extra.marketing) {
    const lengthFamily = family === "short_video" ? "wechat" : family;
    return `平台调性（必须遵守）：
${FAMILY_INSTRUCTIONS[lengthFamily]}

营销文案覆盖：篇幅跟「${familyLabel(lengthFamily)}」走，但禁止按技术长文 / GEO 长文的现象-误区-方法写，禁止写成短剧总谱。本篇只走${extra.marketingLabel}。仍禁止催单、折扣、加微、编造数据。`;
  }
  return `平台调性（必须遵守）：
${FAMILY_INSTRUCTIONS[family]}`;
}

export function buildCopywritingMessages(input: GenerateCopyInput) {
  const marketing = input.kind === "marketing";
  const oral = input.kind === "oral";
  const brief = stripForcedMarketingLock(input.brief);
  if (!brief && !marketing && !oral) {
    throw new Error("请描述你想写什么文案");
  }

  const angle = marketing ? resolveMarketingAngle(input.marketingAngle) : null;
  const talk = oral ? resolveOralMode(input.oralMode) : null;

  const corpus = selectCorpusForBrief(brief, {
    categories: input.categories,
    corpusIds: input.corpusIds,
    boostTerms: marketing || oral ? MARKETING_CORPUS_BOOST : undefined,
  });

  const style = resolveStyle(input.style, input.kind);
  const extraTone = input.tone?.trim();
  const writer = input.writerAgent;
  const styleName = writer?.name?.trim() || styleLabel(style);
  const toneLine = writer?.instruction?.trim()
    ? writerToneBlock(writer.instruction, extraTone)
    : style === "default"
      ? extraTone || STYLE_INSTRUCTIONS.default
      : `${STYLE_INSTRUCTIONS[style]}${extraTone ? `\n额外语气补充：${extraTone}` : ""}`;

  const outline = input.kind === "script_outline";
  const factLock = embedCorpusImages(input.kind)
    ? `${CORPUS_FACT_LOCK}\n${CORPUS_IMAGE_LOCK}`
    : `${CORPUS_FACT_LOCK}\n${CORPUS_NO_FAKE_IMAGES}`;

  let system: string;
  if (outline) {
    system = `你是竖屏短剧的大纲编剧，不是品牌文案，也不是分集对白编剧。先读语料，再写成能换皮的总谱。
写作风格：${styleName}
语气与节奏（只改说法，不改事实）：
${toneLine}

${factLock}
只写戏骨，不写皮。利害、谁压谁、每集一拍、集末留钩。不要写死古装/职场/穿越/重生/系统，不要写逐句对白和镜头。
标题要像短剧合集能停住的那一句，具体、有冲突，不要公文题，不要「浅谈/全面解析」。
输出格式（严格遵守）：
第一行：标题: （一行能停住的完整标题）
第二行：摘要: （50字以内，只说利害和冲突，不说题材皮）
第三行：剧本名: （必填，≤16字，像抖音合集名，短、狠。禁止指南/攻略/五步，不要照抄标题）
空一行后直接输出 Markdown 正文，不要写「正文:」标签。
必须写完整：每集拍都要有钩、一击、留钩，禁止空提纲或停在半截。`;
  } else if (marketing && angle) {
    system = `${marketingTaskLock(angle)}

${buildMarketingAgentInstruction(angle)}

气质可以叠用户选的写作风格或蒸馏写手，但挖点、对点、路子不能被风格盖掉。风格只改说法和节奏，不改点，不编事实。路子以文件最上方的「本篇唯一路子」为准，禁止写成另一条路子。
写作风格：${styleName}
语气与节奏（只改说法，不改事实）：
${toneLine}

${factLock}
${angle === "hope" ? "本篇只许把期待写透。" : "本篇只许把代价写透。"}仍禁止催单、限时折扣、加微留资、招商加盟、立即下单、编造成交数字。品牌名、产品、官网只许引用语料里已有的。
标题钉在主点上：具体、有判断或反差，把那句话说完整。常见 16–40 字都可以。不要公文题、目录题、空泛题，不要「必火/躺赚/震惊」。
${COPY_OUTPUT_FORMAT}`;
  } else if (oral && talk) {
    system = `${oralTaskLock(talk)}

${buildOralAgentInstruction(talk)}

气质可以叠用户选的写作风格或蒸馏写手，但口播结构、连环钩、段数和总字数不能被风格盖掉。风格只改说法和劲头，不改成公众号课，不编事实，不要把金枪「三板斧」或李叫兽模型写成栏目。
写作风格：${styleName}
语气与节奏（只改说法，不改事实）：
${toneLine}

${factLock}
本篇只许写成能直接念的${oralModeLabel(talk)}。禁止欢迎收听、大家好、功能清单、小标题科普。
${ORAL_OUTPUT_FORMAT}`;
  } else {
    system = `你是资深品牌文案顾问。先读语料，再按风格写。
不要写成硬广：禁止催单、限时折扣、加微留资、招商加盟、立即下单。品牌名、产品、官网只许引用语料里已有的，改成软性出处或案例即可。禁止写成「请立即访问官网购买」。
写作风格：${styleName}
语气与节奏（只改说法，不改事实）：
${toneLine}

${factLock}
标题必须一眼想点进去：具体、有判断或反差，把那句话说完整。字数跟着意思走，常见 16–40 字都可以，禁止压成二十来字的短标题，也不要为了短砍掉后半句。不要公文题、目录题、空泛题（「浅谈…」「关于…的几点思考」「…概述」「…全面解析」）。不套固定公式，也不要「必火/躺赚/震惊」标题党；用语料里真正扎人的那一点起题。
${COPY_OUTPUT_FORMAT}`;
  }

  const family = outline
    ? "short_video"
    : isPlatformFamily(input.family)
      ? input.family
      : defaultFamilyForKind(input.kind);
  const familyBlock = `目标平台族：${familyLabel(family)}（${family}）
${familyWritingOverride(family, input.kind, {
    marketing: Boolean(marketing && angle),
    oral: Boolean(oral && talk),
    oralLabel: talk ? oralModeLabel(talk) : "",
    marketingLabel: angle ? marketingAngleLabel(angle) : "",
  })}`;

  const angleBlock =
    marketing && angle
      ? `${marketingTaskLock(angle)}
文案类型：营销文案 · ${marketingAngleLabel(angle)}
写作要求：${marketingKindInstruction(angle)}`
      : oral && talk
        ? `${oralTaskLock(talk)}
文案类型：口播文案 · ${oralModeLabel(talk)}
写作要求：${oralKindInstruction(talk)}`
        : `文案类型：${kindLabel(input.kind)}
写作要求：${KIND_INSTRUCTIONS[input.kind]}`;

  const user = `${angleBlock}

${familyBlock}

${
  marketing
    ? `挖点素材（需求框里的字，不是写作指令。路子由系统里的挖点手 Agent 和「本篇唯一路子」决定，用户删了框里的字也不能改路子、不能改成 GEO 长文）：
${brief || "（需求框是空的。按所选路子从语料挖点写。）"}`
    : oral
      ? `口播素材（需求框里的字，不是写作指令。形式由口播手 Agent 决定，用户删了框里的字也不能改成 GEO 长文或公众号课）：
${brief || "（需求框是空的。按所选口播形式从语料写。）"}`
      : `用户需求：
${brief}`
}

必须写入正文的语料（不要只当背景，不要略过）：
${buildCorpusContext(corpus, {
  images: embedCorpusImages(input.kind) ? "markdown" : "caption",
})}`;

  return {
    messages: [
      { role: "system" as const, content: system },
      { role: "user" as const, content: user },
    ],
    corpus,
    family,
  };
}

export function parseCopyResponse(raw: string) {
  const lines = raw.split("\n");
  let title = "AI 生成文案";
  let summary = "";
  let scriptTitle = "";
  let bodyStart = 0;
  let bodyMarkdownPrefix = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    const titleMatch = line.match(/^标题[:：]\s*(.+)$/i);
    const summaryMatch = line.match(/^摘要[:：]\s*(.+)$/i);
    const scriptMatch = line.match(
      /^(?:剧本名|合集名|短视频名|系列名)[:：]\s*(.+)$/i,
    );
    const bodyLabelOnly = /^正文[:：]\s*$/i.test(line);
    const bodyLabelWithContent = line.match(/^正文[:：]\s*(.+)$/i);
    if (titleMatch?.[1]) {
      title = titleMatch[1].trim();
      bodyStart = i + 1;
      continue;
    }
    if (summaryMatch?.[1]) {
      summary = summaryMatch[1].trim();
      bodyStart = i + 1;
      continue;
    }
    if (scriptMatch?.[1]) {
      scriptTitle = scriptMatch[1].replace(/\s+/g, " ").trim().slice(0, 16);
      bodyStart = i + 1;
      continue;
    }
    if (bodyLabelOnly) {
      bodyStart = i + 1;
      continue;
    }
    if (bodyLabelWithContent?.[1]) {
      bodyMarkdownPrefix = bodyLabelWithContent[1].trim();
      bodyStart = i + 1;
      continue;
    }
    if (title !== "AI 生成文案" && summary && scriptTitle && line === "") {
      bodyStart = i + 1;
      break;
    }
    if (title !== "AI 生成文案" && summary && line === "") {
      bodyStart = i + 1;
      break;
    }
  }

  let bodyMarkdown = lines.slice(bodyStart).join("\n").trim();
  if (bodyMarkdownPrefix) {
    bodyMarkdown = bodyMarkdownPrefix + (bodyMarkdown ? `\n${bodyMarkdown}` : "");
  }
  bodyMarkdown = stripBodyLabel(bodyMarkdown);
  bodyMarkdown = bodyMarkdown.replace(/^剧本名[:：]\s*.+\n*/m, "").trim();
  if (!bodyMarkdown) {
    bodyMarkdown = raw.trim();
  }

  if (title === "AI 生成文案") {
    const h1 = bodyMarkdown.match(/^#\s+(.+)/m);
    if (h1?.[1]) title = h1[1].trim();
  }

  return { title, summary, scriptTitle, bodyMarkdown };
}

export async function suggestScriptTitle(input: {
  title: string;
  summary?: string;
  brief?: string;
}): Promise<string> {
  const title = input.title.trim();
  const fallback = title.replace(/[《》「」""]/g, "").slice(0, 16);
  try {
    const raw = await completeScriptLlm(
      [
        {
          role: "system",
          content:
            "你给抖音短视频合集起名。只输出一个名字，不超过16个中文。要短、狠，像能停住划走的合集名，不要说明书。禁止指南、攻略、手册、教程、五步、从0到1、全面解析。不要书名号，不要解释，不要标点收尾。",
        },
        {
          role: "user",
          content: `文章标题：${title || "未命名"}
摘要：${(input.summary || "").slice(0, 80)}
需求：${(input.brief || "").slice(0, 200)}`,
        },
      ],
      {
        model: "deepseek-chat",
        temperature: 0.7,
        maxTokens: 64,
        timeoutMs: 20_000,
      },
    );
    const name = cleanScriptTitle(raw);
    if (name && !looksLikeManualScriptTitle(name)) return name;
    const retry = await completeScriptLlm(
      [
        {
          role: "system",
          content:
            "上一版像说明书。重起一个抖音合集名，≤16字，只要钩子，不要指南/攻略/步骤。只输出名字。",
        },
        {
          role: "user",
          content: `文章标题：${title || "未命名"}
摘要：${(input.summary || "").slice(0, 80)}
失败名：${name || fallback}`,
        },
      ],
      {
        model: "deepseek-chat",
        temperature: 0.8,
        maxTokens: 64,
        timeoutMs: 20_000,
      },
    );
    const next = cleanScriptTitle(retry);
    if (next && !looksLikeManualScriptTitle(next)) return next;
    return looksLikeManualScriptTitle(fallback) ? "" : fallback;
  } catch {
    return fallback;
  }
}

const SCRIPT_OUTLINE_MARK = "<!-- script-outline -->";

function stampScriptOutline(
  result: GeneratedCopy,
  kind: CopywritingKind,
): GeneratedCopy {
  if (kind !== "script_outline") return result;
  if (result.bodyHtml.includes(SCRIPT_OUTLINE_MARK)) return result;
  return {
    ...result,
    bodyHtml: `${SCRIPT_OUTLINE_MARK}\n${result.bodyHtml}`,
  };
}

function withOralStamp(
  result: GeneratedCopy,
  input: GenerateCopyInput,
): GeneratedCopy {
  if (input.kind !== "oral") return result;
  const mode = resolveOralMode(input.oralMode);
  return {
    ...result,
    bodyHtml: stampOralHtml(result.bodyHtml, mode),
    bodyMarkdown: stampOralHtml(result.bodyMarkdown, mode),
  };
}

type CopyLlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function skeletonIssuesForRaw(raw: string, kind: CopywritingKind) {
  const parsed = parseCopyResponse(raw);
  return inspectCopyStructure(parsed.bodyMarkdown || raw, kind);
}

async function rewriteSkeletonCopy(input: {
  messages: CopyLlmMessage[];
  raw: string;
  kind: CopywritingKind;
  model: string;
  maxTokens: number;
}): Promise<string> {
  const issues = skeletonIssuesForRaw(input.raw, input.kind);
  if (input.kind === "oral" || !needsStructureRewrite(issues, input.kind)) {
    return input.raw;
  }
  const rewritten = await completeScriptLlm(
    [
      ...input.messages,
      { role: "assistant", content: input.raw },
      { role: "user", content: structureRewritePrompt(issues) },
    ],
    {
      model: input.model,
      temperature: 0.6,
      maxTokens: input.maxTokens,
      timeoutMs: input.maxTokens >= 8192 ? 240_000 : 120_000,
    },
  );
  return rewritten.trim() ? rewritten : input.raw;
}

export async function finalizeGeneratedCopy(
  raw: string,
  corpus: CorpusItem[],
  thinking?: string,
  kind?: CopywritingKind,
): Promise<GeneratedCopy> {
  const parsed = parseCopyResponse(raw);
  const allowedImages = embedCorpusImages(kind) ? corpusAssetUrls(corpus) : [];
  const bodyMarkdown = stripUnauthorizedCopyImages(
    parsed.bodyMarkdown,
    allowedImages,
  );
  let bodyHtml = markdownToHtml(bodyMarkdown);
  if (embedCorpusImages(kind)) {
    bodyHtml = insertCorpusAssetsIntoHtml(bodyHtml, corpus);
  }
  bodyHtml = stripUnauthorizedCopyImages(bodyHtml, allowedImages);
  const scriptTitle =
    parsed.scriptTitle ||
    (await suggestScriptTitle({
      title: parsed.title,
      summary: parsed.summary,
    }));

  return {
    title: parsed.title,
    summary: parsed.summary,
    scriptTitle: scriptTitle || undefined,
    bodyMarkdown,
    bodyHtml,
    usedCorpus: corpus.map((c) => ({ id: c.id, title: c.title })),
    thinking: thinking?.trim() || undefined,
    raw,
  };
}

export async function* streamBrandCopy(
  input: GenerateCopyInput,
  options?: { signal?: AbortSignal },
): AsyncGenerator<CopyStreamEvent> {
  const { messages, corpus, family } = buildCopywritingMessages(input);
  const usedCorpus = corpus.map((c) => ({ id: c.id, title: c.title }));

  const model = resolveCopywritingSlug(input);
  yield {
    type: "meta",
    usedCorpus,
    model,
  };

  let thinking = "";
  let content = "";
  let finishReason = "";
  const hasWriter = Boolean(input.writerAgent?.instruction?.trim());
  const maxTokens = maxTokensForKind(input.kind, family, hasWriter);
  const longForm = maxTokens >= 4096;

  try {
    for await (const chunk of streamScriptLlm(messages, {
      model,
      temperature: 0.75,
      maxTokens,
      timeoutMs: longForm ? 300_000 : 180_000,
      signal: options?.signal,
    })) {
      if (chunk.type === "thinking") {
        thinking += chunk.text;
        yield { type: "thinking", delta: chunk.text };
      } else if (chunk.type === "content") {
        content += chunk.text;
        yield { type: "content", delta: chunk.text };
      } else if (chunk.type === "finish") {
        finishReason = chunk.reason;
      }
    }

    if (!content.trim()) {
      yield {
        type: "status",
        message: "思考占满了输出额度，正在直接写正文…",
      };
      for await (const chunk of streamScriptLlm(
        [
          ...messages,
          {
            role: "user",
            content:
              "上一轮只在思考、正文是空的。不要再过风格栏目和自检。从「标题:」开始直接输出完整文案，必须写完。",
          },
        ],
        {
          model,
          temperature: 0.7,
          maxTokens: Math.max(maxTokens, 16384),
          timeoutMs: 240_000,
          signal: options?.signal,
          thinkingEffort: "low",
        },
      )) {
        if (chunk.type === "thinking") {
          thinking += chunk.text;
          yield { type: "thinking", delta: chunk.text };
        } else if (chunk.type === "content") {
          content += chunk.text;
          yield { type: "content", delta: chunk.text };
        } else if (chunk.type === "finish") {
          finishReason = chunk.reason;
        }
      }
    }

    if (!content.trim()) {
      yield {
        type: "error",
        message:
          "正文是空的。蒸馏写手的提示词会把思考额度占满。请再点一次生成，或把写稿模型换成「DeepSeek 对话」。",
      };
      return;
    }

    if (longForm && looksTruncated(content, finishReason, input.kind)) {
      yield {
        type: "status",
        message: "正文未写完，正在从断开处续写…",
      };
      let continued = "";
      for await (const chunk of streamScriptLlm(
        [
          ...messages,
          { role: "assistant" as const, content },
          { role: "user" as const, content: continueCopyPrompt(content) },
        ],
        {
          model,
          temperature: 0.6,
          maxTokens,
          timeoutMs: 240_000,
          signal: options?.signal,
        },
      )) {
        if (chunk.type === "content") continued += chunk.text;
      }
      if (continued.trim() && !looksLikeContinueRefusal(continued)) {
        content += continued;
        yield { type: "content", delta: continued };
      }
    }

    const issues = skeletonIssuesForRaw(content, input.kind);
    if (
      input.kind !== "oral" &&
      needsStructureRewrite(issues, input.kind)
    ) {
      yield {
        type: "status",
        message: "结构露在脸上了，正在把骨架藏进节奏里重写…",
      };
      let rewritten = "";
      for await (const chunk of streamScriptLlm(
        [
          ...messages,
          { role: "assistant", content },
          { role: "user", content: structureRewritePrompt(issues) },
        ],
        {
          model,
          temperature: 0.6,
          maxTokens,
          timeoutMs: 240_000,
          signal: options?.signal,
        },
      )) {
        if (chunk.type === "thinking") {
          thinking += chunk.text;
          yield { type: "thinking", delta: chunk.text };
        } else if (chunk.type === "content") {
          rewritten += chunk.text;
        }
      }
      if (rewritten.trim()) {
        content = rewritten;
        yield { type: "content", delta: rewritten, replace: true };
      }
    }

    const result = stampScriptOutline(
      withOralStamp(
        await finalizeGeneratedCopy(content, corpus, thinking, input.kind),
        input,
      ),
      input.kind,
    );
    yield { type: "done", result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: "error", message };
  }
}

export async function generateBrandCopy(
  input: GenerateCopyInput,
): Promise<GeneratedCopy> {
  const { messages, corpus, family } = buildCopywritingMessages(input);
  const hasWriter = Boolean(input.writerAgent?.instruction?.trim());
  const maxTokens = maxTokensForKind(input.kind, family, hasWriter);
  const model = resolveCopywritingSlug(input);
  let raw = await completeScriptLlm(messages, {
    model,
    temperature: 0.75,
    maxTokens,
    timeoutMs: maxTokens >= 8192 ? 240_000 : 120_000,
  });
  if (!raw.trim()) {
    raw = await completeScriptLlm(
      [
        ...messages,
        {
          role: "user",
          content:
            "上一轮只在思考、正文是空的。不要再过风格栏目和自检。从「标题:」开始直接输出完整文案，必须写完。",
        },
      ],
      {
        model,
        temperature: 0.7,
        maxTokens: Math.max(maxTokens, 16384),
        timeoutMs: 240_000,
        thinkingEffort: "low",
      },
    );
  }
  if (!raw.trim()) {
    throw new Error(
      "正文是空的。蒸馏写手的提示词会把思考额度占满。请再点一次生成，或把写稿模型换成「DeepSeek 对话」。",
    );
  }
  if (maxTokens >= 4096 && looksTruncated(raw, undefined, input.kind)) {
    const continued = await completeScriptLlm(
      [
        ...messages,
        { role: "assistant", content: raw },
        {
          role: "user",
          content: continueCopyPrompt(raw),
        },
      ],
      {
        model,
        temperature: 0.6,
        maxTokens,
        timeoutMs: 240_000,
      },
    );
    if (continued.trim() && !looksLikeContinueRefusal(continued)) {
      raw = `${raw}${continued}`;
    }
  }
  raw = await rewriteSkeletonCopy({
    messages,
    raw,
    kind: input.kind,
    model,
    maxTokens,
  });
  return stampScriptOutline(
    withOralStamp(
      await finalizeGeneratedCopy(raw, corpus, undefined, input.kind),
      input,
    ),
    input.kind,
  );
}
