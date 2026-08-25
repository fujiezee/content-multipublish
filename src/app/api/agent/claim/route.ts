import { NextResponse } from "next/server";
import { originFromRequest } from "@/lib/agent";
import { requireApiUser } from "@/lib/auth/api";
import { publishContentForPlatform } from "@/lib/content/publish-resolve";
import { claimNextPlaywrightJob, touchAgentDevice } from "@/lib/db";

export const runtime = "nodejs";

async function claim(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  if (!auth.ctx.agentDeviceId) {
    return NextResponse.json({ error: "需要本机助手 Token" }, { status: 403 });
  }
  touchAgentDevice(auth.ctx.agentDeviceId);

  const job = claimNextPlaywrightJob(
    auth.ctx.workspaceId,
    auth.ctx.agentDeviceId,
  );
  if (!job) {
    return NextResponse.json({ job: null });
  }

  const origin = originFromRequest(req);
  const content = publishContentForPlatform(job.article_id, job.platform, {
    mediaOrigin: origin,
  });
  if (!content) {
    return NextResponse.json({
      job,
      error: "文章不存在或无法解析正文",
    });
  }

  return NextResponse.json({ job, content, origin });
}

export async function GET(req: Request) {
  return claim(req);
}

export async function POST(req: Request) {
  return claim(req);
}
