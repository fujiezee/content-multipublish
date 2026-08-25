import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { parseCorpusAssets } from "@/lib/corpus-assets";
import { createCorpusItem, listCorpusItems } from "@/lib/db";
import { parseListPage, slicePage } from "@/lib/list-page";
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

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parseListPage(new URL(req.url));
  const rows = listCorpusItems(auth.ctx.workspaceId, limit + 1, offset);
  const page = slicePage(rows, limit, offset);
  return NextResponse.json({
    items: page.items,
    nextOffset: page.nextOffset,
    hasMore: page.hasMore,
  });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json().catch(() => ({}));
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const assets = parseCorpusAssets(body.assets);
    if (!title) {
      return NextResponse.json({ error: "请填写标题" }, { status: 400 });
    }
    if (!content && assets.length === 0) {
      return NextResponse.json(
        { error: "请填写内容，或上传带说明的图片" },
        { status: 400 },
      );
    }
    if (assets.some((asset) => !asset.caption)) {
      return NextResponse.json(
        { error: "每张图都要写说明，写清楚图里是什么，不然引用时模型看不懂" },
        { status: 400 },
      );
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
      assets,
      created_at: now,
      updated_at: now,
    };
    createCorpusItem(item, auth.ctx.workspaceId);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message || "保存失败" }, { status: 500 });
  }
}
