import {
  buildFallbackImagePrompt,
  generateInfographicCards,
  type InfographicCard,
} from "@/lib/ai/infographic";
import { insertInfographicsIntoHtml } from "@/lib/ai/infographic-insert";
import { generateImageWithChat } from "@/lib/ai/openai-image";
import {
  familyLabel,
  isPlatformFamily,
  type PlatformFamily,
} from "@/lib/content/platform-families";
import {
  getArticle,
  listVariants,
  updateArticle,
  upsertVariant,
} from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Long-form families that reuse the same infographics from master. */
const SYNC_FAMILIES = new Set<PlatformFamily>([
  "tech",
  "media",
  "knowledge",
  "wechat",
  "cloud",
  "finance",
]);

type Item = {
  card: InfographicCard & { imagePrompt: string };
  url: string;
  model?: string;
};

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
  const nextBodyHtml = insertInfographicsIntoHtml(input.bodyHtml, placements);
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
      if (!SYNC_FAMILIES.has(variant.family)) continue;
      if (family !== "master" && variant.family === family) {
        synced.push({
          family: variant.family,
          label: familyLabel(variant.family),
        });
        continue;
      }
      if (!variant.body?.trim()) continue;

      const withImages = insertInfographicsIntoHtml(variant.body, placements);
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

export async function POST(req: Request) {
  const body = (await req.json()) as {
    title?: string;
    bodyHtml?: string;
    count?: number;
    articleId?: string;
    family?: string;
    syncVariants?: boolean;
    /** NDJSON progress stream (default true) */
    stream?: boolean;
  };

  const title = typeof body.title === "string" ? body.title : "";
  const bodyHtml = typeof body.bodyHtml === "string" ? body.bodyHtml : "";
  const count = body.count;
  const articleId =
    typeof body.articleId === "string" ? body.articleId.trim() : "";
  const family = isPlatformFamily(body.family) ? body.family : "master";
  const syncVariants = body.syncVariants !== false && family !== "social";
  const stream = body.stream !== false;

  const encoder = new TextEncoder();
  const send = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: Record<string, unknown>,
  ) => {
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
  };

  const run = async (
    emit: (event: Record<string, unknown>) => void,
  ): Promise<void> => {
    emit({ type: "status", message: "正在抽取配图片段…" });
    const cards = await generateInfographicCards({ title, bodyHtml, count });
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
      const card = cards[i];
      const prompt = card.imagePrompt || buildFallbackImagePrompt(card);
      emit({
        type: "image_start",
        index: i,
        total: cards.length,
        headline: card.headline,
      });
      try {
        const { url, model } = await generateImageWithChat(prompt);
        const item: Item = {
          card: { ...card, imagePrompt: prompt },
          url,
          model,
        };
        items.push(item);

        // Progressive insert so editor shows each image as it lands
        const partial = persistInfographics({
          articleId,
          title,
          bodyHtml,
          family: family === "social" || isPlatformFamily(family) ? family : "master",
          // Sync variants only once at the end to avoid repeated writes
          syncVariants: false,
          items,
        });

        emit({
          type: "image_done",
          index: i,
          total: cards.length,
          item,
          bodyHtml: partial.bodyHtml,
          inserted: items.length,
        });
      } catch (err) {
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
      bodyHtml,
      family: family === "social" || isPlatformFamily(family) ? family : "master",
      syncVariants,
      items,
    });

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
      const status = /未配置|太短|未能生成|格式|图像 API|Google 图像|不存在/.test(
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
        send(controller, { type: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
