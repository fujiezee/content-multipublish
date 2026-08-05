import { NextResponse } from "next/server";
import { listJobsByArticle } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return NextResponse.json({ jobs: listJobsByArticle(id) });
}
