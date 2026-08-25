import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { issueAndSendVerifyEmail, siteOrigin } from "@/lib/auth/verify-email";
import {
  createWorkspace,
  createWorkspaceUser,
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
  const displayName = String(body.displayName || "").trim();
  const workspaceName = String(body.workspaceName || "").trim() || "我的工作区";
  const origin = siteOrigin(req);

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "请输入有效邮箱" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "密码至少 8 位" }, { status: 400 });
  }

  const existing = getWorkspaceUserByEmail(email);
  if (existing) {
    if (isWorkspaceUserEmailVerified(existing)) {
      return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
    }
    try {
      await issueAndSendVerifyEmail({
        userId: existing.id,
        email: existing.email,
        displayName: existing.display_name,
        origin,
      });
      await persistCloudflareDb();
    } catch (err) {
      return NextResponse.json(
        {
          error: err instanceof Error ? err.message : "激活邮件发送失败",
          needsVerify: true,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({
      needsVerify: true,
      email: existing.email,
      message: "该邮箱已注册但还没激活，激活邮件已重新发送",
    });
  }

  const ws = createWorkspace(workspaceName);
  const user = createWorkspaceUser({
    workspaceId: ws.id,
    email,
    passwordHash: hashPassword(password),
    displayName: displayName || email.split("@")[0],
  });
  try {
    await issueAndSendVerifyEmail({
      userId: user.id,
      email: user.email,
      displayName: user.display_name,
      origin,
    });
    await persistCloudflareDb();
  } catch (err) {
    await persistCloudflareDb();
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "激活邮件发送失败",
        needsVerify: true,
        email: user.email,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    needsVerify: true,
    email: user.email,
    message: "激活邮件已发送，请到邮箱点链接后再登录",
  });
}
