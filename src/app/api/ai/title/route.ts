import { NextResponse } from "next/server";
import { optimizeArticleTitle } from "@/lib/ai/article-title";
import { requireApiUser } from "@/lib/auth/api";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  const text = String(body.body || body.bodyHtml || "");
  const family = typeof body.family === "string" ? body.family : undefined;
  const rewrite = body.rewrite === true;

  try {
    const next = await optimizeArticleTitle({
      title,
      body: text,
      family,
      rewrite,
    });
    return NextResponse.json({ title: next });
  } catch (err) {
    const message = err instanceof Error ? err.message : "标题优化失败";
    const status = /先写标题或正文/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
