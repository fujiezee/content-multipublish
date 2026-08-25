import { deleteGeoMine, getGeoMine, listGeoKeywordArticlesByMine, listGeoKeywordsByMine } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function mineInWorkspace(id: string, workspaceId: string) {
  const mine = getGeoMine(id);
  if (!mine) return undefined;
  return (mine.workspace_id || "ws_local") === workspaceId ? mine : undefined;
}

export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const mine = mineInWorkspace(id, auth.ctx.workspaceId);
  if (!mine) {
    return Response.json({ error: "挖词记录不存在" }, { status: 404 });
  }
  const keywords = listGeoKeywordsByMine(id);
  const keywordArticles = listGeoKeywordArticlesByMine(id);
  return Response.json({ mine, keywords, keywordArticles });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!mineInWorkspace(id, auth.ctx.workspaceId)) {
    return Response.json({ error: "挖词记录不存在" }, { status: 404 });
  }
  deleteGeoMine(id);
  await persistCloudflareDb();
  return Response.json({ ok: true });
}
