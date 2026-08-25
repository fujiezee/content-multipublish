import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { listPaidOrders } from "@/lib/db";
import { PAID_MEDIA_SKUS } from "@/lib/paid-media";
import { parseListPage, slicePage } from "@/lib/list-page";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parseListPage(new URL(req.url));
  const rows = listPaidOrders(auth.ctx.workspaceId, limit + 1, offset);
  const page = slicePage(rows, limit, offset);
  return NextResponse.json({
    skus: PAID_MEDIA_SKUS,
    orders: page.items,
    nextOffset: page.nextOffset,
    hasMore: page.hasMore,
  });
}
