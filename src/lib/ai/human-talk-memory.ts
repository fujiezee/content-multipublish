import { randomUUID } from "node:crypto";
import {
  insertHumanTalkExample,
  listEnabledHumanTalkRules,
  listHumanTalkExamples,
  upsertHumanTalkRule,
} from "@/lib/db";
type HumanTalkKind = "article" | "podcast" | "script";

const RULE_PROMPT_CAP = 24;
const EXAMPLE_PROMPT_CAP = 8;
const CLIP = 220;

function clip(text: string): string {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (compact.length <= CLIP) return compact;
  return `${compact.slice(0, CLIP)}…`;
}

/** 第一期全量塞最近对照，不上向量。过百条再按当前句召回。 */
export function formatHumanTalkMemoryPrompt(workspaceId: string): string {
  const id = String(workspaceId || "").trim();
  if (!id) return "";
  try {
    const rules = listEnabledHumanTalkRules(id).slice(0, RULE_PROMPT_CAP);
    const examples = listHumanTalkExamples(id, EXAMPLE_PROMPT_CAP);
    if (!rules.length && !examples.length) return "";
    const parts: string[] = [];
    if (rules.length) {
      parts.push(
        `这个工作区已经记下的口味（必须遵守，不要写进正文当口头禅）：\n${rules
          .map((row) => `- ${row.rule}`)
          .join("\n")}`,
      );
    }
    if (examples.length) {
      parts.push(
        `最近改过的对照（学改法，不要抄内容）：\n${examples
          .map(
            (ex, index) =>
              `${index + 1}. 改前：${clip(ex.before_text)}\n   改后：${clip(ex.after_text)}${
                ex.rule ? `\n   规则：${ex.rule}` : ""
              }`,
          )
          .join("\n")}`,
      );
    }
    return parts.join("\n\n");
  } catch (err) {
    console.warn("[human-talk-memory]", err instanceof Error ? err.message : err);
    return "";
  }
}

export function recordHumanTalkRevision(input: {
  workspaceId: string;
  kind: HumanTalkKind;
  before: string;
  after: string;
  rule?: string;
  userNote?: string;
}): { rule: string } {
  const workspaceId = String(input.workspaceId || "").trim();
  const before = String(input.before || "").trim();
  const after = String(input.after || "").trim();
  const note = String(input.userNote || "").trim().slice(0, 200);
  if (!workspaceId || !before || !after || before === after) {
    return { rule: "" };
  }
  const saved = input.rule ? upsertHumanTalkRule(workspaceId, input.rule) : null;
  const rule = saved?.rule || "";
  insertHumanTalkExample({
    id: randomUUID(),
    workspace_id: workspaceId,
    kind: input.kind,
    before_text: before.slice(0, 4000),
    after_text: after.slice(0, 4000),
    rule,
    user_note: note,
    created_at: new Date().toISOString(),
  });
  return { rule };
}
