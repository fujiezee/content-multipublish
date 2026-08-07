import { NextResponse } from "next/server";
import { deleteCorpusItem, getCorpusItem, updateCorpusItem } from "@/lib/db";
import type { CorpusCategory } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const VALID_CATEGORIES = new Set<CorpusCategory>([
  "brand",
  "story",
  "product",
  "style",
  "other",
]);

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const item = getCorpusItem(id);
  if (!item) {
    return NextResponse.json({ error: "语料不存在" }, { status: 404 });
  }
  return NextResponse.json({ item });
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const patch: Parameters<typeof updateCorpusItem>[1] = {};
    if (typeof body.title === "string") patch.title = body.title.trim();
    if (typeof body.content === "string") patch.content = body.content.trim();
    if (typeof body.tags === "string") patch.tags = body.tags.trim();
    if (VALID_CATEGORIES.has(body.category)) {
      patch.category = body.category as CorpusCategory;
    }
    if (patch.title === "") {
      return NextResponse.json({ error: "请填写标题" }, { status: 400 });
    }
    if (patch.content === "") {
      return NextResponse.json({ error: "请填写内容" }, { status: 400 });
    }
    const item = updateCorpusItem(id, patch);
    if (!item) {
      return NextResponse.json({ error: "语料不存在" }, { status: 404 });
    }
    return NextResponse.json({ item });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message || "保存失败" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getCorpusItem(id)) {
    return NextResponse.json({ error: "语料不存在" }, { status: 404 });
  }
  deleteCorpusItem(id);
  return NextResponse.json({ ok: true });
}
