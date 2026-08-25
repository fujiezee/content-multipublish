import { chatCompletion } from "@/lib/ai/deepseek";
import {
  FAMILY_INSTRUCTIONS,
  familyLabel,
  isPlatformFamily,
} from "@/lib/content/platform-families";

function cleanTitle(text: string): string {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^["「『]|["」』]$/g, "")
    .trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function optimizeArticleTitle(input: {
  title: string;
  body?: string;
  family?: string;
  rewrite?: boolean;
}): Promise<string> {
  const current = cleanTitle(input.title);
  const excerpt = stripHtml(input.body || "").slice(0, 800);
  if (!current && !excerpt) {
    throw new Error("先写标题或正文再优化标题");
  }

  const family = isPlatformFamily(input.family) ? input.family : undefined;
  const familyLine = family
    ? `平台口气：${familyLabel(family)}。${FAMILY_INSTRUCTIONS[family]
        .split("\n")
        .find((line) => /标题/.test(line)) || "标题要适合这个平台，但不要为了字数把意思写残。"}`
    : "这是主稿标题，后面还会按各平台微调，先写成一眼想点进去的那一句。";

  const raw = await chatCompletion(
    [
      {
        role: "system",
        content:
          "你是中文内容标题编辑。只输出一行新标题，不要解释，不要引号，不要编号。",
      },
      {
        role: "user",
        content: `${input.rewrite ? "当前标题还不够好，请换一个角度重写，不要只改两三个字。" : "把标题优化得更吸引人。"}
要求：
- 一眼想点进去：具体、有判断或反差，把那句话说完整
- 字数跟着意思走，常见 16–40 字都可以；禁止压成二十来字的短标题，也不要为了短砍掉后半句
- 不套固定公式，不要公文题（浅谈/关于…的几点思考/全面解析/概述）
- 不要「必火/躺赚/震惊」标题党
- 必须能独立读完，保留原文真正在讲的那件事
${familyLine}
当前标题：${current || "（还没有标题）"}
${excerpt ? `正文要点：${excerpt}` : ""}`,
      },
    ],
    { temperature: input.rewrite ? 0.85 : 0.6, maxTokens: 160, timeoutMs: 30_000 },
  );

  const next = cleanTitle(raw.split("\n").find((line) => line.trim()) || "");
  if (!next || next.length < 2) {
    throw new Error("标题优化失败，请再试一次");
  }
  if (input.rewrite && current && next === current) {
    throw new Error("这次几乎没改，再点一次重写");
  }
  return next;
}
