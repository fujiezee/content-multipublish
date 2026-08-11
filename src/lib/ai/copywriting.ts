import { marked } from "marked";
import { listCorpusItems } from "@/lib/db";
import { chatCompletion, streamChatCompletion } from "@/lib/ai/deepseek";
import { stripBodyLabel } from "@/lib/ai/strip-body-label";
import type {
  CopywritingKind,
  CopywritingStyle,
  CorpusCategory,
  CorpusItem,
  PlatformFamily,
} from "@/lib/types";
import { COPYWRITING_KINDS, COPYWRITING_STYLES, CORPUS_CATEGORIES } from "@/lib/types";
import {
  FAMILY_INSTRUCTIONS,
  defaultFamilyForKind,
  familyLabel,
  isPlatformFamily,
} from "@/lib/content/platform-families";

marked.setOptions({ gfm: true, breaks: true });

export type GenerateCopyInput = {
  kind: CopywritingKind;
  brief: string;
  categories?: CorpusCategory[];
  corpusIds?: string[];
  tone?: string;
  style?: CopywritingStyle;
  /** Target platform family for tone / length. */
  family?: PlatformFamily;
};

export type GeneratedCopy = {
  title: string;
  summary: string;
  bodyMarkdown: string;
  bodyHtml: string;
  usedCorpus: { id: string; title: string }[];
  thinking?: string;
  raw?: string;
};

export type CopyStreamEvent =
  | { type: "meta"; usedCorpus: { id: string; title: string }[]; model: string }
  | { type: "thinking"; delta: string }
  | { type: "content"; delta: string }
  | { type: "done"; result: GeneratedCopy }
  | { type: "error"; message: string };

const KIND_INSTRUCTIONS: Record<CopywritingKind, string> = {
  brand_intro:
    "写一段品牌介绍文案，突出定位、差异化与信任感。结构清晰，适合官网或媒体资料页。",
  product:
    "写产品/服务推广文案，突出核心卖点、适用人群与使用场景。可用小标题分段。",
  social:
    "写适合微博、小红书、朋友圈的短文案。口语化、有记忆点，控制在 300 字以内，可加适量 emoji。",
  article:
    "写一篇结构完整、可直接投放的长文初稿：标题吸引人；开篇引言点题并给出读者收益；正文用 5-8 个小标题展开（现象/误区、原理、方法步骤、案例或场景、常见问题、注意事项等按需取舍），每节写透、有具体例子与可执行要点；结尾总结并给轻量行动号召。总字数必须落在 3000-5000 字（按中文字符计，不含标题），宁写满勿缩水；禁止写成提纲式短文。",
  slogan: "生成 5-8 条品牌 Slogan 或广告语备选，每条单独一行，附一句简短说明。",
};

function maxTokensForKind(
  kind: CopywritingKind,
  family?: PlatformFamily,
): number {
  if (family === "social" || kind === "social" || kind === "slogan") return 2048;
  if (kind === "article" || family === "tech" || family === "cloud") return 8192;
  if (family) return 8192;
  return 4096;
}

const STYLE_INSTRUCTIONS: Record<CopywritingStyle, string> = {
  default:
    "专业、真诚、有温度，避免空洞形容词堆砌。结构清楚，便于阅读与二次编辑。",
  dan_koe: `模仿 Dan Koe（thedankoe）的写作气质，但必须用中文输出（专有名词可保留英文）：
- 开篇用一句强断言/原则句抓住注意力，而不是铺垫故事。
- 多用短句与单句成段，节奏干净，像「写给自己的笔记」。
- 少用套话与模糊词（很、非常、赋能、助力等）；主动语态，观点鲜明。
- 从身份与高能动（agency）切入：不是教人技巧清单，而是重塑读者如何看待自己与选择。
- 结构可参考：问题诊断 → 放大后果 → 给出可执行的新视角/流程；CTA 轻、不硬推。
- 排版留白感强，避免 emoji 堆砌与鸡汤空话。`,
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
- 价值落点：帮读者少被忽悠、敢做生意；解气但不人身攻击；不得编造客户案例或数据，语料没有的事实不要硬写。`,
  lijiaoshou: `模仿「李叫兽」式认知营销文案气质，必须用中文输出：
- 开篇先抛一个「大多数人以为…其实…」的认知冲突，而不是堆卖点或鸡汤。
- 用清晰结构说理：现象 → 常见误解 → 底层原因（可用简单模型/框架命名）→ 可执行结论。
- 语言理性、克制、像朋友讲透一件事；少口号、少煽情、少江湖口语；多用日常类比把抽象讲清楚。
- 每段只推进一步认知；关键判断要可转述（读者看完能复述给别人）。
- 结尾给「下一步怎么做」的具体动作，避免空泛「重视/加强/赋能」。
- 不得编造实验数据、调研数字或客户案例；语料没有的事实不要硬写。`,
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

function resolveStyle(style?: CopywritingStyle): CopywritingStyle {
  return style && style in STYLE_INSTRUCTIONS ? style : "default";
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
  const hay = `${item.title} ${item.tags} ${item.content}`.toLowerCase();
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
      const hay = `${item.title} ${item.tags} ${item.content}`.toLowerCase();
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

export function buildCorpusContext(items: CorpusItem[]) {
  if (items.length === 0) {
    return "（语料库暂无相关内容，请基于用户需求合理发挥，但不要编造具体数据或客户名称。）";
  }
  return items
    .map(
      (item, i) =>
        `### 语料 ${i + 1}：${item.title}（${categoryLabel(item.category)}）\n${item.content.trim()}`,
    )
    .join("\n\n");
}

export function buildCopywritingMessages(input: GenerateCopyInput) {
  const brief = input.brief.trim();
  if (!brief) {
    throw new Error("请描述你想写什么文案");
  }

  const corpus = selectCorpusForBrief(brief, {
    categories: input.categories,
    corpusIds: input.corpusIds,
  });

  const style = resolveStyle(input.style);
  const extraTone = input.tone?.trim();
  const toneLine =
    style === "default"
      ? extraTone || STYLE_INSTRUCTIONS.default
      : `${STYLE_INSTRUCTIONS[style]}${extraTone ? `\n额外语气补充：${extraTone}` : ""}`;

  const system = `你是资深品牌文案顾问。你必须优先依据用户提供的语料库事实写作，不得编造语料中不存在的公司名、数据、客户案例或资质。
写作风格：${styleLabel(style)}
语气与风格要求：
${toneLine}
输出格式（严格遵守）：
第一行：标题: （一行标题）
第二行：摘要: （50字以内摘要）
空一行后直接输出 Markdown 正文，不要写「正文:」「正文：」等标签。`;

  const family = isPlatformFamily(input.family)
    ? input.family
    : defaultFamilyForKind(input.kind);
  const familyBlock = `目标平台族：${familyLabel(family)}（${family}）
平台调性（必须遵守）：
${FAMILY_INSTRUCTIONS[family]}`;

  const user = `文案类型：${kindLabel(input.kind)}
写作要求：${KIND_INSTRUCTIONS[input.kind]}

${familyBlock}

用户需求：
${brief}

可参考的语料库：
${buildCorpusContext(corpus)}`;

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
  let bodyStart = 0;
  let bodyMarkdownPrefix = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    const titleMatch = line.match(/^标题[:：]\s*(.+)$/i);
    const summaryMatch = line.match(/^摘要[:：]\s*(.+)$/i);
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
    if (bodyLabelOnly) {
      bodyStart = i + 1;
      continue;
    }
    if (bodyLabelWithContent?.[1]) {
      bodyMarkdownPrefix = bodyLabelWithContent[1].trim();
      bodyStart = i + 1;
      continue;
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
  if (!bodyMarkdown) {
    bodyMarkdown = raw.trim();
  }

  if (title === "AI 生成文案") {
    const h1 = bodyMarkdown.match(/^#\s+(.+)/m);
    if (h1?.[1]) title = h1[1].trim();
  }

  return { title, summary, bodyMarkdown };
}

export async function finalizeGeneratedCopy(
  raw: string,
  corpus: CorpusItem[],
  thinking?: string,
): Promise<GeneratedCopy> {
  const parsed = parseCopyResponse(raw);
  const bodyHtml = await marked.parse(parsed.bodyMarkdown);

  return {
    title: parsed.title,
    summary: parsed.summary,
    bodyMarkdown: parsed.bodyMarkdown,
    bodyHtml: typeof bodyHtml === "string" ? bodyHtml : String(bodyHtml),
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

  yield {
    type: "meta",
    usedCorpus,
    model: process.env.DEEPSEEK_REASONING_MODEL?.trim() || "deepseek-reasoner",
  };

  let thinking = "";
  let content = "";

  try {
    for await (const chunk of streamChatCompletion(messages, {
      temperature: 0.75,
      maxTokens: maxTokensForKind(input.kind, family),
      signal: options?.signal,
    })) {
      if (chunk.type === "thinking") {
        thinking += chunk.text;
        yield { type: "thinking", delta: chunk.text };
      } else {
        content += chunk.text;
        yield { type: "content", delta: chunk.text };
      }
    }

    const result = await finalizeGeneratedCopy(content, corpus, thinking);
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
  const raw = await chatCompletion(messages, {
    temperature: 0.75,
    maxTokens: maxTokensForKind(input.kind, family),
  });
  return finalizeGeneratedCopy(raw, corpus);
}
