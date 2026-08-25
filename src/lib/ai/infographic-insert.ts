export type InfographicPlacement = {
  url: string;
  alt: string;
  /** Verbatim quote from article near the intended insert point */
  anchorText?: string;
  insertHint?: string;
};

export function normalizeInfographicUrl(url: string): string {
  return String(url || "")
    .replace(/&amp;/gi, "&")
    .trim();
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split HTML into top-level block chunks for placement. */
export function splitHtmlBlocks(html: string): string[] {
  const input = (html || "").trim();
  if (!input) return [];

  const blocks: string[] = [];
  const re =
    /<(p|h[1-6]|blockquote|ul|ol|table|pre|div)(\s[^>]*)?>[\s\S]*?<\/\1\s*>|<(hr|img)\b[^>]*\/?>/gi;
  let last = 0;
  let match = re.exec(input);
  while (match) {
    if (match.index > last) {
      const gap = input.slice(last, match.index).trim();
      if (gap) blocks.push(gap);
    }
    blocks.push(match[0]);
    last = match.index + match[0].length;
    match = re.exec(input);
  }
  if (last < input.length) {
    const tail = input.slice(last).trim();
    if (tail) blocks.push(tail);
  }
  return blocks.length > 0 ? blocks : [input];
}

export function isInfographicBlock(block: string): boolean {
  return (
    /data-infographic\s*=\s*["']?1["']?/i.test(block) ||
    /data-dw-infographic\s*=\s*["']?1["']?/i.test(block)
  );
}

function isHeadingBlock(block: string): boolean {
  return /^<h[1-6]\b/i.test(block.trim());
}

function isHardBreak(block: string): boolean {
  return /^<hr\b/i.test(block.trim());
}

/** Split Chinese/English copy into complete sentences. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；!?])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.replace(/\s/g, "").length >= 8);
}

export type ArticleSection = {
  id: string;
  text: string;
  sentences: string[];
  /** Last sentence slice, used to insert after this section */
  anchorText: string;
  illustrated: boolean;
  startBlock: number;
  endBlock: number;
};

type AccBlock = { index: number; text: string };

function sectionFromBlocks(
  id: string,
  parts: AccBlock[],
  illustrated: boolean,
): ArticleSection {
  const text = parts.map((p) => p.text).join("");
  const sentences = splitSentences(text);
  const last = sentences[sentences.length - 1] || text;
  return {
    id,
    text,
    sentences,
    anchorText: last.slice(0, 40),
    illustrated,
    startBlock: parts[0]?.index ?? 0,
    endBlock: parts[parts.length - 1]?.index ?? 0,
  };
}

/**
 * Walk the article as whole sections, not single sentences.
 * A heading / existing infographic / hr starts a new section.
 * Long unillustrated runs are chunked into 5–7 sentence groups.
 */
export function listArticleSections(html: string): ArticleSection[] {
  const blocks = splitHtmlBlocks(html);
  const structural: { blocks: AccBlock[]; illustrated: boolean }[] = [];
  let acc: AccBlock[] = [];

  const flush = (illustrated: boolean) => {
    if (!acc.length) return;
    structural.push({ blocks: acc, illustrated });
    acc = [];
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (isInfographicBlock(block)) {
      flush(true);
      continue;
    }
    if (isHeadingBlock(block)) {
      flush(false);
      const text = stripTags(block);
      if (text.length >= 2) acc.push({ index: i, text });
      continue;
    }
    if (isHardBreak(block)) {
      flush(false);
      continue;
    }
    if (isImageOnlyBlock(block)) continue;
    const text = stripTags(block);
    if (text.length >= 8) acc.push({ index: i, text });
  }
  flush(false);

  const out: ArticleSection[] = [];
  let serial = 0;
  const nextId = () => {
    serial += 1;
    return `S${serial}`;
  };

  for (const sec of structural) {
    const joined = sec.blocks.map((b) => b.text).join("");
    const sentences = splitSentences(joined);
    if (sec.illustrated || sentences.length <= 7) {
      out.push(sectionFromBlocks(nextId(), sec.blocks, sec.illustrated));
      continue;
    }

    let cur: AccBlock[] = [];
    let sentCount = 0;
    const chunks: AccBlock[][] = [];
    for (const block of sec.blocks) {
      const n = Math.max(1, splitSentences(block.text).length);
      if (cur.length && sentCount + n > 7) {
        chunks.push(cur);
        cur = [];
        sentCount = 0;
      }
      cur.push(block);
      sentCount += n;
    }
    if (cur.length) {
      if (sentCount < 4 && chunks.length) chunks[chunks.length - 1].push(...cur);
      else chunks.push(cur);
    }
    for (const chunk of chunks) {
      out.push(sectionFromBlocks(nextId(), chunk, false));
    }
  }
  return out;
}

export function eligibleInfographicSections(
  sections: ArticleSection[],
): ArticleSection[] {
  return sections.filter((s) => !s.illustrated && s.sentences.length >= 5);
}

function isImageOnlyBlock(block: string): boolean {
  if (isInfographicBlock(block)) return true;
  const text = stripTags(block);
  return !text && /<img\b/i.test(block);
}

function scoreAnchor(blockText: string, anchor: string): number {
  if (!anchor || !blockText) return 0;
  if (blockText.includes(anchor)) return 100 + Math.min(anchor.length, 40);
  // partial: longest shared substring-ish via starts
  const a = anchor.slice(0, 16);
  if (a.length >= 6 && blockText.includes(a)) return 60;
  const tokens = anchor
    .split(/[\s，。；、,.!！？:：]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4);
  let hits = 0;
  for (const t of tokens) {
    if (blockText.includes(t)) hits += 1;
  }
  if (hits === 0) return 0;
  return 20 + hits * 8;
}

function pickBlockIndex(
  blocks: string[],
  placement: InfographicPlacement,
  used: Set<number>,
  fallbackSlot: number,
  totalSlots: number,
): number {
  const candidates = blocks
    .map((b, i) => ({ i, text: stripTags(b), image: isImageOnlyBlock(b) }))
    .filter((b) => {
      if (b.image || b.text.length < 8) return false;
      const next = blocks[b.i + 1];
      if (next && isInfographicBlock(next)) return false;
      return true;
    });

  const needle = (placement.anchorText || placement.insertHint || "").trim();
  let best = -1;
  let bestScore = 0;
  for (const c of candidates) {
    if (used.has(c.i)) continue;
    const score = scoreAnchor(c.text, needle);
    if (score > bestScore || (score === bestScore && score >= 20 && c.i > best)) {
      bestScore = score;
      best = c.i;
    }
  }
  if (best >= 0 && bestScore >= 20) return best;

  // Evenly distribute across content blocks
  if (candidates.length === 0) return Math.max(0, blocks.length - 1);
  const free = candidates.filter((c) => !used.has(c.i));
  if (free.length === 0) return candidates[candidates.length - 1].i;
  const ratio =
    totalSlots <= 1 ? 0.5 : (fallbackSlot + 1) / (totalSlots + 1);
  const target = Math.min(
    free.length - 1,
    Math.max(0, Math.round(ratio * (free.length - 1))),
  );
  return free[target].i;
}

function imageBlockHtml(url: string, alt: string): string {
  // 必须是独立块级 img。包进 <p> 会被 TipTap 丢掉，刷新后正文就像没插入。
  return `<img src="${escapeAttr(normalizeInfographicUrl(url))}" alt="${escapeAttr(alt)}" data-infographic="1" style="display:block;max-width:100%;height:auto;margin:1.1em auto;">`;
}

/** TipTap getHTML() wraps block images in <p>; that form is dropped on the next setContent. */
export function unwrapInfographicParagraphs(html: string): string {
  if (!html) return html;
  return html.replace(
    /<p(?:\s[^>]*)?>\s*(<img\b[^>]*data-infographic[^>]*>)\s*<\/p>/gi,
    "$1",
  );
}

export function htmlHasInfographicUrl(html: string, url: string): boolean {
  const needle = normalizeInfographicUrl(url);
  if (!needle || !html) return false;
  if (html.includes(needle)) return true;
  const escaped = needle.replace(/&/g, "&amp;");
  return escaped !== needle && html.includes(escaped);
}

export function countInfographicBlocks(html: string): number {
  return splitHtmlBlocks(html).filter(isInfographicBlock).length;
}

export function extractInfographicImgs(
  html: string,
): { url: string; alt: string }[] {
  const out: { url: string; alt: string }[] = [];
  const re = /<img\b[^>]*>/gi;
  let match = re.exec(html);
  while (match) {
    const tag = match[0];
    if (
      /data-infographic/i.test(tag) ||
      /data-dw-infographic/i.test(tag)
    ) {
      const src = tag.match(/\ssrc=["']([^"']+)["']/i)?.[1];
      const alt = tag.match(/\salt=["']([^"']*)["']/i)?.[1] || "信息图";
      if (src) out.push({ url: normalizeInfographicUrl(src), alt });
    }
    match = re.exec(html);
  }
  return out;
}

/**
 * Insert generated infographic images after the most relevant article blocks.
 * Keeps existing infographic blocks; only appends the given placements.
 */
export function placementsFromInfographicRows(
  rows: Array<{
    url: string;
    headline?: string | null;
    anchor_text?: string | null;
    insert_hint?: string | null;
    card_json?: string | null;
  }>,
): InfographicPlacement[] {
  return rows
    .filter((row) => Boolean(row.url))
    .map((row) => {
      let headline = row.headline || "信息图";
      let anchorText = row.anchor_text || undefined;
      let insertHint = row.insert_hint || undefined;
      try {
        const parsed = JSON.parse(row.card_json || "{}") as {
          headline?: string;
          anchorText?: string;
          insertHint?: string;
        };
        if (parsed.headline) headline = parsed.headline;
        if (parsed.anchorText) anchorText = parsed.anchorText;
        if (parsed.insertHint) insertHint = parsed.insertHint;
      } catch {
        // keep column values
      }
      return {
        url: row.url,
        alt: headline,
        anchorText,
        insertHint,
      };
    });
}

/** Keep every infographic URL from `secondary` that `primary` is missing. */
export function mergeInfographicHtml(primary: string, secondary: string): string {
  const base = unwrapInfographicParagraphs(primary || "");
  const extra = extractInfographicImgs(secondary || "").filter(
    (img) => !htmlHasInfographicUrl(base, img.url),
  );
  if (!extra.length) return base;
  return insertInfographicsIntoHtml(
    base,
    extra.map((img) => ({ url: img.url, alt: img.alt })),
  );
}

export function insertInfographicsIntoHtml(
  html: string,
  placements: InfographicPlacement[],
): string {
  if (!placements.length) return html;

  const source = unwrapInfographicParagraphs(html);
  const pending = placements.filter(
    (p) => p.url && !htmlHasInfographicUrl(source, p.url),
  );
  if (!pending.length) return source;

  const rawBlocks = splitHtmlBlocks(source);
  const used = new Set<number>();
  const plan: { afterIndex: number; html: string }[] = [];

  pending.forEach((p, slot) => {
    const afterIndex = pickBlockIndex(
      rawBlocks,
      p,
      used,
      slot,
      pending.length,
    );
    used.add(afterIndex);
    plan.push({
      afterIndex,
      html: imageBlockHtml(p.url, p.alt || "信息图"),
    });
  });

  plan.sort((a, b) => b.afterIndex - a.afterIndex || b.html.localeCompare(a.html));
  const blocks = [...rawBlocks];
  for (const item of plan) {
    const idx = Math.min(Math.max(item.afterIndex + 1, 0), blocks.length);
    blocks.splice(idx, 0, item.html);
  }
  return blocks.join("");
}
