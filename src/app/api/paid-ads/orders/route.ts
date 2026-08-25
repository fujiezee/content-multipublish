import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { createPaidAdOrder, getArticleInWorkspace, listPaidAdOrders } from "@/lib/db";
import { parseListPage, slicePage } from "@/lib/list-page";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parseListPage(new URL(req.url));
  const rows = listPaidAdOrders(auth.ctx.workspaceId, limit + 1, offset);
  const page = slicePage(rows, limit, offset);
  return NextResponse.json({
    orders: page.items,
    nextOffset: page.nextOffset,
    hasMore: page.hasMore,
  });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const articleId = typeof body.articleId === "string" ? body.articleId.trim() : "";
  const landingUrl = typeof body.landingUrl === "string" ? body.landingUrl.trim() : "";
  const skuIds = Array.isArray(body.skuIds)
    ? body.skuIds.filter((id: unknown) => typeof id === "string")
    : [];
  const note = typeof body.note === "string" ? body.note : "";
  let articleTitle = "";
  if (articleId) {
    const article = getArticleInWorkspace(articleId, auth.ctx.workspaceId);
    if (!article) {
      return NextResponse.json({ error: "文章不存在" }, { status: 404 });
    }
    articleTitle = article.title || "未命名文章";
  }
  if (!articleId && !landingUrl && !note.trim()) {
    return NextResponse.json(
      { error: "请选一篇文章，或留下落地页 / 投放说明" },
      { status: 400 },
    );
  }
  try {
    const order = createPaidAdOrder({
      workspaceId: auth.ctx.workspaceId,
      articleId,
      articleTitle,
      landingUrl,
      skuIds,
      note,
    });
    return NextResponse.json({ order }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "下单失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
