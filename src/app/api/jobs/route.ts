import { NextResponse } from "next/server";
import { listJobs } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ jobs: listJobs(200) });
}
