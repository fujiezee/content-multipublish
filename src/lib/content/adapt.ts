import { marked } from "marked";
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
} from "@/lib/content/media-urls";
import type { Article, PlatformId, PublishContent } from "@/lib/types";

marked.setOptions({ gfm: true, breaks: true });

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
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

function htmlToMarkdown(html: string) {
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
  const bodyHtml = absolutizeHtmlMedia(
    toEditorHtml(raw),
    fields.mediaOrigin,
  );
  const bodyText = htmlToText(bodyHtml);
  const bodyMarkdownRaw = looksLikeHtml(raw)
    ? htmlToMarkdown(bodyHtml)
    : raw.trim() || htmlToMarkdown(bodyHtml);
  const bodyMarkdown = absolutizeMarkdownMedia(
    bodyMarkdownRaw,
    fields.mediaOrigin,
  );

  return {
    title: fields.title.trim(),
    bodyMarkdown,
    bodyHtml,
    bodyText,
    summary: fields.summary?.trim() || bodyText.slice(0, 120),
    coverPath: fields.coverPath ?? null,
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

/** Normalize stored body to HTML for the rich text editor / publishers. */
export function toEditorHtml(raw: string): string {
  if (!raw.trim()) return "";
  if (looksLikeHtml(raw)) return raw;
  return marked.parse(raw, { async: false }) as string;
}

function applyBanReplacements(text: string, family: PlatformFamily): string {
  let out = text;
  for (const rule of FAMILY_BAN_REPLACEMENTS[family] || []) {
    out = out.replace(rule.pattern, rule.replace);
  }
  return out;
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
  if (maxTitle && title.length > maxTitle) {
    title = title.slice(0, maxTitle).trim();
  }

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
): string[] {
  const warnings: string[] = [];
  const titleLen = content.title.length;
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
    (platform === "xiaohongshu" || platform === "douyin") &&
    titleLen > 20
  ) {
    warnings.push(`标题建议 ≤ 20 字（当前 ${titleLen}）`);
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
