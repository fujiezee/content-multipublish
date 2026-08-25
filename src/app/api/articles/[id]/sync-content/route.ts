import { NextResponse } from "next/server";
import { rewriteDouyinArticleTitle } from "@/lib/ai/douyin-title";
import { familyLabel, platformFamily } from "@/lib/content/platform-families";
import {
  absolutizeHtmlMedia,
  absolutizeMarkdownMedia,
  resolvePublicOrigin,
} from "@/lib/content/media-urls";
import { requireApiUser } from "@/lib/auth/api";
import { getVariant, getArticleInWorkspace, listVariants, updateArticle } from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import { htmlToMarkdown } from "@/lib/content/adapt";
import { ensureCoverInBodyHtml, upsertCoverInBody } from "@/lib/content/cover-html";
import { publishContentForPlatform } from "@/lib/content/publish-resolve";
import {
  assertPublicMediaOrThrow,
  hasNonPublicMedia,
  publishLocalCoverPath,
  publishLocalMediaInHtml,
  publishLocalMediaInMarkdown,
} from "@/lib/storage/public-media";
import type { PlatformId } from "@/lib/types";
import { ALL_PLATFORM_IDS } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requireApiUser(req);
    if (!auth.ok) return auth.response;
    const { id } = await ctx.params;
    const article = getArticleInWorkspace(id, auth.ctx.workspaceId);
    if (!article) {
      return NextResponse.json({ error: "文章不存在" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const raw = Array.isArray(body.platforms) ? body.platforms : [];
    const platforms = raw.filter((p: unknown): p is PlatformId =>
      ALL_PLATFORM_IDS.includes(p as PlatformId),
    ) as PlatformId[];

    if (!platforms.length) {
      return NextResponse.json({ error: "请选择平台" }, { status: 400 });
    }

    const origin = resolvePublicOrigin(
      typeof body.origin === "string"
        ? body.origin
        : req.headers.get("origin"),
    );

    const variants = listVariants(id);
    const byFamily = new Map<
      string,
      {
        family: string;
        familyLabel: string;
        platforms: PlatformId[];
        title: string;
        content: string;
        markdown: string;
        summary: string;
        cover?: string;
        usedVariant: boolean;
      }
    >();

    for (const platform of platforms) {
      const bodyFamily = platformFamily(platform);
      const family = platform === "douyin" ? "douyin" : bodyFamily;
      const content = publishContentForPlatform(id, platform, {
        mediaOrigin: origin,
      });
      if (!content) continue;
      if (platform === "douyin") {
        content.title = await rewriteDouyinArticleTitle(
          content.title,
          content.bodyText,
        );
      }
      const existing = byFamily.get(family);
      if (existing) {
        existing.platforms.push(platform);
        continue;
      }
      const variant = getVariant(id, bodyFamily);
      // Absolutize first, then push local /api/uploads to public CDN (Zhihu
      // server-side fetch cannot reach 127.0.0.1).
      const absoluteHtml = absolutizeHtmlMedia(content.bodyHtml, origin);
      const absoluteMd = absolutizeMarkdownMedia(content.bodyMarkdown, origin);
      const [html, markdown] = await Promise.all([
        publishLocalMediaInHtml(absoluteHtml, origin),
        publishLocalMediaInMarkdown(absoluteMd, origin),
      ]);
      const label =
        platform === "douyin" ? "抖音文章" : familyLabel(bodyFamily);
      assertPublicMediaOrThrow(html, `${label}正文`);
      assertPublicMediaOrThrow(markdown, `${label} Markdown`);
      byFamily.set(family, {
        family,
        familyLabel: label,
        platforms: [platform],
        title: content.title,
        content: html,
        markdown,
        summary: content.summary,
        usedVariant: Boolean(variant?.body?.trim()),
      });
    }

    const thumb =
      (await publishLocalCoverPath(article.cover_path, origin)) ||
      (article.cover_path?.startsWith("http")
        ? article.cover_path
        : article.cover_path
          ? `${origin}/api/uploads/${article.cover_path.split("/").pop()}`
          : undefined);

    let masterHtml = await publishLocalMediaInHtml(
      absolutizeHtmlMedia(
        ensureCoverInBodyHtml(
          article.body,
          article.cover_path,
          article.cover_path?.startsWith("http")
            ? article.cover_path
            : undefined,
          article.title,
          origin,
        ),
        origin,
      ),
      origin,
    );
    assertPublicMediaOrThrow(masterHtml, "主稿正文");

    if (thumb) {
      masterHtml = upsertCoverInBody(masterHtml, thumb, article.title);
      for (const group of byFamily.values()) {
        group.cover = thumb;
        group.content = upsertCoverInBody(group.content, thumb, group.title);
        group.markdown = htmlToMarkdown(group.content);
      }
    }

    if (masterHtml !== article.body) {
      const patch: Parameters<typeof updateArticle>[1] = { body: masterHtml };
      if (
        article.cover_path &&
        !article.cover_path.startsWith("http") &&
        thumb &&
        !hasNonPublicMedia(thumb)
      ) {
        patch.cover_path = thumb;
      }
      updateArticle(id, patch);
      await persistCloudflareDb();
    }

    return NextResponse.json({
      groups: [...byFamily.values()],
      masterContent: masterHtml,
      thumb: thumb || undefined,
      cover: thumb || undefined,
      variants,
      missingFamilies: platforms
        .map((p) => platformFamily(p))
        .filter((f, i, arr) => arr.indexOf(f) === i)
        .filter((f) => !getVariant(id, f)?.body?.trim()),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "同步内容准备失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
