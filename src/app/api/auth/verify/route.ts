import { NextResponse } from "next/server";
import { createSessionCookie } from "@/lib/auth/session";
import { issueAndSendVerifyEmail, siteOrigin } from "@/lib/auth/verify-email";
import {
  consumeEmailVerifyToken,
  getWorkspaceUserByEmail,
  isWorkspaceUserEmailVerified,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  const email = String(body.email || "")
    .trim()
    .toLowerCase();

  if (token) {
    const user = consumeEmailVerifyToken(token);
    if (!user) {
      return NextResponse.json(
        { error: "激活链接无效或已过期，请重新发送" },
        { status: 400 },
      );
    }
    await createSessionCookie(user.id, user.workspace_id, false);
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        workspaceId: user.workspace_id,
      },
    });
  }

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "请输入有效邮箱" }, { status: 400 });
  }
  const user = getWorkspaceUserByEmail(email);
  if (!user || isWorkspaceUserEmailVerified(user)) {
    return NextResponse.json({
      needsVerify: true,
      email,
      message: "如果该邮箱还没激活，我们会再发一封邮件",
    });
  }
  try {
    await issueAndSendVerifyEmail({
      userId: user.id,
      email: user.email,
      displayName: user.display_name,
      origin: siteOrigin(req),
    });
    await persistCloudflareDb();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "激活邮件发送失败" },
      { status: 400 },
    );
  }
  return NextResponse.json({
    needsVerify: true,
    email: user.email,
    message: "激活邮件已发送，请到邮箱点链接",
  });
}
