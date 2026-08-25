import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { listMusicCatalog } from "@/lib/db";
import { parseListPage, slicePage } from "@/lib/list-page";

export const runtime = "nodejs";

/** 只返回已出过可听曲目的剧本系列 */
export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parseListPage(new URL(req.url));
  // 先多取再切片：可听曲目是 JSON 过滤出来的
  const rows = listMusicCatalog(auth.ctx.workspaceId);
  const page = slicePage(rows, limit, offset);
  return NextResponse.json({
    items: page.items,
    nextOffset: page.nextOffset,
    hasMore: page.hasMore,
  });
}
