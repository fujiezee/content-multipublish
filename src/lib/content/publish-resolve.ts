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
  const content = articleToPublishContent(article, {
    mediaOrigin: options?.mediaOrigin,
    variant: variant
      ? {
          title: variant.title,
          body: variant.body,
          summary: variant.summary,
        }
      : null,
  });
  return polishForPlatform(platform, content);
}

export function validateArticleForPlatforms(
  articleId: string,
  platforms: PlatformId[],
): Record<string, string[]> {
  const warnings: Record<string, string[]> = {};
  for (const platform of platforms) {
    const content = publishContentForPlatform(articleId, platform);
    if (!content) continue;
    const w = validateForPlatform(platform, content);
    if (w.length) warnings[platform] = w;
  }
  return warnings;
}
