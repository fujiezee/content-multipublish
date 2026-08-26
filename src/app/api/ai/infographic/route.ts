import {
  buildFallbackImagePrompt,
  generateInfographicCards,
  type InfographicCard,
} from "@/lib/ai/infographic";
import {
  countInfographicBlocks,
  extractInfographicImgs,
  insertInfographicsIntoHtml,
  normalizeInfographicUrl,
  placementsFromInfographicRows,
} from "@/lib/ai/infographic-insert";
import { gatewayImageGenerate } from "@/lib/ai/gateway";
import { familyLabel, isPlatformFamily, type PlatformFamily } from "@/lib/content/platform-families";
import { ensureStoredInfographicsInHtml } from "@/lib/ai/apply-master-infographics";
import { resolveInfographicImageModelId } from "@/lib/ai/image-gen-models";
import { requireApiUser } from "@/lib/auth/api";
import {
  peekDeniedResponse,
  refundQuota,
  tryConsumeQuota,
  viewWorkspacePlan,
} from "@/lib/billing/account";
import { remainingWithMeter } from "@/lib/billing/meters";
import { quotaRechargeText } from "@/lib/billing/copy";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import {
  getArticle,
  getArticleInWorkspace,
  insertArticleInfographic,
  listArticleInfographics,
  listVariants,
  updateArticle,
  upsertVariant,
} from "@/lib/db";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 800;

function clampAskedCount(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 3;
  return Math.min(5, Math.max(1, Math.round(v)));
}

type Item = {
  card: InfographicCard & { imagePrompt: string };
  url: string;
  model?: string;
};

function recordFamily(family: "master" | PlatformFamily): "master" | "social" {
  return family === "social" ? "social" : "master";
}

function itemsFromRecords(
  rows: ReturnType<typeof listArticleInfographics>,
): Item[] {
  return rows.map((row) => {
    let card: InfographicCard = {
      kind: (row.kind as InfographicCard["kind"]) || "points",
      headline: row.headline || "信息图",
      anchorText: row.anchor_text,
      insertHint: row.insert_hint,
    };
    try {
      const parsed = JSON.parse(row.card_json || "{}") as InfographicCard;
      if (parsed && typeof parsed === "object" && parsed.headline) {
        card = parsed;
      }
    } catch {
      // keep fallback card
    }
    return {
      card: { ...card, imagePrompt: card.imagePrompt || "" },
      url: row.url,
    };
  });
}

function persistInfographics(input: {
  articleId: string;
  title: string;
  bodyHtml: string;
  family: "master" | PlatformFamily;
  syncVariants: boolean;
  items: Item[];
}): {
  bodyHtml: string;
  synced: { family: PlatformFamily; label: string }[];
} {
  const placements = input.items.map((item) => ({
    url: item.url,
    alt: item.card.headline || "信息图",
    anchorText: item.card.anchorText,
    insertHint: item.card.insertHint,
  }));
  const latest = input.articleId ? getArticle(input.articleId) : undefined;
  const storedFamily = recordFamily(
    input.family === "social" || isPlatformFamily(input.family)
      ? input.family
      : "master",
  );
  const stored = input.articleId
    ? listArticleInfographics(input.articleId, storedFamily)
    : [];
  const fromDb =
    storedFamily === "social"
      ? listVariants(input.articleId).find((v) => v.family === "social")?.body ||
        ""
      : latest?.body || "";
  const sourceHtml = fromDb || input.bodyHtml;
  const storedPlacements = placementsFromInfographicRows(stored);
  const storedUrls = new Set(
    storedPlacements.map((p) => normalizeInfographicUrl(p.url)).filter(Boolean),
  );
  const nextBodyHtml = insertInfographicsIntoHtml(sourceHtml, [
    ...storedPlacements,
    ...placements.filter((p) => {
      const url = normalizeInfographicUrl(p.url);
      return Boolean(url) && !storedUrls.has(url);
    }),
  ]);
  const synced: { family: PlatformFamily; label: string }[] = [];

  if (!input.articleId) {
    return { bodyHtml: nextBodyHtml, synced };
  }

  const article = getArticle(input.articleId);
  if (!article) {
    throw new Error("文章不存在");
  }

  const { family } = input;
  if (family === "master" || !isPlatformFamily(family)) {
    updateArticle(input.articleId, {
      title: input.title || article.title,
      body: nextBodyHtml,
      summary: article.summary,
      cover_path: article.cover_path,
    });
  } else if (family === "social") {
    const existing = listVariants(input.articleId).find(
      (v) => v.family === "social",
    );
    upsertVariant({
      articleId: input.articleId,
      family: "social",
      title: input.title || existing?.title || article.title,
      body: nextBodyHtml,
      summary: existing?.summary || article.summary || "",
      source: existing?.source || "manual",
    });
  } else {
    const existing = listVariants(input.articleId).find(
      (v) => v.family === family,
    );
    upsertVariant({
      articleId: input.articleId,
      family,
      title: input.title || existing?.title || article.title,
      body: nextBodyHtml,
      summary: existing?.summary || article.summary || "",
      source: existing?.source || "manual",
    });
  }

  if (input.syncVariants) {
    const variants = listVariants(input.articleId);
    for (const variant of variants) {
      if (family !== "master" && variant.family === family) {
        synced.push({
          family: variant.family,
          label: familyLabel(variant.family),
        });
        continue;
      }
      if (!variant.body?.trim()) continue;

      const withImages = ensureStoredInfographicsInHtml(
        input.articleId,
        variant.family,
        variant.body,
      );
      if (withImages === variant.body) continue;

      upsertVariant({
        articleId: input.articleId,
        family: variant.family,
        title: variant.title,
        body: withImages,
        summary: variant.summary,
        source: variant.source,
      });
      synced.push({
        family: variant.family,
        label: familyLabel(variant.family),
      });
    }
  }

  return { bodyHtml: nextBodyHtml, synced };
}

function saveInfographicRows(
  articleId: string,
  family: "master" | "social",
  items: Item[],
) {
  if (!articleId) return;
  const now = new Date().toISOString();
  for (const item of items) {
    insertArticleInfographic({
      id: randomUUID(),
      article_id: articleId,
      family,
      url: item.url,
      headline: item.card.headline || "信息图",
      kind: item.card.kind || "points",
      card_json: JSON.stringify(item.card),
      anchor_text: item.card.anchorText || "",
      insert_hint: item.card.insertHint || "",
      created_at: now,
    });
  }
}

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const articleId = url.searchParams.get("articleId")?.trim() || "";
  const familyRaw = url.searchParams.get("family") || "master";
  const family = familyRaw === "social" ? "social" : "master";
  if (!articleId) {
    return Response.json({ items: [] });
  }
  if (!getArticleInWorkspace(articleId, auth.ctx.workspaceId)) {
    return Response.json({ error: "文章不存在" }, { status: 404 });
  }
  const rows = listArticleInfographics(articleId, family);
  return Response.json({ items: itemsFromRecords(rows) });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const body = (await req.json()) as {
    title?: string;
    bodyHtml?: string;
    count?: number;
    articleId?: string;
    family?: string;
    syncVariants?: boolean;
    stream?: boolean;
  };

  const title = typeof body.title === "string" ? body.title : "";
  const bodyHtml = typeof body.bodyHtml === "string" ? body.bodyHtml : "";
  const articleId =
    typeof body.articleId === "string" ? body.articleId.trim() : "";
  const family = isPlatformFamily(body.family) ? body.family : "master";
  const storedFamily = recordFamily(family);
  const syncVariants = body.syncVariants !== false && family !== "social";
  const stream = body.stream !== false;
  const imageMeter = resolveInfographicImageModelId();

  if (articleId && !getArticleInWorkspace(articleId, auth.ctx.workspaceId)) {
    return Response.json({ error: "文章不存在" }, { status: 404 });
  }

  const emptyQuota = peekDeniedResponse(
    auth.ctx.workspaceId,
    "images",
    1,
    imageMeter,
  );
  if (emptyQuota) return emptyQuota;

  const imageLeft = remainingWithMeter(
    viewWorkspacePlan(auth.ctx.workspaceId),
    "images",
    imageMeter,
  );
  const asked = clampAskedCount(body.count);
  const count =
    imageLeft === "unlimited" || imageLeft === undefined
      ? asked
      : Math.min(asked, Math.max(0, imageLeft));
  const article = articleId ? getArticle(articleId) : undefined;
  const existingRows = articleId
    ? listArticleInfographics(articleId, storedFamily)
    : [];
  const dbBody =
    family === "social"
      ? listVariants(articleId).find((v) => v.family === "social")?.body ||
        bodyHtml
      : article?.body || bodyHtml;
  const baseHtml =
    countInfographicBlocks(dbBody) >= countInfographicBlocks(bodyHtml)
      ? dbBody
      : bodyHtml;

  const encoder = new TextEncoder();
  const send = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: Record<string, unknown>,
  ) => {
    try {
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    } catch {
      // 浏览器已经断开，后面的图仍要继续落盘
    }
  };

  const withPulse = async <T>(
    emit: (event: Record<string, unknown>) => void,
    message: string,
    work: () => Promise<T>,
  ): Promise<T> => {
    emit({ type: "status", message });
    const timer = setInterval(() => {
      emit({ type: "status", message: `${message}还在跑，先别关。` });
    }, 8000);
    try {
      return await work();
    } finally {
      clearInterval(timer);
    }
  };

  const run = async (
    emit: (event: Record<string, unknown>) => void,
  ): Promise<void> => {
    const fromHtml = extractInfographicImgs(baseHtml);
    if (count < asked) {
      emit({
        type: "quota_cap",
        asked,
        remaining: count,
        message: `还剩 ${count} 张配图，这次只出 ${count} 张`,
      });
    }
    const cards = await withPulse(
      emit,
      "正在通读全文，按尚未配图的整节规划…",
      () =>
        generateInfographicCards({
          title,
          bodyHtml: baseHtml,
          count,
          excludeAnchors: existingRows.map((r) => r.anchor_text).filter(Boolean),
          excludeHeadlines: [
            ...existingRows.map((r) => r.headline),
            ...fromHtml.map((img) => img.alt),
          ].filter(Boolean),
        }),
    );
    emit({
      type: "cards",
      total: cards.length,
      cards: cards.map((c) => ({
        headline: c.headline,
        kind: c.kind,
        anchorText: c.anchorText,
        insertHint: c.insertHint,
      })),
    });

    const items: Item[] = [];
    for (let i = 0; i < cards.length; i++) {
      const remaining = remainingWithMeter(
        viewWorkspacePlan(auth.ctx.workspaceId),
        "images",
        imageMeter,
      );
      if (remaining !== "unlimited" && remaining !== undefined && remaining <= 0) {
        if (items.length === 0) {
          throw new Error(quotaRechargeText("images"));
        }
        emit({
          type: "image_error",
          code: "quota",
          index: i,
          total: cards.length,
          headline: cards[i].headline,
          error: quotaRechargeText("images"),
        });
        break;
      }
      const gate = tryConsumeQuota(
        auth.ctx.workspaceId,
        "images",
        1,
        imageMeter,
        auth.ctx.email,
      );
      if (!gate.ok) {
        if (items.length === 0) throw new Error(gate.error);
        emit({
          type: "image_error",
          code: "quota",
          index: i,
          total: cards.length,
          headline: cards[i].headline,
          error: gate.error,
        });
        break;
      }
      const card = cards[i];
      const prompt = card.imagePrompt || buildFallbackImagePrompt(card);
      emit({
        type: "image_start",
        index: i,
        total: cards.length,
        headline: card.headline,
      });
      try {
        const { url, model } = await withPulse(
          emit,
          `正在生成第 ${i + 1}/${cards.length} 张：${card.headline}`,
          () =>
            gatewayImageGenerate(imageMeter, { prompt }),
        );
        const item: Item = {
          card: { ...card, imagePrompt: prompt },
          url,
          model,
        };
        items.push(item);
        saveInfographicRows(articleId, storedFamily, [item]);

        const partial = persistInfographics({
          articleId,
          title,
          bodyHtml: baseHtml,
          family:
            family === "social" || isPlatformFamily(family) ? family : "master",
          syncVariants: false,
          items,
        });
        await persistCloudflareDb();

        emit({
          type: "image_done",
          index: i,
          total: cards.length,
          item,
          bodyHtml: partial.bodyHtml,
          inserted: items.length,
        });
      } catch (err) {
        refundQuota(
          auth.ctx.workspaceId,
          "images",
          1,
          imageMeter,
          auth.ctx.email,
        );
        emit({
          type: "image_error",
          index: i,
          total: cards.length,
          headline: card.headline,
          error: err instanceof Error ? err.message : "生图失败",
        });
      }
    }

    if (items.length === 0) {
      throw new Error("图像生成全部失败，请稍后重试");
    }

    const final = persistInfographics({
      articleId,
      title,
      bodyHtml: baseHtml,
      family: family === "social" || isPlatformFamily(family) ? family : "master",
      syncVariants,
      items,
    });
    await persistCloudflareDb();

    emit({
      type: "done",
      items,
      bodyHtml: final.bodyHtml,
      inserted: items.length,
      syncedFamilies: final.synced,
      variants: articleId ? listVariants(articleId) : undefined,
    });
  };

  if (!stream) {
    try {
      let result: Record<string, unknown> | null = null;
      await run((event) => {
        if (event.type === "done") result = event;
      });
      return Response.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成失败";
      if (/额度|没额度|费用页|请充值|不足/.test(message)) {
        return Response.json(
          { error: message, code: "quota", kind: "images" },
          { status: 402 },
        );
      }
      const status = /未配置|太短|未能生成|格式|图像 API|Google 图像|不存在|尚未配图/.test(
        message,
      )
        ? 400
        : 500;
      return Response.json({ error: message }, { status });
    }
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await run((event) => send(controller, event));
      } catch (err) {
        const message = err instanceof Error ? err.message : "生成失败";
        send(controller, {
          type: "error",
          error: message,
          ...( /额度|没额度|费用页|请充值|不足/.test(message) ? { code: "quota" } : {}),
        });
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
