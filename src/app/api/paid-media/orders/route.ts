import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { createPaidOrder, getArticleInWorkspace, listPaidOrders } from "@/lib/db";
import { parseListPage, slicePage } from "@/lib/list-page";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parseListPage(new URL(req.url));
  const rows = listPaidOrders(auth.ctx.workspaceId, limit + 1, offset);
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
  const skuIds = Array.isArray(body.skuIds)
    ? body.skuIds.filter((id: unknown) => typeof id === "string")
    : [];
  const note = typeof body.note === "string" ? body.note : "";
  if (!articleId) {
    return NextResponse.json({ error: "请选择要发布的文章" }, { status: 400 });
  }
  const article = getArticleInWorkspace(articleId, auth.ctx.workspaceId);
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  if (!article.body.trim()) {
    return NextResponse.json({ error: "这篇文章还没有正文" }, { status: 400 });
  }
  try {
    const order = createPaidOrder({
      workspaceId: auth.ctx.workspaceId,
      articleId: article.id,
      articleTitle: article.title || "未命名文章",
      skuIds,
      note,
    });
    return NextResponse.json({ order }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "下单失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
