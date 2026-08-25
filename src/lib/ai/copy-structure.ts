import type { CopywritingKind } from "@/lib/types";

export type CopyStructureIssue = {
  code: "skeleton" | "lecture" | "no_chain";
  detail: string;
};

/** 动笔前用，禁止写进正文。script_outline 除外。 */
export const COPY_STRUCTURE_PROMPT = `成文必须有结构，但骨架不许露出来。
动笔前先钉一句总判断（读者看完能复述的那一句），全文只推进这一句。
每一节、每一段只走一步，不要并列展览。
小标题如果有，必须是判断句或具体场面，禁止写成「现象 / 误区 / 原理 / 方法 / 底层逻辑 / 价值主张」栏目，禁止「一、现象」「从三个层面」「结论先行」「金字塔」「MECE」。
步骤可以按先做 A 再做 B 写，不要把思维框架当目录。标题不要「N 件事 / 系统性切换 / 结构化框架」这种目录题。
读者该觉得越读越顺，不该觉得在交结构化思维作业。`;

const LABEL_HEADING =
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:[一二三四五六七八九十]+、|[0-9]{1,2}[.、]\s*)?(?:现象|误区|原理|方法|底层原因|常见误解|价值主张|方法论)[：:]/u;

const FRAMEWORK =
  /从三个(?:层面|维度)|三个层面|金字塔原理|\bMECE\b|结论先行|底层逻辑|结构化框架|结构化思维|痛点\s*[、，/\-]\s*方案(?:\s*[、，/\-]\s*价值)?|我们可以发现/u;

const ORAL_COLUMN =
  /(?:^|\n)\s*(?:[#>*\-\s]*)(?:钩子|痛点|方案|共鸣|转化|底层原因)[：:]/u;

const CHAIN = /其实|原来|更要命|更反直觉|但真正|先别急/;

function plainCopy(text: string): string {
  return String(text || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function hasNumberedLecture(text: string): boolean {
  const first = /(?:^|\n)\s*(?:#{1,6}\s*)?第一[，、：:]/u.test(text);
  const second = /(?:^|\n)\s*(?:#{1,6}\s*)?第二[，、：:]/u.test(text);
  return first && second;
}

export function inspectCopyStructure(
  text: string,
  kind?: CopywritingKind,
): CopyStructureIssue[] {
  if (kind === "script_outline" || kind === "slogan") return [];
  const body = plainCopy(text);
  if (body.replace(/\s/g, "").length < 40) return [];

  const issues: CopyStructureIssue[] = [];
  const heading = body.match(LABEL_HEADING);
  if (heading) {
    issues.push({
      code: "skeleton",
      detail: heading[0].trim().slice(0, 24),
    });
  }
  const frame = body.match(FRAMEWORK);
  if (frame) {
    issues.push({
      code: "skeleton",
      detail: frame[0],
    });
  }
  if (kind === "oral" || kind === "marketing" || kind === "social") {
    const col = body.match(ORAL_COLUMN);
    if (col) {
      issues.push({
        code: "skeleton",
        detail: col[0].trim().slice(0, 24),
      });
    }
  }
  if (hasNumberedLecture(body)) {
    issues.push({
      code: "lecture",
      detail: "第一 / 第二 当提纲",
    });
  }
  if (
    (kind === "oral" || kind === "marketing") &&
    !CHAIN.test(body) &&
    !issues.length
  ) {
    issues.push({
      code: "no_chain",
      detail: "没有总判断推进（其实/原来/更要命）",
    });
  }
  return issues;
}

export function needsStructureRewrite(
  issues: CopyStructureIssue[],
  kind?: CopywritingKind,
): boolean {
  if (kind === "script_outline" || kind === "slogan") return false;
  return issues.some(
    (item) => item.code === "skeleton" || item.code === "lecture",
  );
}

export function structureRewritePrompt(issues: CopyStructureIssue[]): string {
  const shown = [...new Set(issues.map((item) => item.detail))].join("；");
  return `上一版把思维框架写进正文了（${shown}）。请推倒重写整篇，不要补丁式改几个词。
保留那句总判断，以及语料里的事实、产品名、方法。
结构只体现在推进：开篇落总判断，每节/每段只走一步，结尾收回。
小标题如果有，必须是判断句或场面，禁止「现象/误区/原理/方法/底层逻辑」栏目名，禁止「从三个层面」「结论先行」。
不要「第一，第二」当目录；步骤若必须编号，用「先…再…」或具体动作名。
输出格式仍严格按系统要求（标题/摘要/剧本名/正文）。`;
}
