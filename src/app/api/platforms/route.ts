import { NextResponse } from "next/server";
import { listSessions } from "@/lib/db";
import { PLATFORMS } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const sessions = listSessions();
  return NextResponse.json({
    platforms: PLATFORMS,
    sessions,
  });
}
