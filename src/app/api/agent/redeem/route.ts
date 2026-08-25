import { NextResponse } from "next/server";
import { formatPairCode, normalizePairCode } from "@/lib/agent";
import { redeemAgentPairCode } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const code = normalizePairCode(String(body.code || ""));
  if (code.length < 6) {
    return NextResponse.json({ error: "配对码无效" }, { status: 400 });
  }
  const device = redeemAgentPairCode(code);
  if (!device) {
    return NextResponse.json(
      { error: "配对码无效或已过期，请在设置里重新生成" },
      { status: 400 },
    );
  }
  return NextResponse.json({
    token: device.token,
    workspaceId: device.workspace_id,
    deviceId: device.id,
    label: device.label,
    pairCode: formatPairCode(code),
  });
}
