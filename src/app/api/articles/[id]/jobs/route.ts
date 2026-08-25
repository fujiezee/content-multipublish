import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { getArticleInWorkspace, listJobsByArticle } from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import { processQueue } from "@/lib/queue/publisher";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!getArticleInWorkspace(id, auth.ctx.workspaceId)) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  const current = listJobsByArticle(id);
  const staleApi = current.some((job) => {
    if (job.engine !== "api") return false;
    if (job.status !== "pending" && job.status !== "running") return false;
    const ts = Date.parse(job.updated_at) || Date.parse(job.created_at) || 0;
    return Date.now() - ts > 15_000;
  });
  if (staleApi) {
    await processQueue();
    await persistCloudflareDb();
  }
  return NextResponse.json({ jobs: listJobsByArticle(id) });
}
