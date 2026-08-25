const PUBLIC_CDN_BASE = "https://cdn.dianwu.ai/files";

/** Old Vigma file hosts → cdn.dianwu.ai. */
export function rewritePublicMediaUrl(url: string): string {
  return url
    .replace(/^https?:\/\/files\.vigma\.app(?=\/|$)/i, PUBLIC_CDN_BASE)
    .replace(/^https?:\/\/api\.vigma\.app\/files(?=\/|$)/i, PUBLIC_CDN_BASE);
}

export function rewritePublicMediaInText(text: string): string {
  if (!text) return text;
  return text
    .replace(/https?:\/\/files\.vigma\.app(?=\/|"|'|$|\s)/gi, PUBLIC_CDN_BASE)
    .replace(/https?:\/\/api\.vigma\.app\/files(?=\/|"|'|$|\s)/gi, PUBLIC_CDN_BASE);
}

/** Default local app origin for server-side rewrite (Playwright / API). */
export function resolvePublicOrigin(explicit?: string | null): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_APP_ORIGIN?.trim() ||
    process.env.APP_ORIGIN?.trim() ||
    "";
  const raw = (explicit || fromEnv || "http://127.0.0.1:3000").trim();
  return raw.replace(/\/$/, "");
}

/**
 * Resolve relative / `../public/` paths and collapse `..` in already-absolute
 * URLs. Next.js serves files in /public at the site root, so `/public/foo.png`
 * on our origin becomes `/foo.png`.
 */
export function toAbsoluteMediaUrl(src: string, origin: string): string {
  const o = origin.replace(/\/$/, "");
  const s = (src || "").trim();
  if (!s || s.startsWith("data:") || s.startsWith("blob:") || s.startsWith("#")) {
    return s;
  }

  let href: string;
  try {
    if (s.startsWith("//")) {
      href = new URL(`https:${s}`).href;
    } else if (/^https?:\/\//i.test(s)) {
      href = new URL(s).href;
    } else {
      href = new URL(s, `${o}/`).href;
    }
  } catch {
    if (s.startsWith("/")) return `${o}${s}`;
    return `${o}/${s.replace(/^\.\//, "")}`;
  }

  try {
    const u = new URL(href);
    const originHost = new URL(`${o}/`).origin;
    if (u.origin === originHost) {
      u.pathname = u.pathname.replace(/^\/public\//, "/");
    }
    return rewritePublicMediaUrl(u.href);
  } catch {
    return rewritePublicMediaUrl(href);
  }
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
