import { chatCompletion } from "@/lib/ai/deepseek";
import {
  eligibleInfographicSections,
  listArticleSections,
  type ArticleSection,
} from "@/lib/ai/infographic-insert";

export type InfographicKind = "points" | "steps" | "compare" | "stat";

export type InfographicCard = {
  kind: InfographicKind;
  headline: string;
  /** points / steps / stat supporting lines */
  items?: string[];
  /** one-line conclusion from the article */
  takeaway?: string;
  /** compare */
  leftTitle?: string;
  leftItems?: string[];
  rightTitle?: string;
  rightItems?: string[];
  /** stat */
  value?: string;
  caption?: string;
  /** where it roughly belongs in the article */
  insertHint?: string;
  /** Verbatim short quote from the article used to locate insert position */
  anchorText?: string;
  /** Section id from listArticleSections, e.g. S2 */
  sectionId?: string;
  /** English/Chinese prompt for Gemini image model */
  imagePrompt?: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function clampCount(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 3;
  return Math.min(5, Math.max(1, Math.round(v)));
}

function asStringArray(v: unknown, max = 7, maxChars = 80): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.slice(0, maxChars))
    .slice(0, max);
}

function normalizeCard(raw: unknown): InfographicCard | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kindRaw = typeof o.kind === "string" ? o.kind : "points";
  const kind: InfographicKind =
    kindRaw === "steps" ||
    kindRaw === "compare" ||
    kindRaw === "stat" ||
    kindRaw === "points"
      ? kindRaw
      : "points";
  const headline =
    typeof o.headline === "string" ? o.headline.trim().slice(0, 28) : "";
  if (!headline) return null;
  const imagePrompt =
    typeof o.imagePrompt === "string" ? o.imagePrompt.trim().slice(0, 1600) : "";
  const insertHint =
    typeof o.insertHint === "string" ? o.insertHint.trim().slice(0, 80) : "";
  const anchorText =
    typeof o.anchorText === "string" ? o.anchorText.trim().slice(0, 80) : "";
  const takeaway =
    typeof o.takeaway === "string" ? o.takeaway.trim().slice(0, 48) : "";
  const sectionId =
    typeof o.sectionId === "string" ? o.sectionId.trim().slice(0, 8) : "";

  if (kind === "stat") {
    const value =
      (typeof o.value === "string" ? o.value.trim().slice(0, 24) : "") ||
      headline.slice(0, 8);
    const caption =
      typeof o.caption === "string" ? o.caption.trim().slice(0, 120) : "";
    const items = asStringArray(o.items, 5, 80);
    return {
      kind,
      headline,
      value,
      caption,
      items: items.length ? items : undefined,
      takeaway,
      insertHint,
      anchorText,
      sectionId: sectionId || undefined,
      imagePrompt,
    };
  }

  if (kind === "compare") {
    const leftItems = asStringArray(o.leftItems, 5, 48);
    const rightItems = asStringArray(o.rightItems, 5, 48);
    return {
      kind,
      headline,
      leftTitle:
        typeof o.leftTitle === "string"
          ? o.leftTitle.trim().slice(0, 16)
          : "方案 A",
      rightTitle:
        typeof o.rightTitle === "string"
          ? o.rightTitle.trim().slice(0, 16)
          : "方案 B",
      leftItems: leftItems.length ? leftItems : [headline],
      rightItems: rightItems.length ? rightItems : ["对照要点"],
      takeaway,
      insertHint,
      anchorText,
      sectionId: sectionId || undefined,
      imagePrompt,
    };
  }

  const items = asStringArray(o.items, 7, 80);
  return {
    kind,
    headline,
    items,
    takeaway,
    insertHint,
    anchorText,
    sectionId: sectionId || undefined,
    imagePrompt,
  };
}

function parseCardsJson(text: string): InfographicCard[] {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() || trimmed;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error("AI 未返回可用的信息图 JSON");
  }
  let json: unknown;
  try {
    json = JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch {
    // Truncated arrays: salvage complete {...} objects
    const objects = candidate
      .slice(start + 1)
      .match(/\{[\s\S]*?\}(?=\s*,|\s*$)/g);
    if (!objects?.length) {
      throw new Error("AI 未返回可用的信息图 JSON");
    }
    json = objects
      .map((chunk) => {
        try {
          return JSON.parse(chunk) as unknown;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
  if (!Array.isArray(json)) {
    throw new Error("信息图 JSON 格式错误");
  }
  return json.map(normalizeCard).filter((c): c is InfographicCard => !!c);
}

function compactKey(text: string): string {
  return text.replace(/\s+/g, "");
}

export function cardFromSection(
  section: ArticleSection,
  index = 0,
): InfographicCard | null {
  if (section.sentences.length < 5) return null;
  const items = section.sentences.slice(0, 7).map((s) => s.slice(0, 80));
  const headline =
    section.sentences[0].replace(/\s+/g, "").slice(0, 18) || `要点 ${index + 1}`;
  const card: InfographicCard = {
    kind: index % 2 === 0 ? "points" : "steps",
    headline,
    items,
    takeaway: section.sentences[section.sentences.length - 1].slice(0, 48),
    anchorText: section.anchorText,
    insertHint: `插在「${section.anchorText.slice(0, 12)}」这一节后`,
    sectionId: section.id,
  };
  return { ...card, imagePrompt: buildFallbackImagePrompt(card) };
}

function markExcludedSections(
  sections: ArticleSection[],
  excludeAnchors: string[],
  excludeHeadlines: string[],
) {
  const keys = [...excludeAnchors, ...excludeHeadlines]
    .map((s) => compactKey(s))
    .filter((s) => s.length >= 8 && s !== "信息图");
  for (const section of sections) {
    if (section.illustrated) continue;
    const text = compactKey(section.text);
    const anchor = compactKey(section.anchorText);
    if (
      keys.some(
        (key) =>
          text.includes(key.slice(0, 16)) ||
          (anchor.length >= 8 && key.includes(anchor.slice(0, 12))),
      )
    ) {
      section.illustrated = true;
    }
  }
}

function matchSection(
  card: InfographicCard,
  eligible: ArticleSection[],
  used: Set<string>,
): ArticleSection | null {
  if (card.sectionId) {
    const hit = eligible.find((s) => s.id === card.sectionId && !used.has(s.id));
    if (hit) return hit;
  }
  const needle = compactKey(card.anchorText || card.headline || "");
  let best: ArticleSection | null = null;
  let bestScore = 0;
  for (const section of eligible) {
    if (used.has(section.id)) continue;
    const text = compactKey(section.text);
    let score = 0;
    if (needle.length >= 12 && text.includes(needle.slice(0, 16))) score = 80;
    else if (needle.length >= 8 && text.includes(needle.slice(0, 8))) score = 40;
    if (score > bestScore) {
      bestScore = score;
      best = section;
    }
  }
  return bestScore >= 40 ? best : null;
}

function tidyPoints(items: string[] | undefined, max = 7, maxChars = 40): string[] {
  return (items || [])
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 8)
    .slice(0, max)
    .map((item) => item.slice(0, maxChars));
}

function bindCardToSection(
  card: InfographicCard,
  section: ArticleSection,
): InfographicCard {
  const left = tidyPoints(card.leftItems, 5, 36);
  const right = tidyPoints(card.rightItems, 5, 36);
  if (card.kind === "compare" && left.length >= 3 && right.length >= 3) {
    return {
      ...card,
      leftItems: left,
      rightItems: right,
      sectionId: section.id,
      anchorText: section.anchorText,
      insertHint:
        card.insertHint || `插在「${section.anchorText.slice(0, 12)}」这一节后`,
    };
  }
  const summarized = tidyPoints(card.items, 7, 40);
  const fallback = cardFromSection(section, 0);
  const items = summarized.length >= 3 ? summarized : fallback?.items || [];
  return {
    ...card,
    kind: card.kind === "compare" ? "points" : card.kind,
    items,
    takeaway: (card.takeaway || fallback?.takeaway || "").slice(0, 36),
    sectionId: section.id,
    anchorText: section.anchorText,
    insertHint:
      card.insertHint || `插在「${section.anchorText.slice(0, 12)}」这一节后`,
  };
}

function fillFromSections(
  cards: InfographicCard[],
  eligible: ArticleSection[],
  count: number,
  used: Set<string>,
): InfographicCard[] {
  const out = [...cards];
  for (const section of eligible) {
    if (out.length >= count) break;
    if (used.has(section.id)) continue;
    const card = cardFromSection(section, out.length);
    if (!card) continue;
    used.add(section.id);
    out.push(card);
  }
  return out.slice(0, count);
}

function formatSectionOutline(sections: ArticleSection[]): string {
  return sections
    .map((section) => {
      const flag = section.illustrated ? "已配图，只作上下文，不要再配" : "可配图";
      return `[${section.id}] ${flag}\n${section.text.slice(0, 700)}`;
    })
    .join("\n\n");
}

export async function generateInfographicCards(input: {
  title: string;
  bodyHtml: string;
  count?: number;
  excludeAnchors?: string[];
  excludeHeadlines?: string[];
}): Promise<InfographicCard[]> {
  const title = input.title.trim() || "未命名文章";
  const html = input.bodyHtml || "";
  const body = stripHtml(html);
  if (body.length < 40) {
    throw new Error("正文太短，请先写一段再生成信息图");
  }

  const sections = listArticleSections(html);
  markExcludedSections(
    sections,
    (input.excludeAnchors || []).map((s) => s.trim()).filter((s) => s.length >= 4),
    (input.excludeHeadlines || []).map((s) => s.trim()).filter(Boolean),
  );
  const eligible = eligibleInfographicSections(sections);
  if (eligible.length === 0) {
    throw new Error("剩余正文已没有尚未配图的整节，请先补充内容再生成");
  }
  const count = Math.min(clampCount(input.count), eligible.length);

  const system = `你是中文图文主编。先把整篇文章当作一篇来读，找出全文真正的核心观点，再配图。
不要按节从头到尾凑数，不要给过渡段、例子铺垫、一句口号单独配图。

心里分三步，只输出 JSON 数组：
1. 通读全文，用一句话概括这篇文章在论证什么。
2. 从全文里找出最多 ${count} 个核心观点（论点/方法/对比/结论）。这 ${count} 个必须能撑起全文主线，角度不重复。
3. 每个核心观点落到它在文中被讲清楚的那一节（sectionId），在那一节后面插图；图上文字是对这个观点的总结，不是搬原文。

每张卡片字段：
- sectionId: 该观点讲清楚的那一节，必须是「可配图」编号，如 S2
- kind: "points" | "steps" | "compare" | "stat"
- headline: 这个核心观点的标题（8–22字）
- items: 5–7 条；每条 14–36 字，总结这个观点，不要整句搬原文，也不要两三个词的标签
- takeaway: 这个观点的一句判断（≤36字）
- leftTitle/rightTitle/leftItems/rightItems: compare 用
- value/caption/items: stat 用；数字必须来自原文
- insertHint: 写「插在这一节后」

要求：
1. 先定核心观点，再选节；禁止先看见长节就配
2. 事实必须来自对应节，禁止编造
3. 一节最多一张，sectionId 互不重复
4. 可配图的节不够 ${count} 个时，有几个核心观点出几张，不要硬凑`;

  const user = `标题：${title}

请先通读，再选出 ${count} 个核心观点。

全文：
${body.slice(0, 8000)}

分节（用来对位插入，已配图的节不要再用）：
${formatSectionOutline(sections)}`;

  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.3, maxTokens: 8192, timeoutMs: 120_000 },
  );

  const used = new Set<string>();
  const bound: InfographicCard[] = [];
  let parsed: InfographicCard[] = [];
  try {
    parsed = parseCardsJson(raw);
  } catch {
    parsed = [];
  }
  for (const card of parsed) {
    const section = matchSection(card, eligible, used);
    if (!section) continue;
    used.add(section.id);
    bound.push(bindCardToSection(card, section));
    if (bound.length >= count) break;
  }
  const cards =
    bound.length > 0 ? bound.slice(0, count) : fillFromSections([], eligible, count, used);
  if (cards.length === 0) {
    throw new Error("未能生成信息图卡片，请缩短或改写正文后再试");
  }
  return cards.map((card) => ({
    ...card,
    imagePrompt: card.imagePrompt || buildFallbackImagePrompt(card),
  }));
}

/** Build a Gemini image prompt from structured card fields. */
export function buildFallbackImagePrompt(card: InfographicCard): string {
  const lines: string[] = [
    "生成一张正方形 1:1 中文资讯信息图。画幅必须是正方形。杂志排版、浅色背景、主色墨绿。信息密度高，铺满画面，不要大片留白，不要只有标题加两三条短词。无水印、无角标、无 logo、无网址。图上只排下面这些总结要点，写清楚、写完整，不要整段原文搬家。",
    `大标题（完整写出）：${card.headline}`,
  ];
  if (card.kind === "stat") {
    lines.push(`顶部突出数字「${card.value || ""}」`);
    if (card.caption) lines.push(`数字说明：${card.caption}`);
    const extras = card.items || [];
    extras.forEach((t, i) => lines.push(`说明${i + 1}：${t}`));
  } else if (card.kind === "compare") {
    lines.push(
      `左右两栏对比：${card.leftTitle || "A"} vs ${card.rightTitle || "B"}`,
    );
    (card.leftItems || []).forEach((t, i) =>
      lines.push(`左栏${i + 1}：${t}`),
    );
    (card.rightItems || []).forEach((t, i) =>
      lines.push(`右栏${i + 1}：${t}`),
    );
  } else {
    const label = card.kind === "steps" ? "步骤" : "要点";
    lines.push(`中间列出全部${label}，每条单独一行：`);
    (card.items || []).forEach((t, i) =>
      lines.push(`${label}${i + 1}：${t}`),
    );
  }
  if (card.takeaway) {
    lines.push(`底部结论：${card.takeaway}`);
  }
  lines.push(
    "中文无错字。适合手机长文内嵌。只排上面这些要点，不要署名、不要网址、不要额外装饰文案。",
  );
  return lines.join("\n");
}

/** Escape text for SVG. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const chars = [...text];
  const lines: string[] = [];
  let line = "";
  for (const ch of chars) {
    if (line.length >= maxChars) {
      lines.push(line);
      line = ch;
      if (lines.length >= maxLines) break;
    } else {
      line += ch;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

/** Deterministic SVG info-card (1080×1080 square) for preview / fallback. */
export function renderInfographicSvg(card: InfographicCard): string {
  const w = 1080;
  const h = 1080;
  const ink = "#1c1915";
  const muted = "#6b6358";
  const accent = "#0f5c4c";
  const soft = "#d8ebe4";
  const paper = "#fffdf9";
  const line = "#d4cbb8";

  const headlineLines = wrapLines(card.headline, 16, 2);
  const titleSvg = headlineLines
    .map(
      (t, i) =>
        `<text x="72" y="${128 + i * 50}" fill="${ink}" font-size="42" font-weight="700" font-family="Songti SC, Noto Serif SC, serif">${escapeXml(t)}</text>`,
    )
    .join("\n");

  const takeawaySvg = card.takeaway
    ? `<text x="72" y="1036" fill="${muted}" font-size="22" font-family="PingFang SC, sans-serif">${escapeXml(card.takeaway)}</text>`
    : "";

  let bodySvg = "";
  if (card.kind === "stat") {
    const extras = (card.items || []).slice(0, 5);
    const extraSvg = extras
      .map((t, i) => {
        const y = 520 + i * 72;
        return wrapLines(t, 28, 2)
          .map(
            (line, li) =>
              `<text x="72" y="${y + li * 28}" fill="${ink}" font-size="24" font-family="PingFang SC, sans-serif">${escapeXml(line)}</text>`,
          )
          .join("\n");
      })
      .join("\n");
    bodySvg = `
      <text x="72" y="300" fill="${accent}" font-size="96" font-weight="700" font-family="Songti SC, Noto Serif SC, serif">${escapeXml(card.value || "")}</text>
      <text x="72" y="380" fill="${muted}" font-size="26" font-family="PingFang SC, sans-serif">${escapeXml(card.caption || "")}</text>
      ${extraSvg}
    `;
  } else if (card.kind === "compare") {
    const left = (card.leftItems || []).slice(0, 5);
    const right = (card.rightItems || []).slice(0, 5);
    const col = (items: string[], x: number) =>
      items
        .map((t, i) => {
          const y = 380 + i * 92;
          return wrapLines(t, 14, 2)
            .map(
              (line, li) =>
                `<text x="${x}" y="${y + li * 26}" fill="${ink}" font-size="22" font-family="PingFang SC, sans-serif">${escapeXml(line)}</text>`,
            )
            .join("\n");
        })
        .join("\n");
    bodySvg = `
      <rect x="72" y="260" width="448" height="720" rx="18" fill="${soft}" />
      <rect x="560" y="260" width="448" height="720" rx="18" fill="#f3efe6" stroke="${line}" />
      <text x="92" y="320" fill="${accent}" font-size="26" font-weight="700" font-family="PingFang SC, sans-serif">${escapeXml(card.leftTitle || "方案 A")}</text>
      <text x="584" y="320" fill="${ink}" font-size="26" font-weight="700" font-family="PingFang SC, sans-serif">${escapeXml(card.rightTitle || "方案 B")}</text>
      ${col(left, 92)}
      ${col(right, 584)}
    `;
  } else {
    const items = (card.items || []).slice(0, 7);
    const isSteps = card.kind === "steps";
    const gap = items.length > 5 ? 88 : 100;
    bodySvg = items
      .map((t, i) => {
        const y = 250 + i * gap;
        const mark = isSteps ? String(i + 1) : "●";
        const wrapped = wrapLines(t, 26, 2);
        const text = wrapped
          .map(
            (line, li) =>
              `<text x="144" y="${y + li * 28}" fill="${ink}" font-size="26" font-family="PingFang SC, sans-serif">${escapeXml(line)}</text>`,
          )
          .join("\n");
        return `
          <circle cx="96" cy="${y - 8}" r="22" fill="${soft}" />
          <text x="96" y="${y - 1}" text-anchor="middle" fill="${accent}" font-size="${isSteps ? 20 : 16}" font-weight="700" font-family="PingFang SC, sans-serif">${mark}</text>
          ${text}
        `;
      })
      .join("\n");
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${paper}"/>
      <stop offset="100%" stop-color="#e8e0d0"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect x="0" y="0" width="18" height="${h}" fill="${accent}"/>
  <text x="72" y="48" fill="${accent}" font-size="18" font-weight="600" font-family="PingFang SC, sans-serif" letter-spacing="2">信息图</text>
  ${titleSvg}
  ${bodySvg}
  ${takeawaySvg}
</svg>`;
}
