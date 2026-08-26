import { stripBodyLabel } from "@/lib/ai/strip-body-label";

export function parseCopyResponse(raw: string) {
  const lines = raw.split("\n");
  let title = "AI 生成文案";
  let summary = "";
  let scriptTitle = "";
  let bodyStart = 0;
  let bodyMarkdownPrefix = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    const titleMatch = line.match(/^标题[:：]\s*(.+)$/i);
    const summaryMatch = line.match(/^摘要[:：]\s*(.+)$/i);
    const scriptMatch = line.match(
      /^(?:剧本名|合集名|短视频名|系列名)[:：]\s*(.+)$/i,
    );
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
    if (scriptMatch?.[1]) {
      scriptTitle = scriptMatch[1].replace(/\s+/g, " ").trim().slice(0, 16);
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
    if (title !== "AI 生成文案" && summary && scriptTitle && line === "") {
      bodyStart = i + 1;
      break;
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
  bodyMarkdown = bodyMarkdown.replace(/^剧本名[:：]\s*.+\n*/m, "").trim();
  if (!bodyMarkdown) {
    bodyMarkdown = raw.trim();
  }

  if (title === "AI 生成文案") {
    const h1 = bodyMarkdown.match(/^#\s+(.+)/m);
    if (h1?.[1]) title = h1[1].trim();
  }

  return { title, summary, scriptTitle, bodyMarkdown };
}

export function serializeCopyDraft(input: {
  title: string;
  summary: string;
  scriptTitle?: string;
  bodyMarkdown: string;
}): string {
  return [
    `标题: ${input.title || ""}`,
    input.scriptTitle ? `剧本名: ${input.scriptTitle}` : "",
    `摘要: ${input.summary || ""}`,
    "正文:",
    input.bodyMarkdown || "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
