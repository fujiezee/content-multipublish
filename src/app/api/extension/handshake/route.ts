import { NextResponse } from "next/server";
import { resolveAuth } from "@/lib/auth/session";
import { getExtensionToken, touchExtensionToken } from "@/lib/db";

export const runtime = "nodejs";

/** Extension ↔ SaaS protocol handshake (version + token bind). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const extensionVersion = String(body.extensionVersion || "").trim();
  const protocolVersion = Number(body.protocolVersion || 0);
  const token = String(body.token || "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  const minProtocol = 1200;
  const compatible = protocolVersion >= minProtocol;

  let workspaceId: string | null = null;
  let bound = false;
  if (token) {
    const row = getExtensionToken(token);
    if (row) {
      touchExtensionToken(row.id);
      workspaceId = row.workspace_id;
      bound = true;
    }
  } else {
    const ctx = await resolveAuth(req);
    if (ctx) {
      workspaceId = ctx.workspaceId;
      bound = true;
    }
  }

  return NextResponse.json({
    ok: compatible && (bound || !token),
    product: "点物GEO",
    minProtocolVersion: minProtocol,
    serverProtocolVersion: 1200,
    compatible,
    bound,
    workspaceId,
    extensionVersion: extensionVersion || null,
    publishModes: {
      draft: "draft_ok",
      fillConfirm: "filled_awaiting_publish",
      published: "published",
    },
    notes: compatible
      ? bound
        ? "扩展已绑定工作区"
        : "未绑定 token 时可在设置页生成扩展 token"
      : `请升级扩展（协议 ≥ ${minProtocol}）`,
  });
}
