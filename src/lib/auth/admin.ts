import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import type { AuthContext } from "@/lib/auth/types";

const ADMIN_EMAIL = "morgan@dianwu.local";
const ADMIN_NAME = "摩根";

function extraAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminContext(ctx: AuthContext): boolean {
  const email = ctx.email.trim().toLowerCase();
  const name = ctx.displayName.trim();
  if (email === ADMIN_EMAIL || name === ADMIN_NAME) return true;
  return extraAdminEmails().includes(email);
}

export async function requireApiAdmin(req?: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth;
  if (!isAdminContext(auth.ctx)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "没有管理权限" }, { status: 403 }),
    };
  }
  return auth;
}
