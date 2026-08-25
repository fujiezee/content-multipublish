import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { deleteClonedProviderVoice } from "@/lib/ai/voice-clone";
import {
  deleteStudioVoice,
  getStudioVoice,
  updateStudioVoice,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const updated = updateStudioVoice({
    id,
    workspaceId: auth.ctx.workspaceId,
    name: typeof body.name === "string" ? body.name : undefined,
    hint: typeof body.hint === "string" ? body.hint : undefined,
  });
  if (!updated) {
    return NextResponse.json({ error: "音色不存在" }, { status: 404 });
  }
  await persistCloudflareDb();
  return NextResponse.json({ item: updated });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const current = getStudioVoice(id, auth.ctx.workspaceId);
  if (!current) {
    return NextResponse.json({ error: "音色不存在" }, { status: 404 });
  }
  await deleteClonedProviderVoice(current);
  deleteStudioVoice(id, auth.ctx.workspaceId);
  await persistCloudflareDb();
  return NextResponse.json({ ok: true });
}
