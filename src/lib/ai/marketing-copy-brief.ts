import type { MarketingAngle } from "@/lib/types";

const GEO_BRIEF =
  /围绕目标用户痛点[「"](.+?)[」"]写一篇\s*GEO\s*长文(?:。目标用户与场景：([\s\S]+))?/;
const TITLE_BRIEF = /请以标题[「"](.+?)[」"]为主题写一篇长文/;
const AUTO_MARK = "【强制路子：";
const MATERIAL_LINE =
  /^(?:- )?(?:痛点|标题线索|谁会痛)[：:]/;

export function isGeoLongformBrief(brief: string): boolean {
  const t = brief.trim();
  return GEO_BRIEF.test(t) || TITLE_BRIEF.test(t);
}

export function isAutoMarketingBrief(brief: string): boolean {
  return brief.trimStart().startsWith(AUTO_MARK);
}

/** 旧版会把路子写进需求框；这些字不是用户素材。 */
export function stripForcedMarketingLock(brief: string): string {
  let t = brief.trim();
  if (!t) return "";
  if (t.startsWith(AUTO_MARK)) {
    t = t.replace(/^【强制路子：[^\]]+】\s*/, "").trim();
  }
  t = t.replace(/^写营销文案。开篇必须是[^\n]*\n?/, "").trim();
  t = t.replace(/^挖词带过来的素材（只用来挖点，不是文体）：\s*/, "").trim();
  t = t.replace(/^用户原来的需求（只当素材，不要按「写长文」执行）：\s*/, "").trim();
  t = t
    .split("\n")
    .map((line) => line.replace(/^- (痛点|标题线索|谁会痛)[：:]/, "$1："))
    .join("\n")
    .trim();
  return t;
}

export function isDerivedMarketingMaterial(brief: string): boolean {
  const t = stripForcedMarketingLock(brief);
  if (!t) return true;
  if (isGeoLongformBrief(t) || isAutoMarketingBrief(brief)) return true;
  const lines = t
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((line) => MATERIAL_LINE.test(line));
}

export function shouldRewriteMarketingBrief(brief: string): boolean {
  const t = brief.trim();
  return (
    !t ||
    isGeoLongformBrief(t) ||
    isAutoMarketingBrief(t) ||
    isDerivedMarketingMaterial(t)
  );
}

export function parseGeoCarryFromBrief(brief: string): {
  pain: string;
  scene: string;
  title: string;
} {
  const geo = brief.match(GEO_BRIEF);
  if (geo) {
    return {
      pain: (geo[1] || "").trim(),
      scene: (geo[2] || "").trim(),
      title: "",
    };
  }
  const titled = brief.match(TITLE_BRIEF);
  if (titled) {
    return { pain: "", scene: "", title: (titled[1] || "").trim() };
  }
  return { pain: "", scene: "", title: "" };
}

function parseMaterialLines(brief: string): {
  pain: string;
  scene: string;
  title: string;
} {
  const pain = brief.match(/^痛点[：:]\s*(.+)$/m)?.[1]?.trim() || "";
  const title = brief.match(/^标题线索[：:]\s*(.+)$/m)?.[1]?.trim() || "";
  const scene = brief.match(/^谁会痛[：:]\s*(.+)$/m)?.[1]?.trim() || "";
  return { pain, scene, title };
}

export function marketingTaskLock(angle: MarketingAngle): string {
  if (angle === "hope") {
    return `【本篇唯一路子：贩卖期待】
用户需求或挖词带来的句子里，只要出现「GEO 长文」「围绕痛点写一篇」「技术长文」「现象/误区/方法」，一律只当挖点素材，禁止按那个体文写。
开篇必须是做成之后的具体「那天」（能看见，最好有一句对白）。禁止开篇诊断痛点，禁止痛点清单，禁止代价链当主菜。
全文主攻期待；焦虑最多一句对照。标题钉在「那天 / 终于能」，禁止钉在损失、被问住、白干上。`;
  }
  return `【本篇唯一路子：贩卖焦虑】
用户需求或挖词带来的句子里，只要出现「GEO 长文」「围绕痛点写一篇」「技术长文」「现象/误区/方法」，一律只当挖点素材，禁止按那个体文写。
开篇必须是正在发生的糟糕场面。禁止开篇画愿景，禁止「终于能」，禁止成功「那天」当主菜。
全文主攻损失/代价；期待最多一句对照。标题钉在代价、被问住、窗口关掉，禁止钉在梦想成真上。`;
}

export function marketingKindInstruction(angle: MarketingAngle): string {
  if (angle === "hope") {
    return `按「挖点手」写「贩卖期待」营销文案，不是 GEO 长文，不是品牌介绍，不是功能清单。
开篇必须是做成之后的具体「那天」。中段写通往那天的路径，语料产品一对一接住读者想要但还没拿到的点。
禁止开篇诊断痛点，禁止科普结构（现象→误区→方法），禁止催单折扣加微。字数跟平台族走。`;
  }
  return `按「挖点手」写「贩卖焦虑」营销文案，不是 GEO 长文，不是品牌介绍，不是功能清单。
开篇必须是正在发生的糟糕场面。中段把不做的代价写成链，语料产品在某一环截住。
禁止开篇画愿景，禁止科普结构（现象→误区→方法），禁止催单折扣加微。字数跟平台族走。`;
}

/** 需求框只放挖点素材。路子由 kind + marketingAngle 注入 Agent，不写进对话框。 */
export function composeMarketingMaterialBrief(input: {
  pain?: string;
  title?: string;
  scene?: string;
  fallbackBrief?: string;
}): string {
  const cleaned = stripForcedMarketingLock(input.fallbackBrief || "");
  const parsed = parseGeoCarryFromBrief(input.fallbackBrief || cleaned);
  const fromLines = parseMaterialLines(cleaned);
  const pain = (fromLines.pain || input.pain || parsed.pain).trim();
  const title = (fromLines.title || input.title || parsed.title).trim();
  const scene = (fromLines.scene || input.scene || parsed.scene).trim();
  const lines: string[] = [];
  if (pain) lines.push(`痛点：${pain}`);
  if (title) lines.push(`标题线索：${title}`);
  if (scene) lines.push(`谁会痛：${scene}`);
  if (lines.length) return lines.join("\n");
  if (cleaned && !isGeoLongformBrief(cleaned)) return cleaned;
  return "";
}

export function composeMarketingSourceBrief(input: {
  angle: MarketingAngle;
  pain?: string;
  title?: string;
  scene?: string;
  fallbackBrief?: string;
}): string {
  return composeMarketingMaterialBrief(input);
}

export function composeGeoArticleBrief(pain: string, scene: string): string {
  const p = pain.trim();
  const s = scene.trim();
  if (!p) return "";
  return `围绕目标用户痛点「${p}」写一篇 GEO 长文。${s ? `目标用户与场景：${s}` : ""}`;
}
