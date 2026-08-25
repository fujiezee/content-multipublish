import { NextResponse } from "next/server";
import { resolveOwnerUserId } from "@/lib/auth/owner";
import { authRequired, requireAuth } from "@/lib/auth/session";
import {
  createExtensionTokenRow,
  listExtensionTokens,
  revokeExtensionToken,
} from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ctx = await requireAuth(req);
  if (!ctx || (ctx.userId === "local" && authRequired())) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const tokens = listExtensionTokens(ctx.workspaceId).map((t) => ({
    id: t.id,
    label: t.label,
    tokenPreview: `${t.token.slice(0, 10)}…`,
    token: t.token,
    createdAt: t.created_at,
    lastUsedAt: t.last_used_at,
  }));
  return NextResponse.json({ tokens });
}

export async function POST(req: Request) {
  const ctx = await requireAuth(req);
  if (!ctx) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const ownerId = resolveOwnerUserId(ctx);
  if (!ownerId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const label = String(body.label || "").trim();
  const kind = body.kind === "api" ? "api" : "extension";
  const row = createExtensionTokenRow({
    workspaceId: ctx.workspaceId,
    userId: ownerId,
    label:
      label ||
      (kind === "api" ? "API 调用" : "扩展绑定"),
    kind,
  });
  return NextResponse.json({
    token: {
      id: row.id,
      label: row.label,
      token: row.token,
      createdAt: row.created_at,
    },
  });
}

export async function DELETE(req: Request) {
  const ctx = await requireAuth(req);
  if (!ctx) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "缺少 token id" }, { status: 400 });
  }
  revokeExtensionToken(id, ctx.workspaceId);
  return NextResponse.json({ ok: true });
}
