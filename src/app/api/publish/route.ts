import { NextResponse } from "next/server";
import { enqueuePublish } from "@/lib/queue/publisher";
import type { PlatformId, PublishEngine } from "@/lib/types";
import { articleToPublishContent, validateForPlatform } from "@/lib/content/adapt";
import { getArticle } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const articleId = body.articleId as string;
  const platforms = (body.platforms ?? []) as PlatformId[];
  const engine = (
    body.engine === "extension" ? "extension" : "playwright"
  ) as PublishEngine;

  if (!articleId) {
    return NextResponse.json({ error: "缺少 articleId" }, { status: 400 });
  }

  const article = getArticle(articleId);
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }

  const content = articleToPublishContent(article);
  const warnings: Record<string, string[]> = {};
  for (const p of platforms) {
    const w = validateForPlatform(p, content);
    if (w.length) warnings[p] = w;
  }

  try {
    const jobs = enqueuePublish(articleId, platforms, { engine });
    return NextResponse.json({ jobs, warnings, engine }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
