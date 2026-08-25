import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/auth/admin";
import { deleteAiModel, getAiModel, updateAiModel } from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import {
  AI_MODALITIES,
  AI_MODEL_BADGES,
  AI_MODEL_USES,
  AI_PROVIDER_CHANNELS,
  type AiModelBadge,
  type AiModelInput,
  type AiModality,
  type AiModelUse,
  type AiProviderChannel,
} from "@/lib/ai/model-catalog/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function parseBadges(raw: unknown): AiModelBadge[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const allowed = new Set(AI_MODEL_BADGES.map((b) => b.id));
  return raw.filter((u): u is AiModelBadge =>
    typeof u === "string" && allowed.has(u as AiModelBadge),
  );
}

function parseBody(body: unknown): Partial<AiModelInput> {
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const modality = AI_MODALITIES.some((m) => m.id === record.modality)
    ? (record.modality as AiModality)
    : undefined;
  const provider = AI_PROVIDER_CHANNELS.some((p) => p.id === record.provider)
    ? (record.provider as AiProviderChannel)
    : undefined;
  const uses = Array.isArray(record.uses)
    ? record.uses.filter((u): u is AiModelUse =>
        AI_MODEL_USES.some((row) => row.id === u),
      )
    : undefined;
  return {
    slug: typeof record.slug === "string" ? record.slug.trim() : undefined,
    label: typeof record.label === "string" ? record.label.trim() : undefined,
    hint: typeof record.hint === "string" ? record.hint : undefined,
    modality,
    uses,
    provider,
    providerModel:
      typeof record.providerModel === "string"
        ? record.providerModel.trim()
        : undefined,
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    sortOrder: typeof record.sortOrder === "number" ? record.sortOrder : undefined,
    costHint: typeof record.costHint === "string" ? record.costHint : undefined,
    fallbackSlug:
      typeof record.fallbackSlug === "string" ? record.fallbackSlug : undefined,
    badges: parseBadges(record.badges),
  };
}

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const model = getAiModel(id);
  if (!model) {
    return NextResponse.json({ error: "模型不存在" }, { status: 404 });
  }
  return NextResponse.json({ model });
}

export async function PUT(req: Request, ctx: Ctx) {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const patch = parseBody(await req.json().catch(() => ({})));
  try {
    const model = updateAiModel(id, patch);
    if (!model) {
      return NextResponse.json({ error: "模型不存在" }, { status: 404 });
    }
    await persistCloudflareDb();
    return NextResponse.json({ model });
  } catch (err) {
    const message = err instanceof Error ? err.message : "更新失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const ok = deleteAiModel(id);
  if (!ok) {
    return NextResponse.json({ error: "模型不存在" }, { status: 404 });
  }
  await persistCloudflareDb();
  return NextResponse.json({ ok: true });
}
