import { looksLikeCharacterName } from "@/lib/ai/script-import";
import { chatCompletion } from "@/lib/ai/deepseek";
import {
  hookStyleLabel,
  normalizeHookStyle,
  showEngineCard,
} from "@/lib/ai/video-script-styles";

export type StanceCard = {
  name: string;
  role: string;
  stance: string;
  knows: string;
  wants: string;
  address: string;
  never: string;
  intro: string;
};

const STANCE_MARK = "【人设卡】";

function asCard(raw: unknown, allow?: Set<string>): StanceCard | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = String(o.name || "").trim().slice(0, 16);
  if (!name) return null;
  if (allow?.size) {
    if (!allow.has(name)) return null;
  } else if (!looksLikeCharacterName(name)) {
    return null;
  }
  const text = (key: string, max: number) =>
    String(o[key] || "").replace(/\s+/g, " ").trim().slice(0, max);
  return {
    name,
    role: text("role", 24),
    stance: text("stance", 80),
    knows: text("knows", 80),
    wants: text("wants", 80),
    address: text("address", 80),
    never: text("never", 100),
    intro: text("intro", 180),
  };
}

/** 规则模板：压/被压/插一句。这种介绍不能给用户看。 */
export function isCannedStanceCard(card: Pick<StanceCard, "stance" | "knows" | "wants" | "role" | "intro">): boolean {
  const blob = [card.role, card.stance, card.knows, card.wants, card.intro]
    .filter(Boolean)
    .join(" ");
  return (
    /压「.+」改一件事/.test(blob) ||
    /被「.+」压，会问、会顶、会不服/.test(blob) ||
    /插一句或作证/.test(blob) ||
    /按「.+」把一件事说清楚/.test(blob) ||
    card.knows === "关键判断在他这边" ||
    card.knows === "只知道自己原来那套" ||
    card.knows === "只知道自己看见的" ||
    card.wants === "让对方按他的口径改" ||
    card.wants === "问清楚或保住面子" ||
    card.wants === "把目击或态度说完"
  );
}

export function stanceCardsNeedRewrite(
  cards: StanceCard[],
  names: string[] = [],
): boolean {
  const roster = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (roster.length === 0) return false;
  if (cards.length === 0) return true;
  if (cards.some(isCannedStanceCard)) return true;
  if (cards.some((card) => !card.intro.trim())) return true;
  return roster.some((name) => !cards.some((card) => card.name === name));
}

export function resolveStanceCards(
  notes: string | undefined,
  names: string[] = [],
  _hookStyle?: string,
): StanceCard[] {
  const roster = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (roster.length === 0) return [];
  const saved = parseStanceCards(notes || "").filter((card) => !isCannedStanceCard(card));
  const byName = new Map(saved.map((card) => [card.name, card]));
  return roster
    .map((name) => byName.get(name))
    .filter((card): card is StanceCard => Boolean(card));
}

export function parseStanceCards(raw: unknown, allowNames?: string[]): StanceCard[] {
  const allow = new Set((allowNames || []).map((name) => name.trim()).filter(Boolean));
  if (typeof raw === "string") {
    const start = raw.indexOf(STANCE_MARK);
    const text = start >= 0 ? raw.slice(start + STANCE_MARK.length) : raw;
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      return parseStanceCards(JSON.parse(match[0]), allowNames);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const cards = raw
    .map((item) => asCard(item, allow.size ? allow : undefined))
    .filter((card): card is StanceCard => Boolean(card));
  const seen = new Set<string>();
  return cards.filter((card) => {
    if (seen.has(card.name)) return false;
    seen.add(card.name);
    return true;
  });
}

export function embedStanceNotes(notes: string, cards: StanceCard[]): string {
  const kept = cards.length ? cards : parseStanceCards(notes);
  const clean = String(notes || "")
    .replace(/\n*【人设卡】[\s\S]*$/, "")
    .trim();
  if (kept.length === 0) return clean;
  return `${clean}${clean ? "\n\n" : ""}${STANCE_MARK}\n${JSON.stringify(kept)}`;
}

export function formatStanceCards(cards: StanceCard[]): string {
  if (cards.length === 0) return "";
  return [
    "人设卡已锁死。对白必须按卡写，整集不能对调立场、权力和信息差。",
    ...cards.map((card) => {
      const intro = card.intro.trim();
      const bits = [
        intro ? `介绍：${intro}` : "",
        card.role ? `身份：${card.role}` : "",
        card.stance ? `立场：${card.stance}` : "",
        card.knows ? `知道：${card.knows}` : "",
        card.wants ? `要：${card.wants}` : "",
        card.address ? `称呼：${card.address}` : "",
        card.never ? `绝不说：${card.never}` : "",
      ].filter(Boolean);
      return `「${card.name}」${bits.join("。")}。`;
    }),
    "下属不能对主管下命令。不知情的人不能讲只有知情者才知道的事。谁在教、谁在问、谁在拍板，整集不能反。不要为了轮流说话把立场写反。",
  ].join("\n");
}

export function formatCastLine(card: StanceCard): string {
  const fakeRole = /^(拿主意的人|被压的人|在场的人|主角|配角)$/.test(card.role.trim());
  const who = card.role.trim() && !fakeRole ? `${card.name}（${card.role}）` : card.name;
  if (card.intro.trim()) return `${who} ${card.intro.trim()}`;
  if (card.stance.trim() && !isCannedStanceCard(card)) {
    return `${who} ${card.stance.trim()}`;
  }
  return who;
}

/** 给用户看的角色大纲：准稿里的真实介绍，不是压/被压模板。 */
export function formatCastOutline(cards: StanceCard[]): string {
  const lines = cards
    .filter((card) => !isCannedStanceCard(card))
    .map(formatCastLine)
    .filter(Boolean);
  if (lines.length === 0) return "";
  return ["角色大纲", ...lines].join("\n");
}

/** 剧情介绍不再塞角色大纲，人设卡在别处。 */
export function dropCastOutlineBlock(text: string): string {
  const t = String(text || "").trim();
  if (!/^角色大纲/.test(t)) return t;
  const parts = t.split(/\n\s*\n/);
  return parts.length > 1 ? parts.slice(1).join("\n\n").trim() : "";
}

export function textHasCastOutline(text: string, names?: string[]): boolean {
  const t = String(text || "");
  const list = [...new Set((names || []).map((n) => n.trim()).filter((n) => n.length >= 2))];
  if (list.length === 0) {
    return /角色大纲/.test(t) && /主角|对手|身份/.test(t);
  }
  const hit = list.filter((name) => t.includes(name)).length;
  return hit >= Math.min(list.length, Math.max(1, Math.ceil(list.length * 0.6))) &&
    /角色大纲|（主角|（对手|身份|对立|知道/.test(t);
}

export function episodeScriptBlob(
  episodes: Array<{ title?: string; hook?: string; voiceover?: string }>,
): string {
  return episodes
    .slice(0, 12)
    .map(
      (ep, i) =>
        `第${i + 1}集 ${ep.title || ""}\n钩子：${ep.hook || ""}\n口播：${ep.voiceover || ""}`,
    )
    .join("\n\n");
}

export function stanceCardsFromBriefs(
  briefs: Array<{ name: string; role?: string; intro?: string }>,
): StanceCard[] {
  const cards: StanceCard[] = [];
  const seen = new Set<string>();
  for (const brief of briefs) {
    const name = brief.name.trim().slice(0, 16);
    if (!name || name === "旁白" || seen.has(name)) continue;
    const role = String(brief.role || "")
      .replace(/拿主意的人|被压的人|在场的人|主角或配角/g, "")
      .trim()
      .slice(0, 24);
    const intro = String(brief.intro || "").replace(/\s+/g, " ").trim().slice(0, 180);
    if (!intro && !role) continue;
    if (isCannedStanceCard({ role, stance: intro, knows: "", wants: "", intro })) continue;
    seen.add(name);
    cards.push({
      name,
      role,
      intro,
      stance: intro,
      knows: "",
      wants: "",
      address: "",
      never: "",
    });
  }
  return cards;
}

function stanceWorldLine(hookStyle?: string): string {
  const card = showEngineCard(hookStyle);
  if (!card) return "";
  return `这个世界的味道：${card.root}。介绍要符合准稿，不要写成别的题材。`;
}

export async function generateStanceCards(input: {
  names: string[];
  hookStyle?: string;
  title?: string;
  body?: string;
  script?: string;
  briefs?: Array<{ name: string; role?: string; intro?: string }>;
}): Promise<StanceCard[]> {
  const names = [
    ...new Set(
      input.names
        .map((name) => name.trim())
        .filter((name) => name && name !== "旁白"),
    ),
  ];
  if (names.length === 0) return [];
  const seeded = stanceCardsFromBriefs(input.briefs || []).filter((card) =>
    names.includes(card.name),
  );
  if (
    seeded.length >= names.length &&
    seeded.every((card) => card.intro.trim().length >= 16) &&
    !seeded.some(isCannedStanceCard)
  ) {
    return names
      .map((name) => seeded.find((card) => card.name === name))
      .filter((card): card is StanceCard => Boolean(card));
  }
  const source = [input.script, input.body, input.title]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 8000);
  if (!source) return seeded;
  try {
    const raw = await chatCompletion(
      [
        {
          role: "system",
          content: `你在读短剧准稿，给每个人写真实介绍。先读准稿，再写这个人在本剧里是谁。
禁止套「拿主意的人 / 被压的人 / 在场的人」。
禁止写「压某某改一件事」「会问、会顶、会不服」「插一句或作证」这种空模板。
role 写剧里的身份，必须能从准稿读出来，例如边关守将、被定罪的妻子、押解的官差。不要写主角、配角、功能标签。
intro 写 40–90 字：是谁、和谁什么关系、这出戏里要干什么。全是准稿里的事，不要编权力课。
stance / knows / wants / address / never 也必须从准稿来，写具体。
只输出 JSON 数组，字段 name,role,intro,stance,knows,wants,address,never。name 必须用我给的原名。`,
        },
        {
          role: "user",
          content: `题材：${hookStyleLabel(input.hookStyle)}（${normalizeHookStyle(input.hookStyle)}）
${stanceWorldLine(input.hookStyle)}
出镜：${names.join("、")}
${seeded.length ? `已经认出：${seeded.map((card) => `${card.name} ${card.intro || card.role}`).join("；")}` : ""}

准稿：
${source}`,
        },
      ],
      {
        model: "deepseek-chat",
        temperature: 0.3,
        maxTokens: 1600,
        timeoutMs: 45_000,
      },
    );
    const parsed = parseStanceCards(raw, names).filter((card) => !isCannedStanceCard(card));
    const byName = new Map(parsed.map((card) => [card.name, card]));
    for (const seed of seeded) {
      const hit = byName.get(seed.name);
      if (!hit) {
        byName.set(seed.name, seed);
        continue;
      }
      if (!hit.intro.trim() && seed.intro) hit.intro = seed.intro;
      if (!hit.role.trim() && seed.role) hit.role = seed.role;
    }
    return names
      .map((name) => byName.get(name))
      .filter((card): card is StanceCard => Boolean(card));
  } catch {
    return seeded;
  }
}
