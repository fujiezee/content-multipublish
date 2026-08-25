import { NextResponse } from "next/server";
import { generateArticleCover } from "@/lib/ai/cover";
import { requireApiUser } from "@/lib/auth/api";
import { consumeOrRespond, refundQuota } from "@/lib/billing/account";
import { resolveCoverImageModelId } from "@/lib/ai/image-gen-models";

export const runtime = "nodejs";
export const maxDuration = 300;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pathFromUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/api/uploads/")) {
    return `data/uploads/${url.split("/").pop()}`;
  }
  return url;
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  const text = stripHtml(String(body.body || body.bodyHtml || ""));
  if (!title && !text) {
    return NextResponse.json({ error: "先写标题或正文再生成封面" }, { status: 400 });
  }

  const coverModel = resolveCoverImageModelId();
  const denied = consumeOrRespond(
    auth.ctx.workspaceId,
    "images",
    1,
    coverModel,
    auth.ctx.email,
  );
  if (denied) return denied;

  try {
    const out = await generateArticleCover({
      title: title || text.slice(0, 24),
      bodyText: text,
      preset: "article",
    });
    return NextResponse.json({
      path: pathFromUrl(out.url),
      url: out.url,
      model: out.model,
      aspectRatio: out.aspectRatio,
    });
  } catch (err) {
    refundQuota(
      auth.ctx.workspaceId,
      "images",
      1,
      coverModel,
      auth.ctx.email,
    );
    const message = err instanceof Error ? err.message : "生成封面失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
