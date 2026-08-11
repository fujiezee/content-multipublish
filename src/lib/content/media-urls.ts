/** Default local app origin for server-side rewrite (Playwright / API). */
export function resolvePublicOrigin(explicit?: string | null): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_APP_ORIGIN?.trim() ||
    process.env.APP_ORIGIN?.trim() ||
    "";
  const raw = (explicit || fromEnv || "http://127.0.0.1:3000").trim();
  return raw.replace(/\/$/, "");
}

export function toAbsoluteMediaUrl(src: string, origin: string): string {
  const o = origin.replace(/\/$/, "");
  const s = (src || "").trim();
  if (!s || s.startsWith("data:") || s.startsWith("blob:") || s.startsWith("#")) {
    return s;
  }
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) return `${o}${s}`;
  return `${o}/${s.replace(/^\.\//, "")}`;
}

function shouldRewriteUrl(url: string): boolean {
  const s = url.trim();
  if (!s) return false;
  if (
    s.startsWith("data:") ||
    s.startsWith("blob:") ||
    s.startsWith("#") ||
    s.startsWith("mailto:") ||
    s.startsWith("javascript:")
  ) {
    return false;
  }
  if (/^https?:\/\//i.test(s)) return false;
  return true;
}

/** Rewrite relative /api/uploads and other media paths to absolute URLs. */
export function absolutizeHtmlMedia(
  html: string,
  origin?: string | null,
): string {
  if (!html) return html;
  const base = resolvePublicOrigin(origin);
  return html.replace(
    /(\s(?:src|href|poster)=["'])([^"']+)(["'])/gi,
    (full, pre: string, url: string, post: string) => {
      if (!shouldRewriteUrl(url)) return full;
      // Prefer rewriting upload / relative paths; skip obvious external protocol-less leftovers
      return `${pre}${toAbsoluteMediaUrl(url, base)}${post}`;
    },
  );
}

/** Rewrite markdown image/link targets that point to local uploads. */
export function absolutizeMarkdownMedia(
  markdown: string,
  origin?: string | null,
): string {
  if (!markdown) return markdown;
  const base = resolvePublicOrigin(origin);
  return markdown.replace(
    /(!?\[[^\]]*]\()([^)\s]+)(\))/g,
    (full, pre: string, url: string, post: string) => {
      if (!shouldRewriteUrl(url)) return full;
      return `${pre}${toAbsoluteMediaUrl(url, base)}${post}`;
    },
  );
}
