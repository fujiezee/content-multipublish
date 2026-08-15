import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { suggestScriptTitle } from "@/lib/ai/copywriting";
import { getArticleInWorkspace, updateArticle } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const article = getArticleInWorkspace(id, auth.ctx.workspaceId);
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  const existing = (article.script_title || "").trim();
  if (existing) {
    return NextResponse.json({ script_title: existing });
  }
  const name = await suggestScriptTitle({
    title: article.title,
    summary: article.summary,
  });
  if (!name) {
    return NextResponse.json({ script_title: "" });
  }
  updateArticle(id, { script_title: name });
  return NextResponse.json({ script_title: name });
}
