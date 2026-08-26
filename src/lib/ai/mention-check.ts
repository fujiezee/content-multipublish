import { chatCompletion, resolveDeepSeekConfig } from "@/lib/ai/deepseek";
import {
  doubaoChatCompletion,
  resolveDoubaoConfig,
  type DoubaoConfig,
} from "@/lib/ai/doubao";
import type {
  MentionProbeSource,
  MentionResult,
  MentionSource,
} from "@/lib/types";

const SYSTEM_PROMPT =
  "你是一个普通用户会遇到的问答助手。按公开信息简要回答，不编造公司或产品，不主动推荐任何品牌。回答不超过 400 字。";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function brandPattern(brand: string): RegExp | null {
  const chars = brand.replace(/[\s.\-_]/g, "").split("").filter(Boolean);
  if (!chars.length) return null;
  const body = chars.map((c) => escapeRegExp(c)).join("[\\s.\\-_]*");
  return new RegExp(body, "i");
}

export function scoreMention(answer: string, brands: string[]): {
  mentioned: boolean;
  excerpt: string;
} {
  const text = answer.trim();
  if (!text) return { mentioned: false, excerpt: "" };

  for (const brand of brands) {
    const pattern = brandPattern(brand);
    if (!pattern) continue;
    const match = pattern.exec(text);
    if (!match || match.index == null) continue;
    const start = Math.max(0, match.index - 36);
    const end = Math.min(text.length, match.index + match[0].length + 36);
    const excerpt = `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${
      end < text.length ? "…" : ""
    }`;
    return { mentioned: true, excerpt };
  }
  return { mentioned: false, excerpt: "" };
}

async function askDeepSeek(question: string): Promise<string> {
  return chatCompletion(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: question.trim() },
    ],
    {
      model: "deepseek-chat",
      temperature: 0.3,
      maxTokens: 800,
      timeoutMs: 45_000,
    },
  );
}

async function askDoubao(question: string, config: DoubaoConfig): Promise<string> {
  return doubaoChatCompletion(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: question.trim() },
    ],
    {
      config,
      temperature: 0.3,
      maxTokens: 800,
      timeoutMs: 60_000,
      webSearch: true,
    },
  );
}

async function probeOne(input: {
  source: MentionProbeSource;
  question: string;
  brands: string[];
  doubao: DoubaoConfig | null;
}): Promise<Omit<MentionResult, "id" | "run_id">> {
  try {
    const answer =
      input.source === "doubao"
        ? await askDoubao(input.question, input.doubao!)
        : await askDeepSeek(input.question);
    const scored = scoreMention(answer, input.brands);
    return {
      question: input.question,
      source: input.source,
      mentioned: scored.mentioned,
      excerpt: scored.excerpt,
      answer: answer.slice(0, 2000),
      error: "",
    };
  } catch (err) {
    return {
      question: input.question,
      source: input.source,
      mentioned: false,
      excerpt: "",
      answer: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function listConfiguredMentionSources(doubaoStored?: {
  apiKey?: string;
  model?: string;
}): MentionProbeSource[] {
  const sources: MentionProbeSource[] = [];
  if (resolveDeepSeekConfig()) sources.push("deepseek");
  if (resolveDoubaoConfig(doubaoStored)) sources.push("doubao");
  return sources;
}

export async function runMentionProbe(input: {
  brands: string[];
  questions: string[];
  sources?: MentionProbeSource[];
  doubaoStored?: { apiKey?: string; model?: string };
}): Promise<{
  model: string;
  doubaoModel?: string;
  results: Array<Omit<MentionResult, "id" | "run_id">>;
}> {
  const doubao = resolveDoubaoConfig(input.doubaoStored);
  const available = listConfiguredMentionSources(input.doubaoStored);
  const wanted = (input.sources?.length ? input.sources : available).filter(
    (s, i, arr) => arr.indexOf(s) === i,
  );
  const sources = wanted.filter((s) => available.includes(s));

  if (!sources.length) {
    throw new Error("模型还没通。有查排名次数或余额就可以跑，不用自己配方舟 Key。");
  }
  if (sources.includes("doubao") && !doubao) {
    throw new Error("豆包还没通。有次数或余额就可以跑，不用自己配方舟 Key。");
  }

  const questions = input.questions.map((q) => q.trim()).filter(Boolean).slice(0, 8);
  const brands = input.brands.map((b) => b.trim()).filter(Boolean);
  const results: Array<Omit<MentionResult, "id" | "run_id">> = [];

  for (const question of questions) {
    const batch = await Promise.all(
      sources.map((source) =>
        probeOne({ source, question, brands, doubao }),
      ),
    );
    results.push(...batch);
  }

  const model = sources
    .map((s) => (s === "doubao" ? doubao?.model || "doubao" : "deepseek-chat"))
    .join("+");
  return {
    model,
    doubaoModel: sources.includes("doubao") ? doubao?.model : undefined,
    results,
  };
}

export function scorePastedAnswer(input: {
  question: string;
  answer: string;
  brands: string[];
  source: MentionSource;
}): Omit<MentionResult, "id" | "run_id"> {
  const question = input.question.trim();
  const answer = input.answer.trim();
  if (!question) {
    throw new Error("请选择或填写问题");
  }
  if (!answer) {
    throw new Error("请粘贴模型回答");
  }
  const scored = scoreMention(answer, input.brands);
  return {
    question,
    source: input.source === "deepseek" ? "other" : input.source,
    mentioned: scored.mentioned,
    excerpt: scored.excerpt,
    answer: answer.slice(0, 2000),
    error: "",
  };
}
