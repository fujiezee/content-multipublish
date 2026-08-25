import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { touchAgentDevice } from "@/lib/db";

export const runtime = "nodejs";

async function beat(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  if (!auth.ctx.agentDeviceId) {
    return NextResponse.json({ error: "需要本机助手 Token" }, { status: 403 });
  }
  touchAgentDevice(auth.ctx.agentDeviceId);
  return NextResponse.json({
    ok: true,
    workspaceId: auth.ctx.workspaceId,
    at: new Date().toISOString(),
  });
}

export async function GET(req: Request) {
  return beat(req);
}

export async function POST(req: Request) {
  return beat(req);
}
