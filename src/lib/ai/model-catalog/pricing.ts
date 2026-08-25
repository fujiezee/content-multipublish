import type { LicensePlanId } from "@/lib/billing/plans";
import {
  API_PRICE_TIERS,
  apiMarkup,
  sellFen,
} from "@/lib/billing/markup";
import { lookupArkOfficialPricing } from "@/lib/ai/model-catalog/ark-prices";
import type {
  AiModelPricingConfig,
  AiModelPricingView,
  AiModelView,
} from "@/lib/ai/model-catalog/types";

export function resolveModelOfficialPricing(
  model: AiModelView,
): AiModelPricingConfig | null {
  const stored = model.config?.pricing;
  // 手工价优先；其余以最新刊例表为准（未写库也能展示）
  if (stored?.source === "manual" || stored?.source === "cloudflare") {
    return stored;
  }
  return (
    lookupArkOfficialPricing(model.slug, model.providerModel) || stored || null
  );
}

/** 有可售官方价才给用户看 / 调。无刊例（如方舟内部档）不上架。 */
export function isBillableOfficialPricing(
  pricing: AiModelPricingConfig | null | undefined,
): pricing is AiModelPricingConfig {
  if (!pricing) return false;
  if (pricing.billUnit === "1m_tokens") {
    return (
      (pricing.officialInputFen ?? 0) > 0 &&
      (pricing.officialOutputFen ?? 0) > 0
    );
  }
  return (pricing.officialFen ?? 0) > 0;
}

export function modelHasBillablePrice(model: AiModelView): boolean {
  return isBillableOfficialPricing(resolveModelOfficialPricing(model));
}

export function pricingViewForMarkup(
  pricing: AiModelPricingConfig | null | undefined,
  markup: number,
  meta?: { planId?: string; paidYuan?: number },
): AiModelPricingView | null {
  if (!pricing) return null;
  const official: AiModelPricingView["official"] = {};
  const sell: AiModelPricingView["sell"] = {};
  if (pricing.officialInputFen != null) {
    official.inputFen = pricing.officialInputFen;
    sell.inputFen = sellFen(pricing.officialInputFen, markup);
  }
  if (pricing.officialOutputFen != null) {
    official.outputFen = pricing.officialOutputFen;
    sell.outputFen = sellFen(pricing.officialOutputFen, markup);
  }
  if (pricing.officialFen != null) {
    official.fen = pricing.officialFen;
    sell.fen = sellFen(pricing.officialFen, markup);
  }
  return {
    billUnit: pricing.billUnit,
    currency: "CNY",
    markup,
    planId: String(meta?.planId || "api"),
    official,
    sell,
  };
}

/** @deprecated 用 withModelPricingForPaid */
export function pricingViewForPlan(
  pricing: AiModelPricingConfig | null | undefined,
  planId: LicensePlanId | string,
): AiModelPricingView | null {
  return pricingViewForMarkup(pricing, apiMarkup(0), { planId: String(planId) });
}

export function withModelPricingForPaid(
  model: AiModelView,
  paidYuan: number,
  planId?: string,
): AiModelView {
  const markup = apiMarkup(paidYuan);
  return {
    ...model,
    pricing: pricingViewForMarkup(resolveModelOfficialPricing(model), markup, {
      planId,
      paidYuan,
    }),
  };
}

export function withModelPricing(
  model: AiModelView,
  planId: LicensePlanId | string,
): AiModelView {
  return withModelPricingForPaid(model, 0, String(planId));
}

/** Admin / 套餐卡：三档充值售价预览 */
export function tierSellPreview(
  pricing: AiModelPricingConfig | null | undefined,
): string {
  if (!pricing) return "无刊例";
  const lines: string[] = [];
  for (const tier of API_PRICE_TIERS) {
    const view = pricingViewForMarkup(pricing, tier.markup);
    if (!view) continue;
    if (view.billUnit === "1m_tokens") {
      lines.push(
        `${tier.name}×${tier.markup}：入 ${view.sell.inputFen ?? "—"}分 / 出 ${view.sell.outputFen ?? "—"}分 /百万`,
      );
    } else {
      lines.push(`${tier.name}×${tier.markup}：${view.sell.fen ?? "—"}分`);
    }
  }
  return lines.join(" · ");
}
