import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { viewWorkspacePlan } from "@/lib/billing/account";
import {
  countArticles,
  countJobsByStatusInWorkspace,
  getLatestMentionRunSummary,
  listArticleSummaries,
  listJobsInWorkspace,
} from "@/lib/db";

export const runtime = "nodejs";

/** 总览页专用：一次返回瘦数据，避免并行打 4 个重接口 */
export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const ws = auth.ctx.workspaceId;

  const statusCounts = countJobsByStatusInWorkspace(ws);
  const draftOk =
    (statusCounts.draft_ok || 0) + (statusCounts.success || 0);
  const published = statusCounts.published || 0;
  const awaiting = statusCounts.filled_awaiting_publish || 0;
  const failed = statusCounts.failed || 0;

  const articles = listArticleSummaries(ws, 8).map((a) => ({
    id: a.id,
    title: a.title,
    updated_at: a.updated_at,
  }));
  const jobs = listJobsInWorkspace(ws, 8).map((j) => ({
    id: j.id,
    platform: j.platform,
    status: j.status,
    updated_at: j.updated_at,
  }));
  const mention = getLatestMentionRunSummary(ws);

  return NextResponse.json({
    articleCount: countArticles(ws),
    articles,
    jobs,
    jobStats: { draftOk, published, awaiting, failed },
    mention,
    billing: viewWorkspacePlan(ws),
  });
}
