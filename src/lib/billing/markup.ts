/**
 * API / 模型调用加价：按工作区「累计充值金额（元）」分三档。
 * 默认 ×1.5 → 满 5000 ×1.3 → 满 10000 ×1.1
 */
export type ApiPriceTierId = "default" | "plus" | "pro";

export type ApiPriceTier = {
  id: ApiPriceTierId;
  name: string;
  /** 累计充值门槛（元，含） */
  minPaidYuan: number;
  markup: number;
  hint: string;
};

export const API_PRICE_TIERS: ApiPriceTier[] = [
  {
    id: "default",
    name: "标准",
    minPaidYuan: 0,
    markup: 1.5,
    hint: "默认档 · 官网价 ×1.5",
  },
  {
    id: "plus",
    name: "进阶",
    minPaidYuan: 5000,
    markup: 1.3,
    hint: "累计充值满 ¥5,000 · ×1.3",
  },
  {
    id: "pro",
    name: "优选",
    minPaidYuan: 10000,
    markup: 1.1,
    hint: "累计充值满 ¥10,000 · ×1.1",
  },
];

export const API_PUBLIC_BASE = "https://api.dianwu.ai";

export function tierFromPaidYuan(paidYuan: number): ApiPriceTier {
  const paid = Math.max(0, Number(paidYuan) || 0);
  let current = API_PRICE_TIERS[0];
  for (const tier of API_PRICE_TIERS) {
    if (paid >= tier.minPaidYuan) current = tier;
  }
  return current;
}

export function apiMarkup(paidYuan: number): number {
  return tierFromPaidYuan(paidYuan).markup;
}

export function markupPercentFromFactor(markup: number): number {
  return Math.round((markup - 1) * 100);
}

export function markupLabelFromPaidYuan(paidYuan: number): string {
  const tier = tierFromPaidYuan(paidYuan);
  return `${tier.name} · 官网价 ×${tier.markup}`;
}

/** 官方成本（分）× 加价系数 → 售价（分），按分四舍五入，最少 1 分 */
export function sellFen(officialFen: number, markup = 1.5): number {
  if (!Number.isFinite(officialFen) || officialFen <= 0) return 0;
  const factor =
    Number.isFinite(markup) && markup > 0 ? markup : API_PRICE_TIERS[0].markup;
  return Math.max(1, Math.round(officialFen * factor));
}

/** @deprecated 兼容旧调用：忽略 planId，按默认 1.5 */
export function planMarkup(_planId?: string | null): number {
  return API_PRICE_TIERS[0].markup;
}

export function markupPercent(_planId?: string | null): number {
  return markupPercentFromFactor(API_PRICE_TIERS[0].markup);
}

export function markupPercentLabel(_planId?: string | null): string {
  return markupLabelFromPaidYuan(0);
}

export function yuanToFen(yuan: number): number {
  return Math.round(yuan * 100);
}

export function fenToYuan(fen: number): number {
  return fen / 100;
}
