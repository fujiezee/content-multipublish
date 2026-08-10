import fs from "node:fs";
import path from "node:path";

export type ParsedArticle = {
  title: string;
  markdown: string;
  content?: string;
  cover?: string;
};

/** Extract title from front matter or first AT heading. */
export function parseArticleFile(
  filePath: string,
  options: { title?: string; cover?: string } = {},
): ParsedArticle {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`文件不存在: ${abs}`);
  }
  const raw = fs.readFileSync(abs, "utf8");
  const ext = path.extname(abs).toLowerCase();

  if (ext === ".html" || ext === ".htm") {
    const title =
      options.title ||
      raw.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ||
      raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ||
      path.basename(abs, ext);
    return {
      title,
      markdown: "",
      content: raw,
      cover: options.cover,
    };
  }

  let body = raw;
  let fmTitle: string | undefined;
  let fmCover: string | undefined;

  if (raw.startsWith("---")) {
    const end = raw.indexOf("\n---", 3);
    if (end !== -1) {
      const fm = raw.slice(3, end).trim();
      body = raw.slice(end + 4).replace(/^\s*\n/, "");
      const titleMatch = fm.match(/^title:\s*["']?(.+?)["']?\s*$/m);
      const coverMatch = fm.match(/^cover:\s*["']?(.+?)["']?\s*$/m);
      if (titleMatch) fmTitle = titleMatch[1].trim();
      if (coverMatch) fmCover = coverMatch[1].trim();
    }
  }

  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = options.title || fmTitle || heading || path.basename(abs, ext);

  let markdown = body;
  if (heading && title === heading) {
    markdown = body.replace(/^#\s+.+\n?/, "").trimStart();
  }

  return {
    title,
    markdown: markdown || body,
    cover: options.cover || fmCover,
  };
}
