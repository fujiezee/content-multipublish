import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { parseCorpusAssets } from "@/lib/corpus-assets";
import { deleteCorpusItem, getCorpusItem, updateCorpusItem } from "@/lib/db";

function corpusInWorkspace(
  id: string,
  workspaceId: string,
) {
  const item = getCorpusItem(id);
  if (!item) return undefined;
  const owner = item.workspace_id || "ws_local";
  return owner === workspaceId ? item : undefined;
}
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

export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const item = corpusInWorkspace(id, auth.ctx.workspaceId);
  if (!item) {
    return NextResponse.json({ error: "语料不存在" }, { status: 404 });
  }
  return NextResponse.json({ item });
}

export async function PUT(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    const existing = corpusInWorkspace(id, auth.ctx.workspaceId);
    if (!existing) {
      return NextResponse.json({ error: "语料不存在" }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    const patch: Parameters<typeof updateCorpusItem>[1] = {};
    if (typeof body.title === "string") patch.title = body.title.trim();
    if (typeof body.content === "string") patch.content = body.content.trim();
    if (typeof body.tags === "string") patch.tags = body.tags.trim();
    if (Array.isArray(body.assets)) patch.assets = parseCorpusAssets(body.assets);
    if (VALID_CATEGORIES.has(body.category)) {
      patch.category = body.category as CorpusCategory;
    }
    if (patch.title === "") {
      return NextResponse.json({ error: "请填写标题" }, { status: 400 });
    }
    const nextContent =
      patch.content !== undefined ? patch.content : existing?.content || "";
    const nextAssets =
      patch.assets !== undefined ? patch.assets : existing?.assets || [];
    if (!nextContent && nextAssets.length === 0) {
      return NextResponse.json(
        { error: "请填写内容，或上传带说明的图片" },
        { status: 400 },
      );
    }
    if (nextAssets.some((asset) => !asset.caption)) {
      return NextResponse.json(
        { error: "每张图都要写说明，写清楚图里是什么，不然引用时模型看不懂" },
        { status: 400 },
      );
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

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!corpusInWorkspace(id, auth.ctx.workspaceId)) {
    return NextResponse.json({ error: "语料不存在" }, { status: 404 });
  }
  deleteCorpusItem(id);
  return NextResponse.json({ ok: true });
}
