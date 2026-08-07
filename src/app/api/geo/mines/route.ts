import { randomUUID } from "crypto";
import {
  createGeoMine,
  getGeoMine,
  insertGeoKeywords,
  listAllGeoNormKeys,
  listGeoKeywordArticlesByMine,
  listGeoKeywordsByMine,
  listGeoMines,
  touchGeoMine,
} from "@/lib/db";
import { mineGeoKeywords, normalizeGeoKeyword } from "@/lib/ai/geo-keywords";
import type { GeoKeyword, GeoKeywordIntent } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const mines = listGeoMines().map((mine) => ({
    ...mine,
    keyword_count: listGeoKeywordsByMine(mine.id).length,
  }));
  return Response.json({ mines });
}

export async function POST(req: Request) {
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
    return Response.json({ error: "请填写主词" }, { status: 400 });
  }

  try {
    const existingNormKeys = listAllGeoNormKeys();
    const drafts = await mineGeoKeywords({
      seed,
      context,
      count,
      existingNormKeys,
    });

    let mine = mineId ? getGeoMine(mineId) : undefined;
    const now = new Date().toISOString();

    if (!mine) {
      mine = {
        id: randomUUID(),
        seed,
        context,
        created_at: now,
        updated_at: now,
      };
      createGeoMine(mine);
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
