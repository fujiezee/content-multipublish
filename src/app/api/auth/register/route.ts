import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { createSessionCookie } from "@/lib/auth/session";
import {
  createWorkspace,
  createWorkspaceUser,
  getWorkspaceUserByEmail,
} from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const password = String(body.password || "");
  const displayName = String(body.displayName || "").trim();
  const workspaceName = String(body.workspaceName || "").trim() || "我的工作区";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "请输入有效邮箱" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "密码至少 8 位" }, { status: 400 });
  }
  if (getWorkspaceUserByEmail(email)) {
    return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
  }

  const ws = createWorkspace(workspaceName);
  const user = createWorkspaceUser({
    workspaceId: ws.id,
    email,
    passwordHash: hashPassword(password),
    displayName: displayName || email.split("@")[0],
  });
  await createSessionCookie(user.id, ws.id);

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      workspaceId: ws.id,
      workspaceName: ws.name,
    },
  });
}
