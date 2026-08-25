import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { listPaidAdOrders } from "@/lib/db";
import { PAID_AD_SKUS } from "@/lib/paid-ads";
import { parseListPage, slicePage } from "@/lib/list-page";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parseListPage(new URL(req.url));
  const rows = listPaidAdOrders(auth.ctx.workspaceId, limit + 1, offset);
  const page = slicePage(rows, limit, offset);
  return NextResponse.json({
    skus: PAID_AD_SKUS,
    orders: page.items,
    nextOffset: page.nextOffset,
    hasMore: page.hasMore,
  });
}
