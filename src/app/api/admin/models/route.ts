import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/auth/admin";
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
import {
  createAiModel,
  deleteAiModel,
  listAiModels,
  updateAiModel,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";

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
        : typeof record.provider_model === "string"
          ? record.provider_model.trim()
          : undefined,
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    sortOrder:
      typeof record.sortOrder === "number"
        ? record.sortOrder
        : typeof record.sort_order === "number"
          ? record.sort_order
          : undefined,
    costHint:
      typeof record.costHint === "string"
        ? record.costHint
        : typeof record.cost_hint === "string"
          ? record.cost_hint
          : undefined,
    fallbackSlug:
      typeof record.fallbackSlug === "string"
        ? record.fallbackSlug
        : typeof record.fallback_slug === "string"
          ? record.fallback_slug
          : undefined,
    badges: parseBadges(record.badges),
  };
}

export async function GET() {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;
  try {
    const models = listAiModels({ enabledOnly: false });
    return NextResponse.json({
      models,
      meta: {
        modalities: AI_MODALITIES,
        uses: AI_MODEL_USES,
        providers: AI_PROVIDER_CHANNELS,
        badges: AI_MODEL_BADGES,
      },
    });
  } catch (err) {
    console.error("[admin/models] GET", err);
    const message = err instanceof Error ? err.message : "加载失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;
  const patch = parseBody(await req.json().catch(() => ({})));
  if (!patch.slug || !patch.label || !patch.modality || !patch.provider) {
    return NextResponse.json(
      { error: "请填写 slug、名称、模态、通道" },
      { status: 400 },
    );
  }
  try {
    const model = createAiModel({
      slug: patch.slug,
      label: patch.label,
      hint: patch.hint || "",
      modality: patch.modality,
      uses: patch.uses || [],
      provider: patch.provider,
      providerModel: patch.providerModel || patch.slug,
      enabled: patch.enabled,
      sortOrder: patch.sortOrder,
      costHint: patch.costHint,
      fallbackSlug: patch.fallbackSlug,
    });
    await persistCloudflareDb();
    return NextResponse.json({ model }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "创建失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
