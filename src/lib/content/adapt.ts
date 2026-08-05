import { marked } from "marked";
import TurndownService from "turndown";
import type { Article, PublishContent } from "@/lib/types";

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

export function articleToPublishContent(article: Article): PublishContent {
  const raw = article.body || "";
  const bodyHtml = toEditorHtml(raw);
  const bodyText = htmlToText(bodyHtml);
  const bodyMarkdown = looksLikeHtml(raw)
    ? htmlToMarkdown(bodyHtml)
    : raw.trim() || htmlToMarkdown(bodyHtml);

  return {
    title: article.title.trim(),
    bodyMarkdown,
    bodyHtml,
    bodyText,
    summary: article.summary?.trim() || bodyText.slice(0, 120),
    coverPath: article.cover_path,
  };
}

/** Normalize stored body to HTML for the rich text editor / publishers. */
export function toEditorHtml(raw: string): string {
  if (!raw.trim()) return "";
  if (looksLikeHtml(raw)) return raw;
  return marked.parse(raw, { async: false }) as string;
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

  return warnings;
}
