import { NextResponse } from "next/server";
import { streamAdaptArticleToFamily } from "@/lib/ai/adapt-variant";
import {
  ALL_PLATFORM_FAMILIES,
  familyLabel,
  isPlatformFamily,
  type PlatformFamily,
} from "@/lib/content/platform-families";
import {
  getArticle,
  listVariants,
  upsertVariant,
} from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const article = getArticle(id);
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  return NextResponse.json({
    variants: listVariants(id),
    families: ALL_PLATFORM_FAMILIES,
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const article = getArticle(id);
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const force = body.force === true;
  const stream = body.stream !== false;
  const rawFamilies = Array.isArray(body.families) ? body.families : [];
  const families = rawFamilies.filter(isPlatformFamily) as PlatformFamily[];
  if (!families.length) {
    return NextResponse.json(
      { error: "请至少选择一个平台族" },
      { status: 400 },
    );
  }

  const existing = listVariants(id);
  const existingByFamily = new Map(existing.map((v) => [v.family, v]));
  const toGenerate = force
    ? families
    : families.filter((f) => !existingByFamily.get(f)?.body?.trim());
  const skipped = families.filter((f) => !toGenerate.includes(f));

  if (!stream) {
    // Legacy JSON batch (no progress) — still sequential with stream adapter.
    const created = [];
    const errors: { family: PlatformFamily; error: string }[] = [];
    for (const family of skipped) {
      created.push(existingByFamily.get(family)!);
    }
    for (const family of toGenerate) {
      try {
        let adapted = null;
        for await (const event of streamAdaptArticleToFamily({
          title: article.title,
          body: article.body,
          summary: article.summary,
          family,
        })) {
          if (event.type === "done") adapted = event.result;
          if (event.type === "error") throw new Error(event.message);
        }
        if (!adapted) throw new Error("空结果");
        created.push(
          upsertVariant({
            articleId: id,
            family,
            title: adapted.title,
            body: adapted.bodyHtml,
            summary: adapted.summary,
            source: "adapted",
          }),
        );
      } catch (err) {
        errors.push({
          family,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return NextResponse.json({
      variants: listVariants(id),
      updated: created,
      errors,
    });
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      send({
        type: "batch_start",
        total: families.length,
        generate: toGenerate.length,
        skipped: skipped.map((f) => ({
          family: f,
          label: familyLabel(f),
        })),
      });

      for (const family of skipped) {
        const variant = existingByFamily.get(family)!;
        send({
          type: "family_skip",
          family,
          label: familyLabel(family),
          variant,
        });
      }

      let index = 0;
      for (const family of toGenerate) {
        index += 1;
        send({
          type: "family_start",
          family,
          label: familyLabel(family),
          index,
          total: toGenerate.length,
        });

        try {
          for await (const event of streamAdaptArticleToFamily(
            {
              title: article.title,
              body: article.body,
              summary: article.summary,
              family,
            },
            { signal: abort.signal },
          )) {
            if (event.type === "meta") {
              send({
                type: "family_meta",
                family,
                label: familyLabel(family),
                usedCorpus: event.usedCorpus,
                model: event.model,
              });
              continue;
            }
            if (event.type === "thinking") {
              send({
                type: "family_thinking",
                family,
                delta: event.delta,
              });
              continue;
            }
            if (event.type === "content") {
              send({
                type: "family_content",
                family,
                delta: event.delta,
              });
              continue;
            }
            if (event.type === "error") {
              send({
                type: "family_error",
                family,
                label: familyLabel(family),
                error: event.message,
              });
              continue;
            }
            if (event.type === "done") {
              const variant = upsertVariant({
                articleId: id,
                family,
                title: event.result.title,
                body: event.result.bodyHtml,
                summary: event.result.summary,
                source: "adapted",
              });
              send({
                type: "family_done",
                family,
                label: familyLabel(family),
                variant,
                usedCorpus: event.result.usedCorpus,
              });
            }
          }
        } catch (err) {
          send({
            type: "family_error",
            family,
            label: familyLabel(family),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      send({
        type: "batch_done",
        variants: listVariants(id),
      });
      controller.close();
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

export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const article = getArticle(id);
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  if (!isPlatformFamily(body.family)) {
    return NextResponse.json({ error: "无效的平台族" }, { status: 400 });
  }

  const variant = upsertVariant({
    articleId: id,
    family: body.family,
    title: typeof body.title === "string" ? body.title : article.title,
    body: typeof body.body === "string" ? body.body : "",
    summary: typeof body.summary === "string" ? body.summary : "",
    source: "manual",
  });

  return NextResponse.json({ variant });
}
