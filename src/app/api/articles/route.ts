import { NextResponse } from "next/server";
import {
  createArticle,
  linkGeoKeywordArticle,
  listArticles,
  upsertVariant,
} from "@/lib/db";
import {
  defaultFamilyForKind,
  isPlatformFamily,
} from "@/lib/content/platform-families";
import { requireAuth } from "@/lib/auth/session";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ctx = await requireAuth(req);
  return NextResponse.json({
    articles: listArticles(ctx?.workspaceId),
  });
}

export async function POST(req: Request) {
  const ctx = await requireAuth(req);
  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();
  const article = {
    id: randomUUID(),
    title: typeof body.title === "string" ? body.title : "未命名文章",
    body: typeof body.body === "string" ? body.body : "",
    summary: typeof body.summary === "string" ? body.summary : "",
    cover_path: typeof body.cover_path === "string" ? body.cover_path : null,
    workspace_id: ctx?.workspaceId ?? null,
    created_at: now,
    updated_at: now,
  };
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
  return NextResponse.json({ article, family }, { status: 201 });
}
