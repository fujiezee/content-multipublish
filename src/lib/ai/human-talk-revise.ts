import { completeScriptLlm } from "@/lib/ai/script-llm";
import {
  activeHumanTalkModel,
  polishHumanTalk,
  type HumanTalkKind,
} from "@/lib/ai/human-talk-agent";
import { PLAIN_TALK } from "@/lib/ai/oral-copy-agent";

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced?.[1] || raw).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stripFence(raw: string): string {
  const fenced = raw.match(/```(?:json|markdown|md)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] || raw).trim();
}

export async function distillHumanTalkRule(input: {
  message: string;
  before: string;
  after: string;
}): Promise<string> {
  const message = String(input.message || "").replace(/\s+/g, " ").trim();
  if (message.length < 2) return "";
  try {
    const raw = await completeScriptLlm(
      [
        {
          role: "system",
          content: `你把用户改稿时说的话收成一条可执行的中文规则，给下次审核用。
只写这一条，不超过 40 个字。像「问完不要先别答，下一句必须接这个问题」。
不要写「用户希望」「请注意」。不要把某篇的内容写进去。不要发明新口味。
如果用户只是改错字、改人名，输出空。`,
        },
        {
          role: "user",
          content: `用户说：${message}
改前：${input.before.slice(0, 800)}
改后：${input.after.slice(0, 800)}`,
        },
      ],
      {
        model: activeHumanTalkModel(),
        temperature: 0.2,
        maxTokens: 120,
        timeoutMs: 20_000,
        disableThinking: true,
      },
    );
    const line = stripFence(raw)
      .split("\n")
      .map((item) => item.replace(/^[-*]\s*/, "").trim())
      .find((item) => item.length >= 8);
    if (!line) return "";
    if (/空|无需|没有规则|改错字|人名/.test(line) && line.length < 16) return "";
    return line.replace(/^规则[:：]\s*/, "").slice(0, 80);
  } catch (err) {
    console.warn("[human-talk-revise] rule", err instanceof Error ? err.message : err);
    return "";
  }
}

export async function reviseHumanTalkDraft(input: {
  kind: HumanTalkKind;
  text: string;
  message: string;
}): Promise<{ text: string; changed: boolean; rule: string }> {
  const text = String(input.text || "").trim();
  const message = String(input.message || "").replace(/\s+/g, " ").trim();
  if (!text) return { text, changed: false, rule: "" };
  if (!message) return { text, changed: false, rule: "" };

  const kindHint =
    input.kind === "podcast"
      ? "原文可能是口播 Markdown 或 JSON turns。格式必须保持。"
      : input.kind === "script"
        ? "原文是短剧准稿或 JSON episodes。角色名、剧情不要改。"
        : "原文是写稿成稿，常见「标题/摘要/正文」。格式必须保持。";

  let next = text;
  try {
    const raw = await completeScriptLlm(
      [
        {
          role: "system",
          content: `你在改一稿。用户指出哪句假、接不上、口气不对。只改相关局部，不要另写一篇。
${PLAIN_TALK}
${kindHint}
专有名词、人名、品牌、数字不准编。
只输出改完的全文，不要解释，不要 Markdown 围栏。JSON 就仍是完整 JSON。`,
        },
        {
          role: "user",
          content: `用户说：${message}

【当前稿】
${text}`,
        },
      ],
      {
        model: activeHumanTalkModel(),
        temperature: 0.4,
        maxTokens: input.kind === "article" ? 32768 : 8192,
        timeoutMs: input.kind === "article" ? 180_000 : 90_000,
        disableThinking: true,
      },
    );
    const stripped = stripFence(raw);
    const json = text.trim().startsWith("{") ? extractJsonObject(stripped) : null;
    next = json ? JSON.stringify(json, null, 2) : stripped || text;
  } catch (err) {
    console.error("[human-talk-revise]", err instanceof Error ? err.message : err);
    return { text, changed: false, rule: "" };
  }

  const polished = await polishHumanTalk({
    kind: input.kind,
    text: next,
    maxTokens: input.kind === "article" ? 32768 : 8192,
  });
  if (polished.text.trim()) next = polished.text.trim();
  const changed = next !== text;
  const rule = changed
    ? await distillHumanTalkRule({ message, before: text, after: next })
    : "";
  return { text: next, changed, rule };
}
