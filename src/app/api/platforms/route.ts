import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { listSessions } from "@/lib/db";
import { PLATFORMS } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const sessions = listSessions();
  return NextResponse.json({
    platforms: PLATFORMS,
    sessions,
  });
}
