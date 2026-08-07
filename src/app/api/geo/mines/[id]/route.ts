import { deleteGeoMine, getGeoMine, listGeoKeywordArticlesByMine, listGeoKeywordsByMine } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const mine = getGeoMine(id);
  if (!mine) {
    return Response.json({ error: "挖词记录不存在" }, { status: 404 });
  }
  const keywords = listGeoKeywordsByMine(id);
  const keywordArticles = listGeoKeywordArticlesByMine(id);
  return Response.json({ mine, keywords, keywordArticles });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getGeoMine(id)) {
    return Response.json({ error: "挖词记录不存在" }, { status: 404 });
  }
  deleteGeoMine(id);
  return Response.json({ ok: true });
}
