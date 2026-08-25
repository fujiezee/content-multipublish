import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { deleteWriterAgent, getWriterAgentInWorkspace } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const item = getWriterAgentInWorkspace(id, auth.ctx.workspaceId);
  if (!item) {
    return NextResponse.json({ error: "写手不存在" }, { status: 404 });
  }
  return NextResponse.json({ item });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!getWriterAgentInWorkspace(id, auth.ctx.workspaceId)) {
    return NextResponse.json({ error: "写手不存在" }, { status: 404 });
  }
  deleteWriterAgent(id);
  return NextResponse.json({ ok: true });
}
