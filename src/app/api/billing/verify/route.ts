import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { verifyPaidSession } from "@/lib/billing/checkout";
import { isStripeSessionId } from "@/lib/billing/stripe";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const sessionId = new URL(req.url).searchParams.get("session_id") || "";
  if (!isStripeSessionId(sessionId)) {
    return NextResponse.json(
      { paid: false, error: "支付会话无效" },
      { status: 400 },
    );
  }
  try {
    const result = await verifyPaidSession({
      workspaceId: auth.ctx.workspaceId,
      sessionId,
      actorEmail: auth.ctx.email,
    });
    if (result.paid) await persistCloudflareDb();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "确认支付失败";
    return NextResponse.json({ paid: false, error: message }, { status: 400 });
  }
}
