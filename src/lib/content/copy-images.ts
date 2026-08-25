import type { CorpusItem } from "@/lib/types";

export function corpusAssetUrls(items: CorpusItem[]): string[] {
  return items.flatMap((item) =>
    (item.assets || []).map((asset) => asset.url.trim()).filter(Boolean),
  );
}

export function htmlImageSrcs(html: string): string[] {
  const urls: string[] = [];
  const re = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const src = (match[1] || match[2] || match[3] || "")
      .trim()
      .replace(/&amp;/g, "&");
    if (src) urls.push(src);
  }
  return urls;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/^<|>$/g, "").replace(/&amp;/g, "&");
}

function isUploadPath(url: string): boolean {
  try {
    const path = url.startsWith("http") ? new URL(url).pathname : url;
    return path.startsWith("/api/uploads/") || path.startsWith("/uploads/");
  } catch {
    return url.includes("/api/uploads/") || url.includes("/uploads/");
  }
}

function isAllowedCopyImageUrl(url: string, allowed: Set<string>): boolean {
  const src = normalizeUrl(url);
  if (!src) return false;
  if (src.startsWith("data:image/")) return true;
  if (isUploadPath(src)) return true;
  if (allowed.has(src)) return true;
  for (const item of allowed) {
    if (!item) continue;
    if (src === item || src.startsWith(item) || item.startsWith(src)) return true;
    try {
      const a = new URL(item);
      const b = new URL(src);
      if (a.origin === b.origin && a.pathname === b.pathname) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

/**
 * Drop invented markdown/HTML images. Keep corpus assets, uploads, and
 * any extra URLs explicitly allow-listed (e.g. infographics already in the master).
 */
export function stripUnauthorizedCopyImages(
  input: string,
  allowedUrls: Iterable<string> = [],
): string {
  if (!input) return input;
  const allowed = new Set(
    [...allowedUrls].map((url) => normalizeUrl(url)).filter(Boolean),
  );

  let out = input.replace(
    /!\[[^\]]*]\(\s*<?([^)\s>]+)>?[^)]*\)/g,
    (full, url: string) => (isAllowedCopyImageUrl(url, allowed) ? full : ""),
  );

  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const src =
      /src\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ||
      /src\s*=\s*'([^']*)'/i.exec(tag)?.[1] ||
      /src\s*=\s*([^\s>]+)/i.exec(tag)?.[1];
    if (!src) return "";
    return isAllowedCopyImageUrl(src, allowed) ? tag : "";
  });

  return out
    .replace(/<p>\s*<\/p>/gi, "")
    .replace(/\n{3,}/g, "\n\n");
}
