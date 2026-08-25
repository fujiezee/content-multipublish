import { NextResponse } from "next/server";
import {
  AGENT_ONLINE_MS,
  isAgentRecentlySeen,
  isCloudPlaywrightDisabled,
  shouldDeferPlaywrightToAgent,
} from "@/lib/agent";
import { requireApiUser } from "@/lib/auth/api";
import { listAgentDevices, revokeAgentDevice } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const devices = listAgentDevices(auth.ctx.workspaceId).map((d) => ({
    id: d.id,
    label: d.label,
    tokenPreview: `${d.token.slice(0, 12)}…`,
    lastSeenAt: d.last_seen_at,
    createdAt: d.created_at,
    online: isAgentRecentlySeen(d.last_seen_at),
  }));
  const online = devices.some((d) => d.online);
  return NextResponse.json({
    online,
    onlineWithinMs: AGENT_ONLINE_MS,
    deferPlaywright: shouldDeferPlaywrightToAgent(auth.ctx.workspaceId),
    cloudLocked: isCloudPlaywrightDisabled(),
    devices,
  });
}

export async function DELETE(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "缺少助手 id" }, { status: 400 });
  }
  revokeAgentDevice(id, auth.ctx.workspaceId);
  return NextResponse.json({ ok: true });
}
