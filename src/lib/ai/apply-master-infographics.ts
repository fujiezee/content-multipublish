import {
  dedupeInfographicImgsInHtml,
  htmlHasInfographicUrl,
  insertInfographicsIntoHtml,
  mergeInfographicHtml,
  placementsFromInfographicRows,
  unwrapInfographicParagraphs,
} from "@/lib/ai/infographic-insert";
import type { PlatformFamily } from "@/lib/content/platform-families";
import { listArticleInfographics } from "@/lib/db";

/** Infographic rows are stored under master, except social-only runs. */
function infographicRecordFamily(
  family: PlatformFamily | "master",
): "master" | "social" {
  return family === "social" ? "social" : "master";
}

/** Re-insert stored infographic URLs that are missing from the HTML (editor save/sync safety net). */
export function ensureStoredInfographicsInHtml(
  articleId: string,
  family: PlatformFamily | "master",
  html: string,
): string {
  const rows = listArticleInfographics(
    articleId,
    infographicRecordFamily(family),
  );
  const source = dedupeInfographicImgsInHtml(
    unwrapInfographicParagraphs(html || ""),
  );
  if (!rows.length) return source;
  const placements = placementsFromInfographicRows(rows);
  const missing = placements.filter(
    (p) => p.url && !htmlHasInfographicUrl(source, p.url),
  );
  if (!missing.length) return source;
  return insertInfographicsIntoHtml(source, missing);
}

export { mergeInfographicHtml };

/** Insert the article's existing infographics into a newly generated variant. */
export function applyMasterInfographicsToHtml(
  articleId: string,
  family: PlatformFamily,
  html: string,
): string {
  return ensureStoredInfographicsInHtml(articleId, family, html);
}
