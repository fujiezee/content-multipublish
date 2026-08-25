import { chatCompletion } from "@/lib/ai/deepseek";
import { titleCharLength } from "@/lib/content/adapt";

export const DOUYIN_ARTICLE_TITLE_MAX = 30;

function cleanTitle(text: string): string {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^["「『]|["」』]$/g, "")
    .trim();
}

/** 未超限就原样返回，避免无谓改写。 */
export function needsDouyinArticleTitleRewrite(title: string): boolean {
  return titleCharLength(cleanTitle(title)) > DOUYIN_ARTICLE_TITLE_MAX;
}

async function askDouyinTitle(input: {
  title: string;
  excerpt?: string;
  shorter?: boolean;
}): Promise<string> {
  const raw = await chatCompletion(
    [
      {
        role: "system",
        content:
          "你是抖音文章标题编辑。只输出一行新标题，不要解释，不要引号。",
      },
      {
        role: "user",
        content: `原标题超过 ${DOUYIN_ARTICLE_TITLE_MAX} 字，抖音文章发不出去。请重写成完整的抖音文章标题，不要截断原句后半截。
要求：
- 2–${DOUYIN_ARTICLE_TITLE_MAX} 个字（按汉字/字符计）
- 保留原题核心信息和读者收益
- 信息流口吻，短、密、能独立读完
- 禁止「必火」「躺赚」等标题党
${input.shorter ? "- 上一版仍超限，再压短一点，但仍要是一句完整标题\n" : ""}
原标题：${input.title}
${input.excerpt ? `正文要点：${input.excerpt.slice(0, 180)}` : ""}`,
      },
    ],
    { temperature: 0.4, maxTokens: 80, timeoutMs: 30_000 },
  );
  return cleanTitle(raw.split("\n").find((line) => line.trim()) || "");
}

/** 抖音文章标题超 30 字时按抖音文章口吻重写，不截断。 */
export async function rewriteDouyinArticleTitle(
  title: string,
  excerpt?: string,
): Promise<string> {
  const source = cleanTitle(title);
  if (!needsDouyinArticleTitleRewrite(source)) return source;

  let next = await askDouyinTitle({ title: source, excerpt });
  if (needsDouyinArticleTitleRewrite(next) || next.length < 2) {
    next = await askDouyinTitle({ title: source, excerpt, shorter: true });
  }
  if (!next || next.length < 2) {
    throw new Error("抖音文章标题重写失败，请先把标题改到 30 字以内");
  }
  if (needsDouyinArticleTitleRewrite(next)) {
    throw new Error(
      `抖音文章标题仍超过 ${DOUYIN_ARTICLE_TITLE_MAX} 字（「${next}」）。请改短后再发`,
    );
  }
  return next;
}
