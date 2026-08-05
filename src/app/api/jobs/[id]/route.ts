import { NextResponse } from "next/server";
import { getJob } from "@/lib/db";
import { retryJob } from "@/lib/queue/publisher";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json({ job });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (body.action !== "retry") {
    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  }
  try {
    const job = await retryJob(id);
    return NextResponse.json({ job });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
