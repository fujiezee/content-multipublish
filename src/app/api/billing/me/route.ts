import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { isAdminContext } from "@/lib/auth/admin";
import { listWorkspaceUsage, viewWorkspacePlan } from "@/lib/billing/account";
import { listWorkspaceBillingOrders } from "@/lib/billing/checkout";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const workspaceId = auth.ctx.workspaceId;
  const url = new URL(req.url);
  const full = url.searchParams.get("full") === "1";
  const billing = viewWorkspacePlan(workspaceId);
  if (!full) {
    // 全局额度条 / 总览只需要方案快照，避免顺带拉 usage + orders
    return NextResponse.json({
      billing,
      isAdmin: isAdminContext(auth.ctx),
    });
  }
  const limitRaw = Number(url.searchParams.get("limit") || "40");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 40;
  return NextResponse.json({
    billing,
    usage: listWorkspaceUsage(workspaceId, {
      limit,
      walletOnly: true,
    }),
    orders: listWorkspaceBillingOrders(workspaceId),
    isAdmin: isAdminContext(auth.ctx),
  });
}
