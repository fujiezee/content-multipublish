import { NextResponse } from "next/server";
import { shouldDeferPlaywrightToAgent } from "@/lib/agent";
import { requireApiUser } from "@/lib/auth/api";
import { isLocalWorkspaceUser } from "@/lib/auth/local";
import { enqueuePublish } from "@/lib/queue/publisher";
import type { PlatformId } from "@/lib/types";
import { normalizePublishEngine } from "@/lib/types";
import { validateArticleForPlatforms } from "@/lib/content/publish-resolve";
import { getArticleInWorkspace } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const articleId = body.articleId as string;
  const platforms = (body.platforms ?? []) as PlatformId[];
  const engine = normalizePublishEngine(body.engine);

  if (!articleId) {
    return NextResponse.json({ error: "缺少 articleId" }, { status: 400 });
  }

  const article = getArticleInWorkspace(articleId, auth.ctx.workspaceId);
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }

  if (platforms.includes("dianwu") && !isLocalWorkspaceUser(auth.ctx)) {
    return NextResponse.json(
      { error: "只有本地工作区账号可以推送到点物目录" },
      { status: 403 },
    );
  }

  const warnings = validateArticleForPlatforms(articleId, platforms);

  try {
    const jobs = await enqueuePublish(articleId, platforms, { engine });
    const deferred =
      engine === "playwright" &&
      shouldDeferPlaywrightToAgent(auth.ctx.workspaceId);
    return NextResponse.json(
      { jobs, warnings, engine, deferred },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
