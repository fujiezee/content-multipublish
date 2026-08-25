import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

const PIPE_ROW = /^\s*\|.+\|\s*$/;
const SEP_ROW = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/;

function normalizeTablePipes(text: string): string {
  return text.replace(/｜/g, "|");
}

function isPipeRow(line: string): boolean {
  return PIPE_ROW.test(line.trim());
}

function isSepRow(line: string): boolean {
  return SEP_ROW.test(line.trim());
}

function pipeColCount(line: string): number {
  const parts = line.trim().split("|");
  const inner =
    parts.length > 2 && parts[0]?.trim() === "" && parts[parts.length - 1]?.trim() === ""
      ? parts.slice(1, -1)
      : parts.filter((part) => part.length > 0);
  return Math.max(inner.length, 1);
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"');
}

function paragraphInnerText(inner: string): string {
  return decodeBasicEntities(
    inner.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""),
  ).trim();
}

function looksLikePipeTable(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  const pipeLines = lines.filter((line) => isPipeRow(line) || isSepRow(line));
  return pipeLines.length >= 2 && pipeLines.length >= lines.length - 1;
}

/** Insert a GFM separator when the model omitted `| --- | --- |`. */
export function ensureGfmTableSeparators(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*```/.test(line)) inFence = !inFence;
    out.push(line);
    if (inFence) continue;
    const prev = i > 0 ? lines[i - 1] : "";
    const next = lines[i + 1];
    const prevIsTable = Boolean(prev && (isPipeRow(prev) || isSepRow(prev)));
    if (
      !prevIsTable &&
      isPipeRow(line) &&
      !isSepRow(line) &&
      next != null &&
      isPipeRow(next) &&
      !isSepRow(next)
    ) {
      const cols = pipeColCount(line);
      out.push(
        `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`,
      );
    }
  }
  return out.join("\n");
}

export function markdownToHtml(markdown: string): string {
  const prepared = ensureGfmTableSeparators(normalizeTablePipes(markdown || ""));
  return marked.parse(prepared, { async: false }) as string;
}

function protectBlocks(html: string): { html: string; blocks: string[] } {
  const blocks: string[] = [];
  const next = html.replace(
    /<(pre|table|code)(\b[^>]*)?>[\s\S]*?<\/\1>/gi,
    (block) => {
      const index = blocks.length;
      blocks.push(block);
      return `\uE000MDTBL${index}\uE001`;
    },
  );
  return { html: next, blocks };
}

function restoreBlocks(html: string, blocks: string[]): string {
  return html.replace(/\uE000MDTBL(\d+)\uE001/g, (_, index: string) => {
    return blocks[Number(index)] || "";
  });
}

function unwrapPipeParagraphs(html: string): string {
  const parts = html.split(/(<p\b[^>]*>[\s\S]*?<\/p>)/i);
  const out: string[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i] ?? "";
    const match = part.match(/^<p\b[^>]*>([\s\S]*?)<\/p>$/i);
    if (!match) {
      out.push(part);
      i += 1;
      continue;
    }
    const text = paragraphInnerText(match[1] || "");
    if (looksLikePipeTable(text)) {
      out.push(`\n${text}\n`);
      i += 1;
      continue;
    }
    if (isPipeRow(text) || isSepRow(text)) {
      const rows = [text];
      let j = i + 1;
      while (j < parts.length) {
        const next = parts[j] ?? "";
        if (/^\s*$/.test(next)) {
          j += 1;
          continue;
        }
        const nextMatch = next.match(/^<p\b[^>]*>([\s\S]*?)<\/p>$/i);
        if (!nextMatch) break;
        const nextText = paragraphInnerText(nextMatch[1] || "");
        if (!(isPipeRow(nextText) || isSepRow(nextText))) break;
        rows.push(nextText);
        j += 1;
      }
      if (rows.length >= 2) {
        out.push(`\n${rows.join("\n")}\n`);
        i = j;
        continue;
      }
    }
    out.push(part);
    i += 1;
  }
  return out.join("");
}

const TABLE_BLOCK =
  /(?:^|\n)((?:[ \t]*\|.+\|[ \t]*\n)+[ \t]*\|[\t :|\-]+\|[ \t]*(?:\n[ \t]*\|.+\|[ \t]*)*)/g;

function convertPipeTableBlocks(input: string): string {
  const prepared = ensureGfmTableSeparators(normalizeTablePipes(input));
  TABLE_BLOCK.lastIndex = 0;
  return prepared.replace(TABLE_BLOCK, (_full, table: string) => {
    const html = marked.parse(`${table.trim()}\n`, { async: false }) as string;
    return `\n${html.trim()}\n`;
  });
}

/** Turn leftover `| a | b |` blocks inside HTML into real `<table>`s. */
export function hydrateMarkdownTables(html: string): string {
  if (!html) return html;
  if (!html.includes("|") && !html.includes("｜")) return html;
  const protectedHtml = protectBlocks(html);
  const converted = convertPipeTableBlocks(
    unwrapPipeParagraphs(protectedHtml.html),
  );
  return restoreBlocks(converted, protectedHtml.blocks);
}

export function containsMarkdownTable(text: string): boolean {
  if (!text) return false;
  const prepared = ensureGfmTableSeparators(normalizeTablePipes(text));
  TABLE_BLOCK.lastIndex = 0;
  return TABLE_BLOCK.test(prepared);
}
