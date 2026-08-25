const COVER_MARK = "data-article-cover";

function resolveCoverSrc(
  coverPath: string | null | undefined,
  origin: string,
): string | undefined {
  if (!coverPath?.trim()) return undefined;
  const raw = coverPath.trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `${origin.replace(/\/$/, "")}${raw}`;
  const name = raw.split("/").pop();
  return name ? `${origin.replace(/\/$/, "")}/api/uploads/${name}` : undefined;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Drop a previously inserted article-cover image (and its wrapping paragraph). */
export function removeCoverFromBody(html: string): string {
  if (!html) return "";
  return html
    .replace(/<p[^>]*>\s*<img\b[^>]*data-article-cover[^>]*>\s*<\/p>/gi, "")
    .replace(/<img\b[^>]*data-article-cover[^>]*>/gi, "")
    .replace(/^(?:\s|<br\s*\/?>)+/i, "");
}

/** Put the cover image at the top of the article body, replacing any old one. */
export function upsertCoverInBody(
  html: string,
  src: string,
  alt = "封面",
): string {
  const cleaned = removeCoverFromBody(html || "");
  const img = `<p><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" ${COVER_MARK}="1" style="display:block;max-width:100%;height:auto;margin:0 auto 1.1em;"></p>`;
  return cleaned.trim() ? `${img}${cleaned}` : img;
}

/** Read the canonical cover image URL from master/editor HTML. */
export function extractCoverSrcFromHtml(html: string): string | undefined {
  if (!html) return undefined;
  const tagged =
    /<img\b[^>]*\bdata-article-cover[^>]*\bsrc=["']([^"']+)["']/i.exec(html) ||
    /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*\bdata-article-cover/i.exec(html);
  if (tagged?.[1]) return tagged[1].replace(/&amp;/g, "&").trim();
  return undefined;
}

/** Ensure generated variants / sync payloads include the article cover image. */
export function ensureCoverInBodyHtml(
  html: string,
  coverPath: string | null | undefined,
  coverSrc: string | null | undefined,
  title = "封面",
  origin = "",
): string {
  if (!coverPath?.trim() && !coverSrc?.trim()) return html;
  const src =
    coverSrc?.trim() ||
    (coverPath && origin ? resolveCoverSrc(coverPath, origin) : coverPath?.trim());
  if (!src) return html;
  // Always upsert: variants may keep a stale /api/uploads cover or drop the img entirely.
  return upsertCoverInBody(html, src, title || "封面");
}
