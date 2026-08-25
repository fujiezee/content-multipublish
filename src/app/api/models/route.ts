import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import { gatewayListModels } from "@/lib/ai/gateway";
import { withModelPricingForPaid } from "@/lib/ai/model-catalog/pricing";
import type { AiModality, AiModelUse } from "@/lib/ai/model-catalog/types";
import { corsPreflight, withCors } from "@/lib/api-cors";
import { viewWorkspacePlan } from "@/lib/billing/account";
import {
  API_PUBLIC_BASE,
  apiMarkup,
  markupLabelFromPaidYuan,
  tierFromPaidYuan,
} from "@/lib/billing/markup";
import { getLicensePlan } from "@/lib/billing/plans";

export const runtime = "nodejs";

const USES = new Set<AiModelUse>([
  "copywriting",
  "script",
  "shot",
  "infographic",
  "cover",
  "character",
  "video",
  "tts",
  "asr",
  "music",
]);

const MODALITIES = new Set<AiModality>([
  "text",
  "image",
  "video",
  "audio",
  "music",
]);

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

/** 前台统一模型列表：附带按累计充值档位的售价 */
export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return withCors(auth.response, req);

  const url = new URL(req.url);
  const modalityRaw = url.searchParams.get("modality") || "";
  const useRaw = url.searchParams.get("use") || "";
  const includeNotReady = url.searchParams.get("ready") === "0";
  const allModels = url.searchParams.get("all") === "1";
  const modality = MODALITIES.has(modalityRaw as AiModality)
    ? (modalityRaw as AiModality)
    : undefined;
  const use = USES.has(useRaw as AiModelUse)
    ? (useRaw as AiModelUse)
    : undefined;

  const billing = viewWorkspacePlan(auth.ctx.workspaceId);
  const paidYuan = billing.paidRechargeYuan ?? 0;
  const tier = tierFromPaidYuan(paidYuan);
  const plan = getLicensePlan(billing.planId);

  const models = gatewayListModels({
    modality,
    use,
    enabledOnly: !allModels,
    readyOnly: allModels ? false : !includeNotReady,
    pricedOnly: !allModels,
  }).map((m) => withModelPricingForPaid(m, paidYuan, billing.planId));

  return withCors(
    NextResponse.json({
      models,
      baseUrl: API_PUBLIC_BASE,
      pricing: {
        planId: billing.planId,
        planName: plan.name,
        paidRechargeYuan: paidYuan,
        tierId: tier.id,
        tierName: tier.name,
        markup: apiMarkup(paidYuan),
        markupLabel: markupLabelFromPaidYuan(paidYuan),
      },
    }),
    req,
  );
}
