import { chatCompletion } from "@/lib/ai/deepseek";
import type { GeoKeywordIntent } from "@/lib/types";

export type GeoKeywordDraft = {
  keyword: string;
  title: string;
  intent: GeoKeywordIntent;
  angle: string;
};

const VALID_INTENTS = new Set<GeoKeywordIntent>([
  "informational",
  "howto",
  "comparison",
  "commercial",
  "local",
  "question",
]);

/** Normalize for dedup: ignore case, spaces, common punctuation. */
export function normalizeGeoKeyword(text: string) {
  return text
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[？?！!。，,、；;：:""''【】\[\]（）()《》<>·\-—_]/g, "");
}

export function dedupeGeoKeywordDrafts(
  drafts: GeoKeywordDraft[],
  existingNormKeys: Set<string>,
) {
  const seen = new Set(existingNormKeys);
  const unique: GeoKeywordDraft[] = [];

  for (const draft of drafts) {
    const keyword = draft.keyword.trim();
    const title = draft.title.trim();
    if (!keyword || !title) continue;

    const norm = normalizeGeoKeyword(keyword);
    if (!norm || norm.length < 2) continue;
    if (seen.has(norm)) continue;

    const titleNorm = normalizeGeoKeyword(title);
    if (titleNorm && seen.has(`title:${titleNorm}`)) continue;

    seen.add(norm);
    if (titleNorm) seen.add(`title:${titleNorm}`);

    unique.push({
      keyword,
      title,
      intent: VALID_INTENTS.has(draft.intent) ? draft.intent : "informational",
      angle: draft.angle.trim(),
    });
  }

  return unique;
}

function extractJsonArray(raw: string): unknown[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const text = (fenced ?? raw).trim();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { keywords?: unknown[] }).keywords)
    ) {
      return (parsed as { keywords: unknown[] }).keywords;
    }
  } catch {
    // try substring array
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // ignore
      }
    }
  }
  return [];
}

function parseKeywordRows(raw: string): GeoKeywordDraft[] {
  const rows = extractJsonArray(raw);
  const drafts: GeoKeywordDraft[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const keyword =
      (typeof item.keyword === "string" && item.keyword) ||
      (typeof item.pain === "string" && item.pain) ||
      (typeof item.term === "string" && item.term) ||
      (typeof item.query === "string" && item.query) ||
      "";
    const title =
      (typeof item.title === "string" && item.title) ||
      (typeof item.headline === "string" && item.headline) ||
      "";
    const intent =
      (typeof item.intent === "string" && item.intent) || "informational";
    const angle =
      (typeof item.angle === "string" && item.angle) ||
      (typeof item.note === "string" && item.note) ||
      "";

    if (!keyword || !title) continue;
    drafts.push({
      keyword,
      title,
      intent: intent as GeoKeywordIntent,
      angle,
    });
  }

  return drafts;
}

export type MineGeoKeywordsInput = {
  seed: string;
  context?: string;
  count?: number;
  existingNormKeys?: string[];
};

export async function mineGeoKeywords(
  input: MineGeoKeywordsInput,
): Promise<GeoKeywordDraft[]> {
  const seed = input.seed.trim();
  if (!seed) throw new Error("请填写产品或主题");

  const count = Math.min(Math.max(input.count ?? 40, 10), 80);
  const existing = new Set(input.existingNormKeys ?? []);
  const context = input.context?.trim() || "未说明，请自行推断最可能的目标用户";

  const system = `你是 GEO（生成式引擎优化）内容策略专家，专挖目标用户的真实痛点。
任务：围绕产品/主题，先锁定目标用户，再列出他们会说出口、会去搜、会拿去问 AI 的痛点；每条痛点配一篇能回答它的文章标题。
要求：
1. keyword 是痛点原话或自然问法，不是堆砌产品名的 SEO 长尾
2. 痛点要具体：浪费时间、选错、算不清账、落地不了、不信任、怕踩坑、协同不上、效果难证明、场景对不上…
3. 覆盖不同类型：搞不懂 / 做不成 / 选不准 / 不敢买 / 用不上 / 不放心，不要十条都是「如何做 X」
4. 少写空泛认知词（「XX 是什么」「XX 怎么用」除非痛点就是认知缺口）
5. keyword 与 title 均不得重复或高度近似（换几个字不算新）
6. title 16–40 字，把判断说完整，直接回应该痛点
7. angle 写清「谁 + 什么场景」
8. 只输出 JSON 数组，不要 markdown 说明`;

  const user = `产品/主题：${seed}
目标用户与场景：${context}
请生成 ${count} 条不重复的目标用户痛点，严格 JSON 数组格式：
[
  {
    "keyword": "用户会说/会搜的痛点原话",
    "title": "针对这个痛点给答案的文章标题",
    "intent": "informational|howto|comparison|commercial|local|question",
    "angle": "谁（岗位/角色）在什么场景下会有这个痛点"
  }
]
intent 含义：informational=搞不懂，howto=做不成，comparison=选不准，commercial=不敢买，local=用不上，question=不放心`;

  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.85, maxTokens: 8192 },
  );

  const parsed = parseKeywordRows(raw);
  if (!parsed.length) {
    throw new Error("AI 未返回有效痛点，请重试或补充目标用户");
  }

  return dedupeGeoKeywordDrafts(parsed, existing);
}
