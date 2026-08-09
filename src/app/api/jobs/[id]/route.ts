import { NextResponse } from "next/server";
import { getJob, updateJob } from "@/lib/db";
import { retryJob } from "@/lib/queue/publisher";
import type { JobStatus } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALLOWED_STATUS = new Set<JobStatus>([
  "pending",
  "running",
  "success",
  "failed",
]);

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json({ job });
}

/** Retry a failed job via Playwright queue (JobsPanel). */
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

/** Browser bridge writes extension sync results here (no Playwright). */
export async function PATCH(
  req: Request,
  ctx: Ctx,
) {
  const { id } = await ctx.params;
  const existing = getJob(id);
  if (!existing) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const patch: {
    status?: JobStatus;
    result_url?: string | null;
    error?: string | null;
  } = {};

  if (body.status != null) {
    if (!ALLOWED_STATUS.has(body.status)) {
      return NextResponse.json({ error: "无效 status" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if ("result_url" in body) {
    patch.result_url =
      body.result_url === null || body.result_url === undefined
        ? null
        : String(body.result_url);
  }
  if ("error" in body) {
    patch.error =
      body.error === null || body.error === undefined
        ? null
        : String(body.error);
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  }

  const job = updateJob(id, patch);
  return NextResponse.json({ job });
}
