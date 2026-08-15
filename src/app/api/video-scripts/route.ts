import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { listVideoCatalog } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ items: listVideoCatalog(auth.ctx.workspaceId) });
}
