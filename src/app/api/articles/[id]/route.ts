import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { pickScriptTitle } from "@/lib/ai/copywriting";
import {
  ensureStoredInfographicsInHtml,
  mergeInfographicHtml,
} from "@/lib/ai/apply-master-infographics";
import {
  deleteArticle,
  deleteArticleVariants,
  getArticleInWorkspace,
  getVideoSeriesByArticle,
  updateArticle,
  updateVideoSeriesFields,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import { rewritePublicMediaInText } from "@/lib/content/media-urls";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const article = getArticleInWorkspace(id, auth.ctx.workspaceId);
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  const body = rewritePublicMediaInText(
    ensureStoredInfographicsInHtml(id, "master", article.body),
  );
  const cover = article.cover_path
    ? rewritePublicMediaInText(article.cover_path)
    : article.cover_path;
  const changed = body !== article.body || cover !== article.cover_path;
  return NextResponse.json({
    article: changed ? { ...article, body, cover_path: cover } : article,
  });
}

export async function PUT(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!getArticleInWorkspace(id, auth.ctx.workspaceId)) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const current = getArticleInWorkspace(id, auth.ctx.workspaceId);
  const series = getVideoSeriesByArticle(id);
  const incomingTitle =
    typeof body.script_title === "string"
      ? body.script_title
      : typeof body.scriptTitle === "string"
        ? body.scriptTitle
        : undefined;
  const scriptTitle =
    incomingTitle !== undefined
      ? pickScriptTitle(incomingTitle, current?.script_title, series?.title)
      : undefined;
  const nextBody =
    typeof body.body === "string"
      ? ensureStoredInfographicsInHtml(
          id,
          "master",
          mergeInfographicHtml(body.body, current?.body || ""),
        )
      : undefined;
  const nextTitle = typeof body.title === "string" ? body.title : undefined;
  const nextSummary =
    typeof body.summary === "string" ? body.summary : undefined;
  const masterCopyChanged = Boolean(
    current &&
      ((nextBody !== undefined && nextBody !== current.body) ||
        (nextTitle !== undefined && nextTitle !== current.title) ||
        (nextSummary !== undefined && nextSummary !== current.summary)),
  );
  const article = updateArticle(id, {
    title: nextTitle,
    body: nextBody,
    summary: nextSummary,
    cover_path:
      body.cover_path === null || typeof body.cover_path === "string"
        ? body.cover_path
        : undefined,
    script_title: scriptTitle,
  });
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  let variantsCleared = false;
  if (masterCopyChanged) {
    deleteArticleVariants(id);
    variantsCleared = true;
  }
  if (scriptTitle && series && series.title !== scriptTitle) {
    updateVideoSeriesFields(series.id, { title: scriptTitle });
  }
  await persistCloudflareDb();
  return NextResponse.json({ article, variantsCleared });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const article = getArticleInWorkspace(id, auth.ctx.workspaceId);
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  deleteArticle(id);
  await persistCloudflareDb();
  return NextResponse.json({ ok: true });
}
