export type InfographicPlacement = {
  url: string;
  alt: string;
  /** Verbatim quote from article near the intended insert point */
  anchorText?: string;
  insertHint?: string;
};

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

function isInfographicBlock(block: string): boolean {
  return (
    /data-infographic\s*=\s*["']?1["']?/i.test(block) ||
    /data-dw-infographic\s*=\s*["']?1["']?/i.test(block)
  );
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
    .filter((b) => !b.image && b.text.length >= 8);

  const needle = (placement.anchorText || placement.insertHint || "").trim();
  let best = -1;
  let bestScore = 0;
  for (const c of candidates) {
    if (used.has(c.i)) continue;
    const score = scoreAnchor(c.text, needle);
    if (score > bestScore) {
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
  return `<p data-infographic="1" style="text-align:center;margin:1.1em 0;"><img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" data-infographic="1" style="display:inline-block;max-width:100%;height:auto;margin:0 auto;"></p>`;
}

/**
 * Insert generated infographic images after the most relevant article blocks.
 * Replaces previous auto-inserted `data-infographic` blocks first.
 */
export function insertInfographicsIntoHtml(
  html: string,
  placements: InfographicPlacement[],
): string {
  if (!placements.length) return html;

  const rawBlocks = splitHtmlBlocks(html).filter((b) => !isInfographicBlock(b));
  const used = new Set<number>();
  const plan: { afterIndex: number; html: string }[] = [];

  placements.forEach((p, slot) => {
    const afterIndex = pickBlockIndex(
      rawBlocks,
      p,
      used,
      slot,
      placements.length,
    );
    used.add(afterIndex);
    plan.push({
      afterIndex,
      html: imageBlockHtml(p.url, p.alt || "信息图"),
    });
  });

  // Insert from back so indexes stay valid
  plan.sort((a, b) => b.afterIndex - a.afterIndex || b.html.localeCompare(a.html));
  const blocks = [...rawBlocks];
  for (const item of plan) {
    const idx = Math.min(Math.max(item.afterIndex + 1, 0), blocks.length);
    blocks.splice(idx, 0, item.html);
  }
  return blocks.join("");
}
