import { NextResponse } from "next/server";
import { createArticle, listArticles } from "@/lib/db";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ articles: listArticles() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();
  const article = {
    id: randomUUID(),
    title: typeof body.title === "string" ? body.title : "未命名文章",
    body: typeof body.body === "string" ? body.body : "",
    summary: typeof body.summary === "string" ? body.summary : "",
    cover_path: typeof body.cover_path === "string" ? body.cover_path : null,
    created_at: now,
    updated_at: now,
  };
  createArticle(article);
  return NextResponse.json({ article }, { status: 201 });
}
