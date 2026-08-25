import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { listPodcastCatalog } from "@/lib/db";
import { parseListPage, slicePage } from "@/lib/list-page";

export const runtime = "nodejs";

/** 只返回已生成可听对谈的文章 */
export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parseListPage(new URL(req.url));
  const rows = listPodcastCatalog(auth.ctx.workspaceId, limit + 1, offset);
  const page = slicePage(rows, limit, offset);
  return NextResponse.json({
    items: page.items,
    nextOffset: page.nextOffset,
    hasMore: page.hasMore,
  });
}
