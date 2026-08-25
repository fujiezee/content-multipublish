import { NextResponse } from "next/server";
import {
  AGENT_PAIR_TTL_MS,
  agentPairCommand,
  formatPairCode,
  originFromRequest,
} from "@/lib/agent";
import { requireAuth } from "@/lib/auth/session";
import { resolveOwnerUserId } from "@/lib/auth/owner";
import { createAgentPairCode } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ctx = await requireAuth(req);
  if (!ctx) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const ownerId = resolveOwnerUserId(ctx);
  if (!ownerId) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const expiresAt = new Date(Date.now() + AGENT_PAIR_TTL_MS).toISOString();
  const row = createAgentPairCode({
    workspaceId: ctx.workspaceId,
    userId: ownerId,
    expiresAt,
  });
  const code = formatPairCode(row.code);
  const origin = originFromRequest(req);
  return NextResponse.json({
    code,
    expiresAt: row.expires_at,
    origin,
    command: agentPairCommand(code, origin),
  });
}
