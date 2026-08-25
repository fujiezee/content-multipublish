import TurndownService from "turndown";
import {
  FAMILY_BAN_REPLACEMENTS,
  PLATFORM_TITLE_MAX,
  platformFamily,
  type PlatformFamily,
} from "@/lib/content/platform-families";
import {
  absolutizeHtmlMedia,
  absolutizeMarkdownMedia,
  resolvePublicOrigin,
  rewritePublicMediaUrl,
} from "@/lib/content/media-urls";
import {
  hydrateMarkdownTables,
  markdownToHtml,
} from "@/lib/content/markdown";
import { unwrapInfographicParagraphs } from "@/lib/ai/infographic-insert";
import { ensureCoverInBodyHtml } from "@/lib/content/cover-html";
import type { Article, PlatformId, PublishContent } from "@/lib/types";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

function cellText(cell: { textContent?: string | null }): string {
  return (cell.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\|/g, "\\|");
}

turndown.addRule("gfmTable", {
  filter: "table",
  replacement(_content, node) {
    if (!("querySelectorAll" in node)) return "\n\n";
    const rows = Array.from(
      (node as unknown as { querySelectorAll: (sel: string) => ArrayLike<Element> }).querySelectorAll(
        "tr",
      ),
    );
    if (!rows.length) return "\n\n";
    const grid = rows.map((row) =>
      Array.from(row.querySelectorAll("th, td")).map(cellText),
    );
    const width = Math.max(1, ...grid.map((cols) => cols.length));
    const padded = grid.map((cols) => {
      const next = cols.slice();
      while (next.length < width) next.push("");
      return next;
    });
    const line = (cols: string[]) => `| ${cols.join(" | ")} |`;
    const header = padded[0] ?? Array.from({ length: width }, () => "");
    const body = padded.slice(1);
    return `\n\n${line(header)}\n${line(header.map(() => "---"))}${
      body.length ? `\n${body.map(line).join("\n")}` : ""
    }\n\n`;
  },
});

function looksLikeHtml(input: string) {
  return /^\s*</.test(input);
}

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToMarkdown(html: string) {
  try {
    return turndown.turndown(html).trim();
  } catch {
    return htmlToText(html);
  }
}

function isEmptyHtml(html: string) {
  return htmlToText(html).length === 0 && !/<img\b/i.test(html);
}

export function fieldsToPublishContent(fields: {
  title: string;
  body: string;
  summary?: string;
  coverPath?: string | null;
  /** Origin for rewriting /api/uploads → absolute (defaults 127.0.0.1:3000) */
  mediaOrigin?: string | null;
}): PublishContent {
  const raw = fields.body || "";
  const bodyHtmlBase = absolutizeHtmlMedia(
    toEditorHtml(raw),
    fields.mediaOrigin,
  );
  const origin = resolvePublicOrigin(fields.mediaOrigin);
  const coverPath = fields.coverPath
    ? rewritePublicMediaUrl(fields.coverPath)
    : fields.coverPath;
  const bodyHtml = ensureCoverInBodyHtml(
    bodyHtmlBase,
    coverPath,
    coverPath?.startsWith("http") ? coverPath : undefined,
    fields.title.trim() || "封面",
    origin,
  );
  const bodyText = htmlToText(bodyHtml);
  // Derive markdown from final HTML so cover img is never HTML-only (CSDN/腾讯云等走 markdown).
  const bodyMarkdown = absolutizeMarkdownMedia(
    htmlToMarkdown(bodyHtml),
    fields.mediaOrigin,
  );

  return {
    title: fields.title.trim(),
    bodyMarkdown,
    bodyHtml,
    bodyText,
    summary: fields.summary?.trim() || bodyText.slice(0, 120),
    coverPath: coverPath ?? null,
  };
}

export function articleToPublishContent(
  article: Article,
  options?: {
    variant?: { title?: string; body?: string; summary?: string } | null;
    mediaOrigin?: string | null;
  },
): PublishContent {
  const variant = options?.variant;
  if (variant?.body?.trim()) {
    return fieldsToPublishContent({
      title: variant.title || article.title,
      body: variant.body,
      summary: variant.summary || article.summary,
      coverPath: article.cover_path,
      mediaOrigin: options?.mediaOrigin,
    });
  }
  return fieldsToPublishContent({
    title: article.title,
    body: article.body,
    summary: article.summary,
    coverPath: article.cover_path,
    mediaOrigin: options?.mediaOrigin,
  });
}

/** Leftover markdown inside HTML (e.g. **加粗** after a mixed paste). */
function renderInlineMarkdown(html: string): string {
  return html
    .replace(/<strong>([^<]*)<strong>/gi, "<strong>$1</strong>")
    .replace(/<\/strong>([^<]+)<\/strong>/gi, (_, text: string) => `<strong>${text}</strong>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** Normalize stored body to HTML for the rich text editor / publishers. */
export function toEditorHtml(raw: string): string {
  if (!raw.trim()) return "";
  const html = looksLikeHtml(raw)
    ? hydrateMarkdownTables(raw)
    : markdownToHtml(raw);
  return unwrapInfographicParagraphs(renderInlineMarkdown(html));
}

function applyBanReplacements(text: string, family: PlatformFamily): string {
  let out = text;
  for (const rule of FAMILY_BAN_REPLACEMENTS[family] || []) {
    out = out.replace(rule.pattern, rule.replace);
  }
  return out;
}

export function titleCharLength(text: string): number {
  return Array.from(text || "").length;
}

/** Cut at a punctuation/space near the limit so the title still reads complete. */
export function clampTitle(title: string, max: number): string {
  const trimmed = title.replace(/\s+/g, " ").trim();
  const chars = Array.from(trimmed);
  if (!max || chars.length <= max) return trimmed;
  const slice = chars.slice(0, max).join("");
  const cut = Math.max(
    slice.lastIndexOf("。"),
    slice.lastIndexOf("！"),
    slice.lastIndexOf("？"),
    slice.lastIndexOf("，"),
    slice.lastIndexOf("、"),
    slice.lastIndexOf("："),
    slice.lastIndexOf(":"),
    slice.lastIndexOf(" "),
    slice.lastIndexOf("|"),
    slice.lastIndexOf("｜"),
  );
  const out = (cut >= Math.floor(max * 0.55) ? slice.slice(0, cut) : slice).trim();
  return out || slice.trim();
}

/** Rule-based polish: title caps, summary trim, family phrase softeners. */
export function polishForPlatform(
  platform: PlatformId,
  content: PublishContent,
): PublishContent {
  const family = platformFamily(platform);
  let title = applyBanReplacements(content.title, family);
  let bodyHtml = applyBanReplacements(content.bodyHtml, family);
  let bodyMarkdown = applyBanReplacements(content.bodyMarkdown, family);
  let bodyText = applyBanReplacements(content.bodyText, family);
  let summary = applyBanReplacements(content.summary, family);

  const maxTitle = PLATFORM_TITLE_MAX[platform];
  // 抖音文章超 30 字在发布时重写，这里不截断，也不连坐同族的百家号。
  if (maxTitle && platform !== "douyin") title = clampTitle(title, maxTitle);

  if (summary.length > 120) {
    summary = summary.slice(0, 120).trim();
  }

  if (
    family === "finance" &&
    bodyText &&
    !/不构成投资建议|风险提示|投资有风险/.test(bodyText)
  ) {
    const note =
      "\n\n<p><strong>风险提示：</strong>以上内容仅供讨论，不构成投资建议；市场有风险，决策需谨慎。</p>";
    const mdNote =
      "\n\n**风险提示：**以上内容仅供讨论，不构成投资建议；市场有风险，决策需谨慎。";
    bodyHtml = `${bodyHtml}${note}`;
    bodyMarkdown = `${bodyMarkdown}${mdNote}`;
    bodyText = htmlToText(bodyHtml);
  }

  return {
    title,
    bodyHtml,
    bodyMarkdown,
    bodyText,
    summary,
    coverPath: content.coverPath,
  };
}

export function validateForPlatform(
  platform: string,
  content: PublishContent,
  sourceTitle?: string,
): string[] {
  const warnings: string[] = [];
  const titleLen = titleCharLength(content.title);
  const sourceLen = titleCharLength(sourceTitle ?? content.title);
  const textLen = content.bodyText.length;

  if (!content.title) warnings.push("标题不能为空");
  if (isEmptyHtml(content.bodyHtml)) warnings.push("正文不能为空");

  if (platform === "weibo" && titleLen > 32) {
    warnings.push(`微博标题建议 ≤ 32 字（当前 ${titleLen}）`);
  }
  if (platform === "baijiahao") {
    if (titleLen < 2 || titleLen > 64) {
      warnings.push(`百家号标题建议 2–64 字（当前 ${titleLen}）`);
    }
    if (textLen < 300) {
      warnings.push(`百家号正文建议 ≥ 300 字（当前约 ${textLen}）`);
    }
  }
  if (platform === "zhihu" && titleLen > 100) {
    warnings.push(`知乎标题建议 ≤ 100 字（当前 ${titleLen}）`);
  }
  if (platform === "jianshu" && titleLen > 80) {
    warnings.push(`简书标题建议 ≤ 80 字（当前 ${titleLen}）`);
  }
  if (platform === "csdn" && titleLen > 100) {
    warnings.push(`CSDN 标题建议 ≤ 100 字（当前 ${titleLen}）`);
  }
  if (platform === "toutiao") {
    if (titleLen < 2 || titleLen > 30) {
      warnings.push(`头条号标题建议 2–30 字（当前 ${titleLen}）`);
    }
  }
  if (platform === "juejin" && titleLen > 80) {
    warnings.push(`掘金标题建议 ≤ 80 字（当前 ${titleLen}）`);
  }
  if (platform === "bilibili" && titleLen > 40) {
    warnings.push(`B站专栏标题建议 ≤ 40 字（当前 ${titleLen}）`);
  }
  if (platform === "weixin" && titleLen > 64) {
    warnings.push(`公众号标题建议 ≤ 64 字（当前 ${titleLen}）`);
  }
  if (
    (platform === "sohu" ||
      platform === "dayu" ||
      platform === "yidian" ||
      platform === "sohufocus" ||
      platform === "netease") &&
    titleLen > 64
  ) {
    warnings.push(`标题建议 ≤ 64 字（当前 ${titleLen}）`);
  }
  if (
    platform === "xiaohongshu" &&
    titleLen > 20
  ) {
    warnings.push(`标题建议 ≤ 20 字（当前 ${titleLen}）`);
  }
  if (platform === "douyin") {
    if (sourceLen > 30) {
      warnings.push(
        `抖音文章标题限制 30 字（当前 ${sourceLen}），发布时会按抖音文章重写，不截断`,
      );
    } else if (titleLen < 2) {
      warnings.push("抖音文章标题至少 2 字");
    }
  }
  if (platform === "shunqi") {
    if (titleLen > 80) {
      warnings.push(`顺企网标题建议 ≤ 80 字（当前 ${titleLen}）`);
    }
    const hasImg =
      /<img[\s>]/i.test(content.bodyHtml || "") || Boolean(content.coverPath);
    if (!hasImg) {
      warnings.push("顺企网新闻可上传 1 张配图，建议加封面或正文图");
    }
  }
  if (platform === "shunqi_product") {
    if (titleLen > 80) {
      warnings.push(`顺企网产品名称建议 ≤ 80 字（当前 ${titleLen}）`);
    }
    const hasImg =
      /<img[\s>]/i.test(content.bodyHtml || "") || Boolean(content.coverPath);
    if (!hasImg) {
      warnings.push("顺企网产品需要上传图片，请加封面或正文图");
    }
  }
  if (platform === "bafang") {
    if (titleLen > 32) {
      warnings.push(`八方资源网标题建议 ≤ 32 字（当前 ${titleLen}）`);
    }
    const hasImg =
      /<img[\s>]/i.test(content.bodyHtml || "") || Boolean(content.coverPath);
    if (!hasImg) {
      warnings.push("八方资源网发布产品需要图片，请加封面或正文图");
    }
  }
  if (platform === "smzdm" && titleLen > 60) {
    warnings.push(`什么值得买标题建议 ≤ 60 字（当前 ${titleLen}）`);
  }
  if (platform === "eastmoney" && titleLen > 80) {
    warnings.push(`东方财富标题建议 ≤ 80 字（当前 ${titleLen}）`);
  }
  if (platform === "x" && titleLen > 100) {
    warnings.push(`X 标题建议 ≤ 100 字（当前 ${titleLen}）`);
  }
  if (platform === "qiehao") {
    if (titleLen < 5 || titleLen > 64) {
      warnings.push(`企鹅号标题需 5–64 字（当前 ${titleLen}）`);
    }
  }
  if (
    (platform === "dafeng" ||
      platform === "kuaichuan" ||
      platform === "sinakandian" ||
      platform === "dongfang" ||
      platform === "btime" ||
      platform === "peoplehao" ||
      platform === "xinhuahao" ||
      platform === "zhongqing") &&
    titleLen > 64
  ) {
    warnings.push(`标题建议 ≤ 64 字（当前 ${titleLen}）`);
  }
  if (platform === "tencentcloud" && titleLen > 80) {
    warnings.push(`腾讯云+ 标题建议 ≤ 80 字（当前 ${titleLen}）`);
  }
  if (platform === "aliyun" && titleLen > 100) {
    warnings.push(`阿里云开发者标题建议 ≤ 100 字（当前 ${titleLen}）`);
  }
  if (platform === "huaweicloud" && titleLen > 64) {
    warnings.push(`华为云社区标题建议 ≤ 64 字（当前 ${titleLen}）`);
  }

  return warnings;
}
