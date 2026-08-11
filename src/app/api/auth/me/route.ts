import { NextResponse } from "next/server";
import { authRequired, resolveAuth } from "@/lib/auth/session";
import { ensureDefaultWorkspace } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ctx = await resolveAuth(req);
  if (!ctx) {
    if (!authRequired()) {
      const ws = ensureDefaultWorkspace();
      return NextResponse.json({
        authRequired: false,
        user: {
          id: "local",
          email: "local@dianwu.geo",
          displayName: "本地工作区",
          workspaceId: ws.id,
          workspaceName: ws.name,
        },
      });
    }
    return NextResponse.json(
      { authRequired: true, user: null },
      { status: 401 },
    );
  }
  return NextResponse.json({
    authRequired: authRequired(),
    user: {
      id: ctx.userId,
      email: ctx.email,
      displayName: ctx.displayName,
      workspaceId: ctx.workspaceId,
    },
  });
}
