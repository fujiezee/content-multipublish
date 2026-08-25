import { insertCorpusAssetsIntoHtml } from "@/lib/corpus-assets";
import {
  buildCorpusContext,
  parseCopyResponse,
  selectCorpusForBrief,
} from "@/lib/ai/copywriting";
import { streamChatCompletion } from "@/lib/ai/deepseek";
import { stripBodyLabel } from "@/lib/ai/strip-body-label";
import { htmlToMarkdown, toEditorHtml } from "@/lib/content/adapt";
import {
  extractCoverSrcFromHtml,
  upsertCoverInBody,
} from "@/lib/content/cover-html";
import { markdownToHtml } from "@/lib/content/markdown";
import {
  corpusAssetUrls,
  htmlImageSrcs,
  stripUnauthorizedCopyImages,
} from "@/lib/content/copy-images";
import { COPY_STRUCTURE_PROMPT } from "@/lib/ai/copy-structure";
import {
  FAMILY_CORPUS_BOOST_TERMS,
  FAMILY_CORPUS_CATEGORIES,
  FAMILY_INSTRUCTIONS,
  familyLabel,
  type PlatformFamily,
} from "@/lib/content/platform-families";
import type { CorpusItem } from "@/lib/types";

export type AdaptedVariant = {
  title: string;
  summary: string;
  bodyHtml: string;
  bodyMarkdown: string;
  usedCorpus: { id: string; title: string }[];
};

export type AdaptStreamEvent =
  | {
      type: "meta";
      family: PlatformFamily;
      usedCorpus: { id: string; title: string }[];
      model: string;
    }
  | { type: "thinking"; family: PlatformFamily; delta: string }
  | { type: "content"; family: PlatformFamily; delta: string }
  | { type: "done"; family: PlatformFamily; result: AdaptedVariant }
  | { type: "error"; family: PlatformFamily; message: string };

function htmlToPlainish(html: string) {
  return htmlToMarkdown(html);
}

function masterBrief(input: {
  title: string;
  body: string;
  summary?: string;
}): string {
  const plain = htmlToPlainish(toEditorHtml(input.body));
  return [input.title, input.summary || "", plain.slice(0, 1200)]
    .filter(Boolean)
    .join("\n");
}

/** Pick corpus from master topic, then prefer categories/terms for the family. */
export function selectCorpusForFamilyAdapt(input: {
  title: string;
  body: string;
  summary?: string;
  family: PlatformFamily;
  limit?: number;
}): CorpusItem[] {
  const brief = masterBrief(input);
  return selectCorpusForBrief(
    brief,
    {
      categories: FAMILY_CORPUS_CATEGORIES[input.family],
      boostTerms: FAMILY_CORPUS_BOOST_TERMS[input.family],
    },
    input.limit ?? 6,
  );
}

function maxTokensForFamily(family: PlatformFamily): number {
  if (family === "social") return 4096;
  return 8192;
}

function buildAdaptMessages(input: {
  title: string;
  body: string;
  summary?: string;
  family: PlatformFamily;
  corpus: CorpusItem[];
}) {
  // Keep enough of the master so long articles aren't truncated mid-adapt.
  const sourceText =
    htmlToPlainish(toEditorHtml(input.body)).slice(0, 28_000) ||
    input.body.slice(0, 28_000);

  const system = `你是多平台内容改编编辑。必须优先依据「主稿」与「语料库」事实改写，不得编造语料/主稿中不存在的公司名、数据、客户案例或资质。
标题必须一眼想点进去：具体、有判断或反差，按本平台族口气重写，把那句话说完整。字数跟着意思走，常见 16–40 字都可以，禁止压成二十来字；不要照抄主稿的公文题，也不要「必火/躺赚」标题党。
输出格式（严格遵守）：
第一行：标题: （一行能停住的完整标题，不要卡在二十字）
第二行：摘要: （50字以内摘要）
空一行后直接输出 Markdown 正文，不要写「正文:」标签。
主稿里的表格必须保留为 Markdown 表格，不要摊成段落。
禁止新增主稿和语料里没有的图片：不要编造 ![ ](url)、/public/ 路径、相对路径或占位图。
务必写完整，不要中途停在提纲或半截段落。
${COPY_STRUCTURE_PROMPT}`;

  const user = `目标平台族：${familyLabel(input.family)}（${input.family}）
调性要求：
${FAMILY_INSTRUCTIONS[input.family]}

原标题：${input.title}
原摘要：${input.summary || "（无）"}

可引用的语料（已按主稿主题筛选，并偏向本平台族；请恰当选用，勿堆砌）：
${buildCorpusContext(input.corpus, { images: "markdown" })}
语料配图 URL 必须保留在改编正文里，不要丢掉图。不要另写语料/主稿里没有的图。

主稿原文（请完整覆盖核心论点后再按平台族重写结构与语气）：
${sourceText}`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

async function finalizeAdapted(
  raw: string,
  corpus: CorpusItem[],
  sourceBody = "",
): Promise<AdaptedVariant> {
  const parsed = parseCopyResponse(stripBodyLabel(raw));
  if (!parsed.bodyMarkdown.trim() || parsed.bodyMarkdown.trim().length < 40) {
    throw new Error("生成内容过短或不完整，请重试");
  }
  const allowedImages = [
    ...corpusAssetUrls(corpus),
    ...htmlImageSrcs(toEditorHtml(sourceBody)),
  ];
  const strippedMarkdown = stripUnauthorizedCopyImages(
    parsed.bodyMarkdown,
    allowedImages,
  );
  let bodyHtml = stripUnauthorizedCopyImages(
    insertCorpusAssetsIntoHtml(markdownToHtml(strippedMarkdown), corpus),
    allowedImages,
  );
  const masterCover = extractCoverSrcFromHtml(toEditorHtml(sourceBody));
  if (masterCover) {
    bodyHtml = upsertCoverInBody(bodyHtml, masterCover, parsed.title);
  }
  const bodyMarkdown = htmlToMarkdown(bodyHtml);
  return {
    title: parsed.title,
    summary: parsed.summary,
    bodyMarkdown,
    bodyHtml,
    usedCorpus: corpus.map((c) => ({ id: c.id, title: c.title })),
  };
}

/** Stream one family adaptation (uses chat model, not reasoner, to avoid truncated bodies). */
export async function* streamAdaptArticleToFamily(
  input: {
    title: string;
    body: string;
    summary?: string;
    family: PlatformFamily;
  },
  options?: { signal?: AbortSignal },
): AsyncGenerator<AdaptStreamEvent> {
  const corpus = selectCorpusForFamilyAdapt(input);
  const messages = buildAdaptMessages({ ...input, corpus });
  const model =
    process.env.DEEPSEEK_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "deepseek-chat";

  yield {
    type: "meta",
    family: input.family,
    usedCorpus: corpus.map((c) => ({ id: c.id, title: c.title })),
    model,
  };

  let content = "";
  try {
    for await (const chunk of streamChatCompletion(messages, {
      // Prefer chat over reasoner so max_tokens goes to the article body.
      model,
      temperature: 0.7,
      maxTokens: maxTokensForFamily(input.family),
      timeoutMs: 240_000,
      signal: options?.signal,
    })) {
      if (chunk.type === "thinking") {
        yield { type: "thinking", family: input.family, delta: chunk.text };
      } else if (chunk.type === "content") {
        content += chunk.text;
        yield { type: "content", family: input.family, delta: chunk.text };
      }
    }
    const result = await finalizeAdapted(content, corpus, input.body);
    yield { type: "done", family: input.family, result };
  } catch (err) {
    yield {
      type: "error",
      family: input.family,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Non-stream helper (still uses stream under the hood for longer timeout). */
export async function adaptArticleToFamily(input: {
  title: string;
  body: string;
  summary?: string;
  family: PlatformFamily;
}): Promise<AdaptedVariant> {
  let result: AdaptedVariant | null = null;
  let error: string | null = null;
  for await (const event of streamAdaptArticleToFamily(input)) {
    if (event.type === "done") result = event.result;
    if (event.type === "error") error = event.message;
  }
  if (result) return result;
  throw new Error(error || "改编失败");
}
