import { chatCompletion } from "@/lib/ai/deepseek";

export type InfographicKind = "points" | "steps" | "compare" | "stat";

export type InfographicCard = {
  kind: InfographicKind;
  headline: string;
  /** points / steps */
  items?: string[];
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

function asStringArray(v: unknown, max = 5): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean)
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
    typeof o.headline === "string" ? o.headline.trim().slice(0, 40) : "";
  if (!headline) return null;
  const imagePrompt =
    typeof o.imagePrompt === "string" ? o.imagePrompt.trim().slice(0, 800) : "";
  const insertHint =
    typeof o.insertHint === "string" ? o.insertHint.trim().slice(0, 80) : "";
  const anchorText =
    typeof o.anchorText === "string" ? o.anchorText.trim().slice(0, 80) : "";

  if (kind === "stat") {
    const value =
      (typeof o.value === "string" ? o.value.trim().slice(0, 24) : "") ||
      headline.slice(0, 8);
    const caption =
      typeof o.caption === "string" ? o.caption.trim().slice(0, 80) : "";
    return {
      kind,
      headline,
      value,
      caption,
      insertHint,
      anchorText,
      imagePrompt,
    };
  }

  if (kind === "compare") {
    const leftItems = asStringArray(o.leftItems, 4);
    const rightItems = asStringArray(o.rightItems, 4);
    return {
      kind,
      headline,
      leftTitle:
        typeof o.leftTitle === "string"
          ? o.leftTitle.trim().slice(0, 20)
          : "方案 A",
      rightTitle:
        typeof o.rightTitle === "string"
          ? o.rightTitle.trim().slice(0, 20)
          : "方案 B",
      leftItems: leftItems.length ? leftItems : [headline],
      rightItems: rightItems.length ? rightItems : ["对照要点"],
      insertHint,
      anchorText,
      imagePrompt,
    };
  }

  let items = asStringArray(o.items, 5);
  if (items.length < 2) {
    // Models often return 1 bullet — pad instead of dropping the whole card.
    const extras = [anchorText, insertHint, headline]
      .map((s) => (s || "").trim())
      .filter((s) => s.length >= 4);
    for (const e of extras) {
      if (items.length >= 2) break;
      if (!items.includes(e)) items.push(e.slice(0, 28));
    }
    if (items.length < 2) items = [headline, "详见正文对应段落"].slice(0, 2);
  }
  return { kind, headline, items, insertHint, anchorText, imagePrompt };
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

/** Split plain article text into placement segments for fallback cards. */
function extractBodySegments(body: string, count: number): string[] {
  const parts = body
    .split(/(?<=[。！？；\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 16);
  if (parts.length === 0) return body.length >= 12 ? [body.slice(0, 40)] : [];

  const picked: string[] = [];
  const step = Math.max(1, Math.floor(parts.length / count));
  for (let i = 0; i < count; i++) {
    const idx = Math.min(parts.length - 1, i * step);
    const seg = parts[idx];
    if (seg && !picked.includes(seg)) picked.push(seg);
  }
  // fill from unused parts if still short
  for (const p of parts) {
    if (picked.length >= count) break;
    if (!picked.includes(p)) picked.push(p);
  }
  return picked.slice(0, count);
}

function cardFromSegment(segment: string, index: number): InfographicCard {
  const headline = segment.replace(/\s+/g, "").slice(0, 16) || `要点 ${index + 1}`;
  const anchorText = segment.slice(0, 40);
  const items = [
    segment.slice(0, 28),
    segment.length > 28 ? segment.slice(28, 56) : "结合正文进一步展开",
  ].filter(Boolean);
  const card: InfographicCard = {
    kind: index % 2 === 0 ? "points" : "steps",
    headline,
    items,
    anchorText,
    insertHint: `插在「${anchorText.slice(0, 12)}」段落后`,
  };
  return { ...card, imagePrompt: buildFallbackImagePrompt(card) };
}

function ensureCardCount(
  cards: InfographicCard[],
  count: number,
  body: string,
): InfographicCard[] {
  const out = [...cards];
  if (out.length >= count) return out.slice(0, count);
  const usedAnchors = new Set(
    out.map((c) => (c.anchorText || c.headline || "").slice(0, 12)),
  );
  const segments = extractBodySegments(body, count + 2);
  for (const seg of segments) {
    if (out.length >= count) break;
    const key = seg.slice(0, 12);
    if (usedAnchors.has(key)) continue;
    usedAnchors.add(key);
    out.push(cardFromSegment(seg, out.length));
  }
  while (out.length < count && body.length >= 16) {
    const offset = out.length * 40;
    const seg = body.slice(offset, offset + 48) || body.slice(0, 48);
    out.push(cardFromSegment(seg, out.length));
  }
  return out.slice(0, count);
}

export async function generateInfographicCards(input: {
  title: string;
  bodyHtml: string;
  count?: number;
}): Promise<InfographicCard[]> {
  const count = clampCount(input.count);
  const title = input.title.trim() || "未命名文章";
  const body = stripHtml(input.bodyHtml).slice(0, 6000);
  if (body.length < 40) {
    throw new Error("正文太短，请先写一段再生成信息图");
  }

  const system = `你是中文图文编辑。先从正文中选出 ${count} 个适合配信息图的内容片段，再为每个片段产出一张信息图卡片。
只输出 JSON 数组，不要解释。每张卡片字段：
- kind: "points" | "steps" | "compare" | "stat"
- headline: 短标题（≤18字）
- items: points/steps 的要点数组（2–5条，每条≤28字）
- leftTitle/rightTitle/leftItems/rightItems: compare 用
- value/caption: stat 用（value 如「3步」「70%」）
- anchorText: 必须从原文原样摘抄 12–40 字连续文本（用于定位插入点，禁止改写）
- insertHint: 用一句话说明插在哪一节后
- imagePrompt: 给 Gemini 生图的中文提示词（80–220字），描述一张横版 16:9 信息图：干净杂志排版、大标题清晰可读、中文文字准确、少装饰、无水印、无人物脸部特写、适合资讯信息流配图

要求：
1. 内容必须来自原文，禁止编造数据
2. 各卡片对应文中不同段落/小节，anchorText 互不重复
3. 卡片之间角度不同（要点/步骤/对比/关键数字）
4. 正好 ${count} 张
5. imagePrompt 必须包含 headline 与要点文字，便于图上准确排字
6. 优先选「方法论/对比/步骤/关键结论」段落，跳过纯过渡句`;

  const user = `标题：${title}

正文：
${body}`;

  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // 3–5 cards × long imagePrompt easily exceed 2k tokens when truncated mid-JSON
    { temperature: 0.4, maxTokens: 6144, timeoutMs: 120_000 },
  );

  let cards = parseCardsJson(raw);
  cards = ensureCardCount(cards, count, body);
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
    "生成一张横版 16:9 中文资讯信息图，干净现代杂志风格，浅色背景，主色墨绿，标题与要点清晰可读，无水印，无logo堆砌。",
    `大标题：${card.headline}`,
  ];
  if (card.kind === "stat") {
    lines.push(`突出数字「${card.value || ""}」，说明：${card.caption || ""}`);
  } else if (card.kind === "compare") {
    lines.push(
      `左右对比：${card.leftTitle || "A"} vs ${card.rightTitle || "B"}`,
    );
    lines.push(`左侧：${(card.leftItems || []).join("；")}`);
    lines.push(`右侧：${(card.rightItems || []).join("；")}`);
  } else {
    const label = card.kind === "steps" ? "步骤" : "要点";
    lines.push(`${label}：${(card.items || []).join("；")}`);
  }
  lines.push("版式简洁，中文无错字，适合文章内嵌配图。");
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

/** Deterministic SVG info-card (1200×675) for preview / fallback. */
export function renderInfographicSvg(card: InfographicCard): string {
  const w = 1200;
  const h = 675;
  const ink = "#1c1915";
  const muted = "#6b6358";
  const accent = "#0f5c4c";
  const soft = "#d8ebe4";
  const paper = "#fffdf9";
  const line = "#d4cbb8";

  const headlineLines = wrapLines(card.headline, 18, 2);
  const titleSvg = headlineLines
    .map(
      (t, i) =>
        `<text x="72" y="${108 + i * 52}" fill="${ink}" font-size="44" font-weight="700" font-family="Songti SC, Noto Serif SC, serif">${escapeXml(t)}</text>`,
    )
    .join("\n");

  let bodySvg = "";
  if (card.kind === "stat") {
    bodySvg = `
      <text x="72" y="320" fill="${accent}" font-size="120" font-weight="700" font-family="Songti SC, Noto Serif SC, serif">${escapeXml(card.value || "")}</text>
      <text x="72" y="400" fill="${muted}" font-size="28" font-family="PingFang SC, sans-serif">${escapeXml(card.caption || "")}</text>
    `;
  } else if (card.kind === "compare") {
    const left = (card.leftItems || []).slice(0, 4);
    const right = (card.rightItems || []).slice(0, 4);
    const leftText = left
      .map(
        (t, i) =>
          `<text x="92" y="${300 + i * 48}" fill="${ink}" font-size="24" font-family="PingFang SC, sans-serif">• ${escapeXml(t)}</text>`,
      )
      .join("\n");
    const rightText = right
      .map(
        (t, i) =>
          `<text x="652" y="${300 + i * 48}" fill="${ink}" font-size="24" font-family="PingFang SC, sans-serif">• ${escapeXml(t)}</text>`,
      )
      .join("\n");
    bodySvg = `
      <rect x="72" y="220" width="500" height="360" rx="18" fill="${soft}" />
      <rect x="628" y="220" width="500" height="360" rx="18" fill="#f3efe6" stroke="${line}" />
      <text x="92" y="270" fill="${accent}" font-size="28" font-weight="700" font-family="PingFang SC, sans-serif">${escapeXml(card.leftTitle || "方案 A")}</text>
      <text x="652" y="270" fill="${ink}" font-size="28" font-weight="700" font-family="PingFang SC, sans-serif">${escapeXml(card.rightTitle || "方案 B")}</text>
      ${leftText}
      ${rightText}
    `;
  } else {
    const items = (card.items || []).slice(0, 5);
    const isSteps = card.kind === "steps";
    bodySvg = items
      .map((t, i) => {
        const y = 250 + i * 70;
        const mark = isSteps ? String(i + 1) : "●";
        return `
          <circle cx="92" cy="${y - 8}" r="22" fill="${soft}" />
          <text x="92" y="${y - 1}" text-anchor="middle" fill="${accent}" font-size="${isSteps ? 20 : 16}" font-weight="700" font-family="PingFang SC, sans-serif">${mark}</text>
          <text x="132" y="${y}" fill="${ink}" font-size="28" font-family="PingFang SC, sans-serif">${escapeXml(t)}</text>
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
  <text x="${w - 72}" y="${h - 28}" text-anchor="end" fill="${muted}" font-size="16" font-family="PingFang SC, sans-serif">点物GEO</text>
</svg>`;
}
