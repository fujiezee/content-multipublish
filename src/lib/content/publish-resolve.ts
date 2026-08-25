import { ensureStoredInfographicsInHtml } from "@/lib/ai/apply-master-infographics";
import {
  articleToPublishContent,
  polishForPlatform,
  validateForPlatform,
} from "@/lib/content/adapt";
import { platformFamily } from "@/lib/content/platform-families";
import { getArticle, getVariant } from "@/lib/db";
import type { PlatformId, PublishContent } from "@/lib/types";

/** Server-only: pick family variant (if any) then polish for platform. */
export function publishContentForPlatform(
  articleId: string,
  platform: PlatformId,
  options?: { mediaOrigin?: string | null },
): PublishContent | null {
  const article = getArticle(articleId);
  if (!article) return null;
  const family = platformFamily(platform);
  const variant = getVariant(articleId, family);
  const rawBody = variant?.body?.trim() ? variant.body : article.body;
  const body = ensureStoredInfographicsInHtml(articleId, family, rawBody);
  const content = articleToPublishContent(article, {
    mediaOrigin: options?.mediaOrigin,
    variant: {
      title: variant?.title || article.title,
      body,
      summary: variant?.summary || article.summary,
    },
  });
  return polishForPlatform(platform, content);
}

export function validateArticleForPlatforms(
  articleId: string,
  platforms: PlatformId[],
): Record<string, string[]> {
  const warnings: Record<string, string[]> = {};
  const article = getArticle(articleId);
  for (const platform of platforms) {
    const content = publishContentForPlatform(articleId, platform);
    if (!content) continue;
    const family = platformFamily(platform);
    const variant = article ? getVariant(articleId, family) : null;
    const sourceTitle = (variant?.title || article?.title || "").trim();
    const w = validateForPlatform(platform, content, sourceTitle);
    if (w.length) warnings[platform] = w;
  }
  return warnings;
}
