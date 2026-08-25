import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionCookie } from "@/lib/auth/session";
import { issueAndSendVerifyEmail, siteOrigin } from "@/lib/auth/verify-email";
import {
  getWorkspaceUserByEmail,
  isWorkspaceUserEmailVerified,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const password = String(body.password || "");
  const remember = Boolean(body.remember);
  const user = getWorkspaceUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
  }
  if (!isWorkspaceUserEmailVerified(user)) {
    try {
      await issueAndSendVerifyEmail({
        userId: user.id,
        email: user.email,
        displayName: user.display_name,
        origin: siteOrigin(req),
      });
      await persistCloudflareDb();
    } catch {
      // 仍提示去激活；重发失败不挡提示
    }
    return NextResponse.json(
      {
        error: "邮箱还没激活，请到邮箱点开激活链接",
        needsVerify: true,
        email: user.email,
      },
      { status: 403 },
    );
  }
  await createSessionCookie(user.id, user.workspace_id, remember);
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      workspaceId: user.workspace_id,
    },
  });
}
