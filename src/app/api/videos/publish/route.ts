import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { listVideoCatalog, listVideoPublishJobs } from "@/lib/db";
import { VIDEO_PUBLISH_PLATFORMS } from "@/lib/video-publish-platforms";
import {
  applyVideoPublishOutcome,
  prepareEpisodeVideoPublish,
} from "@/lib/queue/video-publish";

export const runtime = "nodejs";

function requestOrigin(req: Request): string {
  const raw = req.headers.get("origin") || req.headers.get("referer") || "";
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      // ignore
    }
  }
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "http://127.0.0.1:3000"
  );
}

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({
    jobs: listVideoPublishJobs(auth.ctx.workspaceId),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const episodeId = String(body.episodeId || "").trim();
  const platform = String(body.platform || "").trim();
  if (!episodeId) {
    return NextResponse.json({ error: "缺少 episodeId" }, { status: 400 });
  }
  const allowed = VIDEO_PUBLISH_PLATFORMS.some((row) => row.id === platform);
  if (!allowed) {
    return NextResponse.json({ error: "这一路目前只支持发到抖音" }, { status: 400 });
  }
  const item = listVideoCatalog(auth.ctx.workspaceId).find(
    (row) => row.episode_id === episodeId,
  );
  if (!item) {
    return NextResponse.json({ error: "找不到这一集" }, { status: 404 });
  }
  if (!item.video_url) {
    return NextResponse.json({ error: "这一集还没有成片" }, { status: 400 });
  }
  try {
    const out = prepareEpisodeVideoPublish({
      episodeId,
      platform: "douyin",
      origin: requestOrigin(req),
    });
    return NextResponse.json({
      jobId: out.job.id,
      videoUrl: out.videoUrl,
      title: out.title,
      description: out.description,
      message: out.message,
      jobs: listVideoPublishJobs(auth.ctx.workspaceId),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "发布失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const jobId = String(body.jobId || "").trim();
  if (!jobId) {
    return NextResponse.json({ error: "缺少 jobId" }, { status: 400 });
  }
  try {
    applyVideoPublishOutcome({
      jobId,
      workspaceId: auth.ctx.workspaceId,
      status: body.status ? String(body.status) : undefined,
      error: body.error === undefined ? undefined : body.error,
      resultUrl:
        body.resultUrl === undefined && body.result_url === undefined
          ? undefined
          : String(body.resultUrl || body.result_url || "") || null,
    });
    return NextResponse.json({
      jobs: listVideoPublishJobs(auth.ctx.workspaceId),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "更新失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
