import { NextResponse } from "next/server";
import { familyLabel, platformFamily } from "@/lib/content/platform-families";
import {
  absolutizeHtmlMedia,
  absolutizeMarkdownMedia,
  resolvePublicOrigin,
} from "@/lib/content/media-urls";
import { getVariant, getArticle, listVariants } from "@/lib/db";
import { publishContentForPlatform } from "@/lib/content/publish-resolve";
import {
  assertPublicMediaOrThrow,
  publishLocalMediaInHtml,
  publishLocalMediaInMarkdown,
} from "@/lib/storage/public-media";
import type { PlatformId } from "@/lib/types";
import { ALL_PLATFORM_IDS } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const article = getArticle(id);
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
        family: ReturnType<typeof platformFamily>;
        familyLabel: string;
        platforms: PlatformId[];
        title: string;
        content: string;
        markdown: string;
        summary: string;
        usedVariant: boolean;
      }
    >();

    for (const platform of platforms) {
      const family = platformFamily(platform);
      const content = publishContentForPlatform(id, platform, {
        mediaOrigin: origin,
      });
      if (!content) continue;
      const existing = byFamily.get(family);
      if (existing) {
        existing.platforms.push(platform);
        continue;
      }
      const variant = getVariant(id, family);
      // Absolutize first, then push local /api/uploads to public CDN (Zhihu
      // server-side fetch cannot reach 127.0.0.1).
      const absoluteHtml = absolutizeHtmlMedia(content.bodyHtml, origin);
      const absoluteMd = absolutizeMarkdownMedia(content.bodyMarkdown, origin);
      const [html, markdown] = await Promise.all([
        publishLocalMediaInHtml(absoluteHtml),
        publishLocalMediaInMarkdown(absoluteMd),
      ]);
      assertPublicMediaOrThrow(html, `${familyLabel(family)}正文`);
      assertPublicMediaOrThrow(markdown, `${familyLabel(family)} Markdown`);
      byFamily.set(family, {
        family,
        familyLabel: familyLabel(family),
        platforms: [platform],
        title: content.title,
        content: html,
        markdown,
        summary: content.summary,
        usedVariant: Boolean(variant?.body?.trim()),
      });
    }

    return NextResponse.json({
      groups: [...byFamily.values()],
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
