import { NextResponse } from "next/server";
import {
  createArticle,
  linkGeoKeywordArticle,
  listArticleSummaries,
  upsertVariant,
  videoCountsForArticles,
  podcastCountsForArticles,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import {
  defaultFamilyForKind,
  isPlatformFamily,
} from "@/lib/content/platform-families";
import { requireApiUser } from "@/lib/auth/api";
import { consumeOrRespond, refundQuota } from "@/lib/billing/account";
import { parseListPage, slicePage } from "@/lib/list-page";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parseListPage(new URL(req.url));
  const rows = listArticleSummaries(
    auth.ctx.workspaceId,
    limit + 1,
    offset,
  );
  const page = slicePage(rows, limit, offset);
  const counts = videoCountsForArticles(page.items.map((a) => a.id));
  const podcasts = podcastCountsForArticles(page.items.map((a) => a.id));
  const articles = page.items.map((a) => {
    const c = counts.get(a.id);
    return {
      ...a,
      script_count: c?.scripts ?? 0,
      video_count: c?.videos ?? 0,
      podcast_count: podcasts.get(a.id) ?? 0,
    };
  });
  return NextResponse.json({
    articles,
    nextOffset: page.nextOffset,
    hasMore: page.hasMore,
  });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const ctx = auth.ctx;
  const body = await req.json().catch(() => ({}));
  const denied = consumeOrRespond(
    ctx.workspaceId,
    "articles",
    1,
    null,
    ctx.email,
  );
  if (denied) return denied;
  const now = new Date().toISOString();
  const article = {
    id: randomUUID(),
    title: typeof body.title === "string" ? body.title : "未命名文章",
    body: typeof body.body === "string" ? body.body : "",
    summary: typeof body.summary === "string" ? body.summary : "",
    script_title:
      typeof body.script_title === "string"
        ? body.script_title.trim().slice(0, 16)
        : typeof body.scriptTitle === "string"
          ? body.scriptTitle.trim().slice(0, 16)
          : "",
    cover_path: typeof body.cover_path === "string" ? body.cover_path : null,
    workspace_id: ctx.workspaceId,
    created_at: now,
    updated_at: now,
  };
  try {
    createArticle(article);
    const geoKeywordId =
      typeof body.geoKeywordId === "string" ? body.geoKeywordId.trim() : "";
    if (geoKeywordId) {
      const brief = typeof body.geoBrief === "string" ? body.geoBrief : "";
      linkGeoKeywordArticle(geoKeywordId, article.id, brief);
    }
    const family = isPlatformFamily(body.family)
      ? body.family
      : defaultFamilyForKind("article");
    if (article.body.trim()) {
      upsertVariant({
        articleId: article.id,
        family,
        title: article.title,
        body: article.body,
        summary: article.summary,
        source: "generated",
      });
    }
    await persistCloudflareDb();
    return NextResponse.json({ article, family }, { status: 201 });
  } catch (err) {
    refundQuota(ctx.workspaceId, "articles", 1, null, ctx.email);
    const message = err instanceof Error ? err.message : "保存失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
