import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { listMusicPublishJobs } from "@/lib/db";
import { MUSIC_PUBLISH_PLATFORMS } from "@/lib/music-publish-platforms";
import {
  applyMusicPublishOutcome,
  prepareSeriesMusicPublish,
} from "@/lib/queue/music-publish";
import type { MusicPublishPlatformId } from "@/lib/music-publish-platforms";

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
    jobs: listMusicPublishJobs(auth.ctx.workspaceId),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const articleId = String(body.articleId || "").trim();
  const trackId = String(body.trackId || "").trim();
  const platform = String(body.platform || "").trim() as MusicPublishPlatformId;
  if (!articleId) {
    return NextResponse.json({ error: "缺少 articleId" }, { status: 400 });
  }
  const allowed = MUSIC_PUBLISH_PLATFORMS.some((row) => row.id === platform);
  if (!allowed) {
    return NextResponse.json(
      { error: "这一路目前只支持发到汽水或抖音" },
      { status: 400 },
    );
  }
  try {
    const out = prepareSeriesMusicPublish({
      articleId,
      trackId: trackId || undefined,
      platform,
      origin: requestOrigin(req),
    });
    return NextResponse.json({
      jobId: out.job.id,
      audioUrl: out.audioUrl,
      coverUrl: out.coverUrl,
      title: out.title,
      lyrics: out.lyrics,
      message: out.message,
      jobs: listMusicPublishJobs(auth.ctx.workspaceId),
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
    applyMusicPublishOutcome({
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
      jobs: listMusicPublishJobs(auth.ctx.workspaceId),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "更新失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
