import { marked } from "marked";
import { listCorpusItems } from "@/lib/db";
import { chatCompletion, streamChatCompletion } from "@/lib/ai/deepseek";
import { stripBodyLabel } from "@/lib/ai/strip-body-label";
import type { CopywritingKind, CorpusCategory, CorpusItem } from "@/lib/types";
import { COPYWRITING_KINDS, CORPUS_CATEGORIES } from "@/lib/types";

marked.setOptions({ gfm: true, breaks: true });

export type GenerateCopyInput = {
  kind: CopywritingKind;
  brief: string;
  categories?: CorpusCategory[];
  corpusIds?: string[];
  tone?: string;
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
    "写一篇结构完整的长文初稿：标题吸引人，有引言、2-4 个小标题正文、简短结语。总字数 800-1500 字。",
  slogan: "生成 5-8 条品牌 Slogan 或广告语备选，每条单独一行，附一句简短说明。",
};

function categoryLabel(id: CorpusCategory) {
  return CORPUS_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

function kindLabel(id: CopywritingKind) {
  return COPYWRITING_KINDS.find((k) => k.id === id)?.label ?? id;
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
  options: { categories?: CorpusCategory[]; corpusIds?: string[] },
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
  return [...all]
    .map((item) => ({ item, score: scoreCorpusItem(item, brief, categories) }))
    .filter((row) => row.score > 0 || categories.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.item);
}

function buildCorpusContext(items: CorpusItem[]) {
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

  const system = `你是资深品牌文案顾问。你必须优先依据用户提供的语料库事实写作，不得编造语料中不存在的公司名、数据、客户案例或资质。
语气要求：${input.tone?.trim() || "专业、真诚、有温度，避免空洞形容词堆砌。"}
输出格式（严格遵守）：
第一行：标题: （一行标题）
第二行：摘要: （50字以内摘要）
空一行后直接输出 Markdown 正文，不要写「正文:」「正文：」等标签。`;

  const user = `文案类型：${kindLabel(input.kind)}
写作要求：${KIND_INSTRUCTIONS[input.kind]}

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
  const { messages, corpus } = buildCopywritingMessages(input);
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
      maxTokens: 4096,
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
  const { messages, corpus } = buildCopywritingMessages(input);
  const raw = await chatCompletion(messages, { temperature: 0.75, maxTokens: 4096 });
  return finalizeGeneratedCopy(raw, corpus);
}
