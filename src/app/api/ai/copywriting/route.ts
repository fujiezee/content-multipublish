import { createArticle, linkGeoKeywordArticle, upsertVariant } from "@/lib/db";
import { streamBrandCopy } from "@/lib/ai/copywriting";
import {
  defaultFamilyForKind,
  isPlatformFamily,
} from "@/lib/content/platform-families";
import type {
  CopywritingKind,
  CopywritingStyle,
  CorpusCategory,
  PlatformFamily,
} from "@/lib/types";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

const VALID_KINDS = new Set<CopywritingKind>([
  "brand_intro",
  "product",
  "social",
  "article",
  "slogan",
]);

const VALID_STYLES = new Set<CopywritingStyle>([
  "default",
  "dan_koe",
  "jinqiang",
  "lijiaoshou",
]);

const VALID_CATEGORIES = new Set<CorpusCategory>([
  "brand",
  "story",
  "product",
  "style",
  "other",
]);

function parseBody(body: unknown) {
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const brief = typeof record.brief === "string" ? record.brief.trim() : "";
  const kind = VALID_KINDS.has(record.kind as CopywritingKind)
    ? (record.kind as CopywritingKind)
    : "brand_intro";
  const style = VALID_STYLES.has(record.style as CopywritingStyle)
    ? (record.style as CopywritingStyle)
    : "default";
  const tone = typeof record.tone === "string" ? record.tone : undefined;
  const saveAsArticle = record.saveAsArticle === true;
  const stream = record.stream !== false;
  const categories = Array.isArray(record.categories)
    ? record.categories.filter((c: string) =>
        VALID_CATEGORIES.has(c as CorpusCategory),
      )
    : undefined;
  const corpusIds = Array.isArray(record.corpusIds)
    ? record.corpusIds.filter((id: unknown) => typeof id === "string")
    : undefined;
  const geoKeywordId =
    typeof record.geoKeywordId === "string" ? record.geoKeywordId.trim() : "";
  const family: PlatformFamily = isPlatformFamily(record.family)
    ? record.family
    : defaultFamilyForKind(kind);
  return {
    brief,
    kind,
    style,
    tone,
    saveAsArticle,
    stream,
    categories,
    corpusIds,
    geoKeywordId,
    family,
  };
}

function saveGeneratedArticle(
  result: { title: string; bodyHtml: string; summary: string },
  geoKeywordId: string,
  brief: string,
  family: PlatformFamily,
) {
  const now = new Date().toISOString();
  const article = {
    id: randomUUID(),
    title: result.title,
    body: result.bodyHtml,
    summary: result.summary,
    cover_path: null,
    created_at: now,
    updated_at: now,
  };
  createArticle(article);
  upsertVariant({
    articleId: article.id,
    family,
    title: result.title,
    body: result.bodyHtml,
    summary: result.summary,
    source: "generated",
  });
  if (geoKeywordId) {
    linkGeoKeywordArticle(geoKeywordId, article.id, brief);
  }
  return article;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const {
    brief,
    kind,
    style,
    tone,
    saveAsArticle,
    stream,
    categories,
    corpusIds,
    geoKeywordId,
    family,
  } = parseBody(body);

  if (!brief) {
    return Response.json({ error: "请描述你想写什么文案" }, { status: 400 });
  }

  if (!stream) {
    const { generateBrandCopy } = await import("@/lib/ai/copywriting");
    try {
      const result = await generateBrandCopy({
        kind,
        brief,
        style,
        tone,
        categories,
        corpusIds,
        family,
      });
      if (saveAsArticle) {
        const article = saveGeneratedArticle(
          result,
          geoKeywordId,
          brief,
          family,
        );
        return Response.json({ ...result, article, family });
      }
      return Response.json({ ...result, family });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message }, { status: 500 });
    }
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        for await (const event of streamBrandCopy(
          { kind, brief, style, tone, categories, corpusIds, family },
          { signal: abort.signal },
        )) {
          if (event.type === "done" && saveAsArticle) {
            const article = saveGeneratedArticle(
              event.result,
              geoKeywordId,
              brief,
              family,
            );
            send({ type: "done", result: event.result, article, family });
            continue;
          }
          send(event);
          if (event.type === "error") break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
