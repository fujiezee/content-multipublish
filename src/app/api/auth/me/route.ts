import { NextResponse } from "next/server";
import { isAdminContext } from "@/lib/auth/admin";
import { authRequired, resolveAuth } from "@/lib/auth/session";
import { ensureDefaultWorkspace } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ctx = await resolveAuth(req);
  if (!ctx) {
    if (!authRequired()) {
      const ws = ensureDefaultWorkspace();
      const local = {
        userId: "local",
        workspaceId: ws.id,
        email: "local@dianwu.geo",
        displayName: "本地工作区",
      };
      return NextResponse.json({
        authRequired: false,
        user: {
          id: local.userId,
          email: local.email,
          displayName: local.displayName,
          workspaceId: ws.id,
          workspaceName: ws.name,
          isAdmin: isAdminContext(local),
        },
      });
    }
    return NextResponse.json({ authRequired: true, user: null });
  }
  return NextResponse.json({
    authRequired: authRequired(),
    user: {
      id: ctx.userId,
      email: ctx.email,
      displayName: ctx.displayName,
      workspaceId: ctx.workspaceId,
      isAdmin: isAdminContext(ctx),
    },
  });
}
