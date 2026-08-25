import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/auth/admin";
import {
  applyAdminBillingPatch,
  listAdminWorkspacePlans,
  listWorkspaceUsage,
  viewWorkspacePlan,
} from "@/lib/billing/account";
import { getWorkspace } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireApiAdmin(req);
  if (!auth.ok) return auth.response;
  const workspaceId = new URL(req.url).searchParams.get("workspaceId")?.trim() || "";
  if (workspaceId) {
    if (!getWorkspace(workspaceId)) {
      return NextResponse.json({ error: "工作区不存在" }, { status: 404 });
    }
    return NextResponse.json({
      billing: viewWorkspacePlan(workspaceId),
      usage: listWorkspaceUsage(workspaceId, { limit: 80 }),
    });
  }
  return NextResponse.json({ workspaces: listAdminWorkspacePlans() });
}

export async function PATCH(req: Request) {
  const auth = await requireApiAdmin(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const workspaceId =
    typeof record.workspaceId === "string" ? record.workspaceId.trim() : "";
  if (!workspaceId) {
    return NextResponse.json({ error: "缺少工作区" }, { status: 400 });
  }
  try {
    const billing = applyAdminBillingPatch(workspaceId, record, auth.ctx.email);
    return NextResponse.json({ billing });
  } catch (err) {
    const message = err instanceof Error ? err.message : "保存失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
