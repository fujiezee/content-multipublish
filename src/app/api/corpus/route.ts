import { NextResponse } from "next/server";
import { createCorpusItem, listCorpusItems } from "@/lib/db";
import type { CorpusCategory } from "@/lib/types";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

const VALID_CATEGORIES = new Set<CorpusCategory>([
  "brand",
  "story",
  "product",
  "style",
  "other",
]);

export async function GET() {
  return NextResponse.json({ items: listCorpusItems() });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "请填写标题" }, { status: 400 });
    }
    if (!content) {
      return NextResponse.json({ error: "请填写内容" }, { status: 400 });
    }

    const category = VALID_CATEGORIES.has(body.category)
      ? (body.category as CorpusCategory)
      : "other";
    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      title,
      category,
      tags: typeof body.tags === "string" ? body.tags.trim() : "",
      content,
      created_at: now,
      updated_at: now,
    };
    createCorpusItem(item);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message || "保存失败" }, { status: 500 });
  }
}
