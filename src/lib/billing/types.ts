import type { LicensePlanId } from "@/lib/billing/plans";

export type QuotaKind = "articles" | "images" | "mentions" | "videoSeconds";

/** 用量流水 kind：配额桶 + 钱包直扣（API / 音乐） */
export type UsageKind = QuotaKind | "api" | "music";

export type QuotaSnap = {
  kind: QuotaKind;
  label: string;
  unit: string;
  used: number;
  extra: number;
  cap: number | "unlimited";
  includedLeft: number | "unlimited";
  remaining: number | "unlimited";
  walletUnits: number;
};

export type WorkspacePlanView = {
  workspaceId: string;
  workspaceName: string;
  planId: LicensePlanId;
  planName: string;
  forWho: string;
  periodStart: string;
  note: string;
  walletFen: number;
  /** 累计已支付充值金额（元），用于 API 加价档 */
  paidRechargeYuan: number;
  quotas: QuotaSnap[];
  extras: {
    articles: number;
    images: number;
    mentions: number;
    videoSeconds: number;
  };
  caps: {
    articles: number | null;
    images: number | null;
    mentions: number | null;
    videoSeconds: number | null;
  };
};

export type BillingOrderKind = "plan" | "pack" | "wallet";
export type BillingOrderStatus = "pending" | "paid" | "failed" | "cancelled";
export type BillingPlanInterval = "monthly" | "yearly" | "once";

export type BillingOrder = {
  id: string;
  workspaceId: string;
  actorEmail: string;
  kind: BillingOrderKind;
  sku: string;
  label: string;
  interval: BillingPlanInterval;
  amountYuan: number;
  status: BillingOrderStatus;
  createdAt: string;
  paidAt: string | null;
};

export type BillingUsage = {
  id: string;
  workspaceId: string;
  actorEmail: string;
  kind: UsageKind;
  label: string;
  unit: string;
  amount: number;
  fromIncluded: number;
  fromWallet: number;
  walletFen: number;
  meter: string;
  createdAt: string;
};

/** 配图 / 出片 / API / 音乐等走模型计价；文章 / 查排名等算产品功能 */
export type BillingUsageBucket = "model" | "other";

export function billingUsageBucket(row: BillingUsage): BillingUsageBucket {
  if (
    row.kind === "images" ||
    row.kind === "videoSeconds" ||
    row.kind === "api" ||
    row.kind === "music"
  ) {
    return "model";
  }
  if (row.meter?.trim()) return "model";
  return "other";
}

export function splitBillingUsage(rows: BillingUsage[]): {
  model: BillingUsage[];
  other: BillingUsage[];
} {
  const model: BillingUsage[] = [];
  const other: BillingUsage[] = [];
  for (const row of rows) {
    if (billingUsageBucket(row) === "model") model.push(row);
    else other.push(row);
  }
  return { model, other };
}
