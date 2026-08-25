import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import {
  checkoutWorkspacePack,
  checkoutWorkspacePlan,
  listWorkspaceBillingOrders,
  reconcilePendingOrders,
} from "@/lib/billing/checkout";
import { viewWorkspacePlan } from "@/lib/billing/account";
import { publicOrigin } from "@/lib/billing/stripe";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const sync = new URL(req.url).searchParams.get("sync") === "1";
  if (sync) {
    await reconcilePendingOrders(auth.ctx.workspaceId);
    await persistCloudflareDb();
  }
  return NextResponse.json({
    billing: viewWorkspacePlan(auth.ctx.workspaceId),
    orders: listWorkspaceBillingOrders(auth.ctx.workspaceId),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as {
    kind?: string;
    planId?: string;
    interval?: string;
    packId?: string;
    embedded?: boolean;
  };
  const origin = publicOrigin(req);
  const embedded = body.embedded !== false;
  try {
    if (body.kind === "pack" || body.kind === "wallet") {
      const result = await checkoutWorkspacePack({
        workspaceId: auth.ctx.workspaceId,
        actorEmail: auth.ctx.email,
        packId: typeof body.packId === "string" ? body.packId : "",
        origin,
        embedded,
      });
      await persistCloudflareDb();
      return NextResponse.json(result);
    }
    const result = await checkoutWorkspacePlan({
      workspaceId: auth.ctx.workspaceId,
      actorEmail: auth.ctx.email,
      planId: typeof body.planId === "string" ? body.planId : "",
      interval: body.interval === "yearly" ? "yearly" : "monthly",
      origin,
      embedded,
    });
    await persistCloudflareDb();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "开通失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
