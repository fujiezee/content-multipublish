import { NextResponse } from "next/server";
import { deleteArticle, getArticle, updateArticle } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const article = getArticle(id);
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  return NextResponse.json({ article });
}

export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const article = updateArticle(id, {
    title: typeof body.title === "string" ? body.title : undefined,
    body: typeof body.body === "string" ? body.body : undefined,
    summary: typeof body.summary === "string" ? body.summary : undefined,
    cover_path:
      body.cover_path === null || typeof body.cover_path === "string"
        ? body.cover_path
        : undefined,
  });
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  return NextResponse.json({ article });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const article = getArticle(id);
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  deleteArticle(id);
  return NextResponse.json({ ok: true });
}
