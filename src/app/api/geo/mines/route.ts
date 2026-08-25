import { randomUUID } from "crypto";
import {
  createGeoMine,
  getGeoMine,
  insertGeoKeywords,
  listAllGeoNormKeys,
  listGeoKeywordArticlesByMine,
  listGeoKeywordsByMine,
  listGeoMines,
  countGeoKeywordsGrouped,
  touchGeoMine,
} from "@/lib/db";
import { mineGeoKeywords, normalizeGeoKeyword } from "@/lib/ai/geo-keywords";
import type { GeoKeyword, GeoKeywordIntent } from "@/lib/types";
import { requireApiUser } from "@/lib/auth/api";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import { parseListPage, slicePage } from "@/lib/list-page";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parseListPage(new URL(req.url));
  const minesRaw = listGeoMines(limit + 1, auth.ctx.workspaceId, offset);
  const page = slicePage(minesRaw, limit, offset);
  const counts = countGeoKeywordsGrouped(page.items.map((m) => m.id));
  const mines = page.items.map((mine) => ({
    ...mine,
    keyword_count: counts.get(mine.id) || 0,
  }));
  return Response.json({
    mines,
    nextOffset: page.nextOffset,
    hasMore: page.hasMore,
  });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const seed = typeof body.seed === "string" ? body.seed.trim() : "";
  const context = typeof body.context === "string" ? body.context.trim() : "";
  const mineId =
    typeof body.mineId === "string" && body.mineId.trim()
      ? body.mineId.trim()
      : null;
  const count =
    typeof body.count === "number" && body.count > 0
      ? Math.min(body.count, 80)
      : 40;

  if (!seed) {
    return Response.json({ error: "请填写产品或主题" }, { status: 400 });
  }

  try {
    const existingNormKeys = listAllGeoNormKeys(auth.ctx.workspaceId);
    const drafts = await mineGeoKeywords({
      seed,
      context,
      count,
      existingNormKeys,
    });

    let mine = mineId ? getGeoMine(mineId) : undefined;
    if (mine && (mine.workspace_id || "ws_local") !== auth.ctx.workspaceId) {
      return Response.json({ error: "挖词记录不存在" }, { status: 404 });
    }
    const now = new Date().toISOString();

    if (!mine) {
      mine = {
        id: randomUUID(),
        seed,
        context,
        created_at: now,
        updated_at: now,
      };
      createGeoMine(mine, auth.ctx.workspaceId);
    } else {
      touchGeoMine(mine.id);
    }

    const keywords: GeoKeyword[] = drafts.map((draft) => ({
      id: randomUUID(),
      mine_id: mine.id,
      keyword: draft.keyword,
      title: draft.title,
      intent: draft.intent as GeoKeywordIntent,
      angle: draft.angle,
      norm_key: normalizeGeoKeyword(draft.keyword),
      article_id: null,
      created_at: now,
    }));

    const inserted = insertGeoKeywords(keywords);
    const all = listGeoKeywordsByMine(mine.id);
    await persistCloudflareDb();

    return Response.json({
      mine,
      keywords: all,
      keywordArticles: listGeoKeywordArticlesByMine(mine.id),
      added: inserted,
      skipped_duplicates: keywords.length - inserted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
