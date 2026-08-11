import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, clearSessionCookie } from "@/lib/auth/session";
import { deleteAuthSessionByToken } from "@/lib/db";

export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) deleteAuthSessionByToken(token);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
