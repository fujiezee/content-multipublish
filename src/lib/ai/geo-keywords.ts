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
  if (!seed) throw new Error("请填写主词");

  const count = Math.min(Math.max(input.count ?? 40, 10), 80);
  const existing = new Set(input.existingNormKeys ?? []);
  const context = input.context?.trim() || "无额外背景";

  const system = `你是 GEO（生成式引擎优化）与 SEO 关键词策略专家。
任务：围绕用户主词，挖掘适合写文章的长尾关键词，并给出对应文章标题。
要求：
1. 长尾词要有搜索意图差异，覆盖：科普认知、教程方法、对比评测、选购方案、场景人群、问答解惑等角度
2. 可包含「如何」「为什么」「哪个好」「多少钱」「适合谁」等自然问法
3. keyword 与 title 均不得重复或高度近似（换几个字不算新词）
4. title 适合作为文章标题，15–35 字，吸引人且包含核心词
5. 只输出 JSON 数组，不要 markdown 说明`;

  const user = `主词：${seed}
背景：${context}
请生成 ${count} 条不重复的长尾词，严格 JSON 数组格式：
[
  {
    "keyword": "长尾搜索词",
    "title": "对应文章标题",
    "intent": "informational|howto|comparison|commercial|local|question",
    "angle": "一句话说明写作角度"
  }
]`;

  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.85, maxTokens: 8192 },
  );

  const parsed = parseKeywordRows(raw);
  if (!parsed.length) {
    throw new Error("AI 未返回有效关键词，请重试或换一个主词");
  }

  return dedupeGeoKeywordDrafts(parsed, existing);
}
