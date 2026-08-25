import { requireApiUser } from "@/lib/auth/api";
import { consumeOrRespond, peekDeniedResponse, refundQuota } from "@/lib/billing/account";
import {
  createArticle,
  getWriterAgentInWorkspace,
  linkGeoKeywordArticle,
  upsertVariant,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import { streamBrandCopy, listCopywritingModelOptions } from "@/lib/ai/copywriting";
import {
  defaultFamilyForKind,
  isPlatformFamily,
} from "@/lib/content/platform-families";
import type {
  CopywritingKind,
  CopywritingStyle,
  CorpusCategory,
  MarketingAngle,
  PlatformFamily,
  PodcastMode,
} from "@/lib/types";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 300;

const VALID_KINDS = new Set<CopywritingKind>([
  "brand_intro",
  "product",
  "marketing",
  "oral",
  "social",
  "article",
  "slogan",
  "script_outline",
]);

const VALID_STYLES = new Set<CopywritingStyle>([
  "default",
  "dan_koe",
  "jinqiang",
  "lijiaoshou",
  "conflict_beat",
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
  const family: PlatformFamily =
    kind === "script_outline"
      ? "short_video"
      : isPlatformFamily(record.family)
        ? record.family
        : defaultFamilyForKind(kind);
  const writerAgentId =
    typeof record.writerAgentId === "string" ? record.writerAgentId.trim() : "";
  const modelSlug =
    typeof record.modelSlug === "string"
      ? record.modelSlug.trim()
      : typeof record.model === "string"
        ? record.model.trim()
        : "";
  const marketingAngle: MarketingAngle | undefined =
    kind === "marketing"
      ? record.marketingAngle === "hope"
        ? "hope"
        : "anxiety"
      : undefined;
  const oralMode: PodcastMode | undefined =
    kind === "oral"
      ? record.oralMode === "dialogue"
        ? "dialogue"
        : "solo"
      : undefined;
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
    writerAgentId,
    modelSlug,
    marketingAngle,
    oralMode,
  };
}

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  return Response.json({ models: listCopywritingModelOptions() });
}

function saveGeneratedArticle(
  result: { title: string; bodyHtml: string; summary: string; scriptTitle?: string },
  geoKeywordId: string,
  brief: string,
  family: PlatformFamily,
  workspaceId: string,
) {
  const now = new Date().toISOString();
  const article = {
    id: randomUUID(),
    title: result.title,
    body: result.bodyHtml,
    summary: result.summary,
    script_title: result.scriptTitle?.trim().slice(0, 16) || "",
    cover_path: null,
    workspace_id: workspaceId,
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
  void persistCloudflareDb();
  return article;
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
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
    writerAgentId,
    modelSlug,
    marketingAngle,
    oralMode,
  } = parseBody(body);

  if (!brief && kind !== "marketing" && kind !== "oral") {
    return Response.json({ error: "请描述你想写什么文案" }, { status: 400 });
  }

  const writerAgent = writerAgentId
    ? getWriterAgentInWorkspace(writerAgentId, auth.ctx.workspaceId)
    : undefined;
  if (writerAgentId && !writerAgent) {
    return Response.json({ error: "这个写手不存在，重新蒸馏一个" }, { status: 400 });
  }

  const emptyQuota = peekDeniedResponse(auth.ctx.workspaceId, "articles");
  if (emptyQuota) return emptyQuota;

  if (saveAsArticle) {
    const denied = consumeOrRespond(
      auth.ctx.workspaceId,
      "articles",
      1,
      null,
      auth.ctx.email,
    );
    if (denied) return denied;
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
        writerAgent,
        modelSlug: modelSlug || undefined,
        marketingAngle,
        oralMode,
      });
      if (saveAsArticle) {
        const article = saveGeneratedArticle(
          result,
          geoKeywordId,
          brief,
          family,
          auth.ctx.workspaceId,
        );
        return Response.json({ ...result, article, family });
      }
      return Response.json({ ...result, family });
    } catch (err) {
      if (saveAsArticle) refundQuota(auth.ctx.workspaceId, "articles", 1, null, auth.ctx.email);
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
          { kind, brief, style, tone, categories, corpusIds, family, writerAgent, modelSlug: modelSlug || undefined, marketingAngle, oralMode },
          { signal: abort.signal },
        )) {
          if (event.type === "done" && saveAsArticle) {
            const article = saveGeneratedArticle(
              event.result,
              geoKeywordId,
              brief,
              family,
              auth.ctx.workspaceId,
            );
            send({ type: "done", result: event.result, article, family });
            continue;
          }
          send(event);
          if (event.type === "error") {
            if (saveAsArticle) refundQuota(auth.ctx.workspaceId, "articles", 1, null, auth.ctx.email);
            break;
          }
        }
      } catch (err) {
        if (saveAsArticle) refundQuota(auth.ctx.workspaceId, "articles", 1, null, auth.ctx.email);
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
      "X-Accel-Buffering": "no",
    },
  });
}
