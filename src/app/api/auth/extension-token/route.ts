import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { authRequired, requireAuth } from "@/lib/auth/session";
import {
  createExtensionTokenRow,
  createWorkspaceUser,
  ensureDefaultWorkspace,
  getWorkspaceUserByEmail,
  listExtensionTokens,
  revokeExtensionToken,
} from "@/lib/db";

export const runtime = "nodejs";

async function resolveOwnerUserId(
  ctx: NonNullable<Awaited<ReturnType<typeof requireAuth>>>,
): Promise<string | null> {
  if (ctx.userId !== "local") return ctx.userId;
  if (authRequired()) return null;
  ensureDefaultWorkspace();
  const existing = getWorkspaceUserByEmail("local@dianwu.geo");
  if (existing) return existing.id;
  const created = createWorkspaceUser({
    workspaceId: ctx.workspaceId,
    email: "local@dianwu.geo",
    passwordHash: hashPassword(randomUUID()),
    displayName: "本地工作区",
  });
  return created.id;
}

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
  const ownerId = await resolveOwnerUserId(ctx);
  if (!ownerId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const label = String(body.label || "扩展绑定").trim();
  const row = createExtensionTokenRow({
    workspaceId: ctx.workspaceId,
    userId: ownerId,
    label,
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
