/** 点物标价。首页、设置、日后门禁共用这一份。 */
import { usageFen } from "@/lib/billing/meters";

export const SITE_BRAND = "点物";
export const PRODUCT_NAME = "AI智能内容营销系统";
/** 用户要的结果 */
export const PRODUCT_LINE = "别人问起你时，答案里有你";
/** 系统是什么 */
export const PRODUCT_HOW =
  "AI帮你写文章、配图、出播客、写剧本、做视频，再自动发出去。";

export type LicensePlanId = "trial" | "workbench" | "machine" | "private";

export type QuotaAmount = number | "unlimited" | "custom";

export type LicenseQuotas = {
  seats: QuotaAmount;
  articles: QuotaAmount;
  infographics: QuotaAmount;
  mentions: QuotaAmount;
  videoSeconds: QuotaAmount;
};

export type LicensePlan = {
  id: LicensePlanId;
  name: string;
  forWho: string;
  /** 发票品名，不直接铺在卡片上 */
  invoiceName: string;
  monthlyYuan: number | null;
  yearlyYuan: number | null;
  /** 面议档的起步价，仅展示 */
  fromYuan?: number;
  featured?: boolean;
  ctaLabel: string;
  ctaHref: string;
  quotas: LicenseQuotas;
  points: string[];
};

export type CreditPackId = "video-120" | "image-40" | "mention-50";

export type CreditPack = {
  id: CreditPackId;
  name: string;
  priceYuan: number;
  amount: number;
  unit: string;
  note: string;
};

export type FulfillmentLane = {
  id: "media" | "ads";
  name: string;
  href: string;
  body: string;
};

export function formatYuan(n: number): string {
  if (Math.abs(n - Math.round(n)) < 1e-9) {
    return `¥${Math.round(n).toLocaleString("zh-CN")}`;
  }
  return `¥${n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatFen(fen: number): string {
  return formatYuan(fen / 100);
}

/** 始终两位小数，方便对照官方价 × 档位倍率 */
export function formatFenExact(fen: number): string {
  return `¥${(fen / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function quotaLabel(amount: QuotaAmount, unit: string): string {
  if (amount === "unlimited") return `${unit}不限`;
  if (amount === "custom") return `${unit}另写`;
  if (amount === 0) return `不出${unit === "秒出片" ? "片" : unit}`;
  return `${unit} ${amount}`;
}

export const YEARLY_MONTHS = 10;

export const LICENSE_PLANS: LicensePlan[] = [
  {
    id: "trial",
    name: "免费",
    forWho: "让你的品牌被世界看到",
    invoiceName: "",
    monthlyYuan: 0,
    yearlyYuan: 0,
    ctaLabel: "免费试试",
    ctaHref: "/writing",
    quotas: {
      seats: 1,
      articles: 3,
      infographics: 2,
      mentions: 5,
      videoSeconds: 0,
    },
    points: ["写出一篇能发的文章", "能改成几个平台的版本", "做视频要开通专业方案"],
  },
  {
    id: "workbench",
    name: "专业",
    forWho: "一个人做完内容营销",
    invoiceName: "点物 AI智能内容营销系统软件许可费（专业）",
    monthlyYuan: 299,
    yearlyYuan: 2990,
    featured: true,
    ctaLabel: "开通专业",
    ctaHref: "/writing",
    quotas: {
      seats: 1,
      articles: "unlimited",
      infographics: 30,
      mentions: 40,
      videoSeconds: 60,
    },
    points: [
      "写文章、做视频、发出去、查排名，一条线",
      "不用自己对接模型",
      "找媒体发、投广告另算",
    ],
  },
  {
    id: "machine",
    name: "团队",
    forWho: "几个人共用一条流水线",
    invoiceName: "点物 AI智能内容营销系统软件许可费（团队）",
    monthlyYuan: 799,
    yearlyYuan: 7990,
    ctaLabel: "开通团队",
    ctaHref: "/writing",
    quotas: {
      seats: 5,
      articles: "unlimited",
      infographics: 100,
      mentions: 120,
      videoSeconds: 240,
    },
    points: ["几个人一起用这条线", "同一篇能出文章和视频", "找媒体发、投广告另算"],
  },
  {
    id: "private",
    name: "企业",
    forWho: "多个团队，各做各的",
    invoiceName: "点物 AI智能内容营销系统软件许可费（企业）",
    monthlyYuan: null,
    yearlyYuan: null,
    fromYuan: 2000,
    ctaLabel: "咨询企业",
    ctaHref: "/writing",
    quotas: {
      seats: "custom",
      articles: "unlimited",
      infographics: "custom",
      mentions: "custom",
      videoSeconds: "custom",
    },
    points: ["团队之间分开", "用量按你们另定", "代发另算"],
  },
];

/** 方案量用完后从余额扣。展示底价=默认模型在当前加价档的售价。 */
export function usageRatesForPaid(paidYuan = 0) {
  return {
    images: { fen: usageFen("images", null, paidYuan), unit: "张", label: "配图" },
    mentions: { fen: usageFen("mentions", null, paidYuan), unit: "次", label: "查排名" },
    videoSeconds: {
      fen: usageFen("videoSeconds", null, paidYuan),
      unit: "秒",
      label: "视频",
    },
  } as const;
}

/** @deprecated 用 usageRatesForPaid */
export function usageRatesForPlan(_planId: LicensePlanId | string = "workbench") {
  return usageRatesForPaid(0);
}

export const USAGE_RATES = usageRatesForPaid(0);

export type MeteredQuotaKind = keyof typeof USAGE_RATES;

export type WalletPack = {
  id: string;
  payYuan: number;
  bonusPct: number;
};

export const WALLET_PACKS: WalletPack[] = [
  { id: "wallet-10", payYuan: 10, bonusPct: 0 },
  { id: "wallet-50", payYuan: 50, bonusPct: 3 },
  { id: "wallet-100", payYuan: 100, bonusPct: 5 },
  { id: "wallet-200", payYuan: 200, bonusPct: 8 },
  { id: "wallet-300", payYuan: 300, bonusPct: 10 },
  { id: "wallet-500", payYuan: 500, bonusPct: 12 },
  { id: "wallet-800", payYuan: 800, bonusPct: 15 },
  { id: "wallet-1000", payYuan: 1000, bonusPct: 18 },
  { id: "wallet-1500", payYuan: 1500, bonusPct: 20 },
  { id: "wallet-2000", payYuan: 2000, bonusPct: 22 },
  { id: "wallet-3000", payYuan: 3000, bonusPct: 24 },
  { id: "wallet-5000", payYuan: 5000, bonusPct: 26 },
  { id: "wallet-8000", payYuan: 8000, bonusPct: 28 },
  { id: "wallet-10000", payYuan: 10000, bonusPct: 30 },
  { id: "wallet-15000", payYuan: 15000, bonusPct: 31 },
  { id: "wallet-20000", payYuan: 20000, bonusPct: 32 },
  { id: "wallet-30000", payYuan: 30000, bonusPct: 33 },
  { id: "wallet-50000", payYuan: 50000, bonusPct: 34 },
  { id: "wallet-80000", payYuan: 80000, bonusPct: 35 },
  { id: "wallet-100000", payYuan: 100000, bonusPct: 36 },
  { id: "wallet-150000", payYuan: 150000, bonusPct: 37 },
  { id: "wallet-200000", payYuan: 200000, bonusPct: 38 },
  { id: "wallet-300000", payYuan: 300000, bonusPct: 39 },
  { id: "wallet-400000", payYuan: 400000, bonusPct: 40 },
  { id: "wallet-500000", payYuan: 500000, bonusPct: 41 },
  { id: "wallet-600000", payYuan: 600000, bonusPct: 42 },
  { id: "wallet-700000", payYuan: 700000, bonusPct: 43 },
  { id: "wallet-800000", payYuan: 800000, bonusPct: 43 },
  { id: "wallet-900000", payYuan: 900000, bonusPct: 44 },
  { id: "wallet-1000000", payYuan: 1000000, bonusPct: 45 },
];

/** 下架档，只核销未完成的旧订单。 */
const LEGACY_WALLET_PACKS: WalletPack[] = [
  { id: "wallet-70000", payYuan: 70000, bonusPct: 39 },
];

export const HOME_WALLET_PACKS = WALLET_PACKS.filter((pack) =>
  [100, 500, 1000, 2000].includes(pack.payYuan),
);

export function getWalletPack(id: string): WalletPack | undefined {
  return (
    WALLET_PACKS.find((pack) => pack.id === id) ??
    LEGACY_WALLET_PACKS.find((pack) => pack.id === id)
  );
}

export function walletCreditFen(pack: WalletPack): number {
  return Math.round((pack.payYuan * 100 * (100 + pack.bonusPct)) / 100);
}

export function walletCreditYuan(pack: WalletPack): number {
  return walletCreditFen(pack) / 100;
}

export function walletZheLabel(bonusPct: number): string | null {
  if (bonusPct <= 0) return null;
  const zhe = Math.round((100 - bonusPct)) / 10;
  const text = Number.isInteger(zhe) ? String(zhe) : zhe.toFixed(1);
  return `${text} 折`;
}

export function isMeteredQuotaKind(kind: string): kind is MeteredQuotaKind {
  return kind === "images" || kind === "mentions" || kind === "videoSeconds";
}

export function walletUnitsFromFen(
  kind: MeteredQuotaKind,
  fen: number,
  paidYuan = 0,
): number {
  const unit = usageFen(kind, null, paidYuan);
  if (unit <= 0) return 0;
  return Math.floor(Math.max(0, fen) / unit);
}

export function walletPackYields(pack: WalletPack): {
  images: number;
  videoSeconds: number;
  mentions: number;
} {
  const fen = walletCreditFen(pack);
  return {
    images: walletUnitsFromFen("images", fen),
    videoSeconds: walletUnitsFromFen("videoSeconds", fen),
    mentions: walletUnitsFromFen("mentions", fen),
  };
}

/** 旧按包充值，仅核销未完成的订单。新充值走 WALLET_PACKS。 */
export const CREDIT_PACKS: CreditPack[] = [
  {
    id: "video-120",
    name: "做视频",
    priceYuan: 99,
    amount: 120,
    unit: "秒",
    note: "方案里的视频用完再充。不用换方案。",
  },
  {
    id: "image-40",
    name: "配图",
    priceYuan: 49,
    amount: 40,
    unit: "张",
    note: "方案里的图用完再充。不用换方案。",
  },
  {
    id: "mention-50",
    name: "查排名",
    priceYuan: 29,
    amount: 50,
    unit: "次",
    note: "方案里的排名次数用完再充。不用换方案。",
  },
];

export const FULFILLMENT_LANES: FulfillmentLane[] = [
  {
    id: "media",
    name: "找媒体发",
    href: "/paid",
    body: "人民网、头条、知乎这些，一篇一个价，发出去后把链接给你。",
  },
  {
    id: "ads",
    name: "投广告",
    href: "/ads",
    body: "百度、Google、抖音、快手。我们收服务费，广告费你付给平台。",
  },
];

export const LICENSE_LAYER_TITLE = "方案";
export const LICENSE_LAYER_LEAD =
  "买的是一条能出结果的流水线，不是接口。年付按 10 个月。";

export const CREDIT_LAYER_TITLE = "充值";
export const CREDIT_LAYER_LEAD =
  "统一充余额。配图、视频、查排名用完套餐后按次扣，充得越多送得越多，最多送 45%。";

export const FULFILL_LAYER_TITLE = "找人发、投广告";
export const FULFILL_LAYER_LEAD =
  "代发按篇算，代投收服务费，广告费付给平台。";

export const BILLING_FOOTNOTE =
  "开通和充值走 Stripe。余额给配图、视频、查排名共用，套餐用完按次扣。充得越多，到账越多，最多送 45%。";

export function getCreditPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((pack) => pack.id === id);
}

export function creditPackAdds(pack: CreditPack): {
  addArticles: number;
  addImages: number;
  addMentions: number;
  addVideoSeconds: number;
} {
  if (pack.id === "image-40") {
    return { addArticles: 0, addImages: pack.amount, addMentions: 0, addVideoSeconds: 0 };
  }
  if (pack.id === "mention-50") {
    return { addArticles: 0, addImages: 0, addMentions: pack.amount, addVideoSeconds: 0 };
  }
  return { addArticles: 0, addImages: 0, addMentions: 0, addVideoSeconds: pack.amount };
}

export function planPriceYuan(
  plan: LicensePlan,
  interval: "monthly" | "yearly",
): number | null {
  if (plan.monthlyYuan == null) return null;
  if (interval === "yearly") return plan.yearlyYuan;
  return plan.monthlyYuan;
}

export function isLicensePlanId(id: string): id is LicensePlanId {
  return LICENSE_PLANS.some((plan) => plan.id === id);
}

export function getLicensePlan(id: string): LicensePlan {
  return LICENSE_PLANS.find((plan) => plan.id === id) ?? LICENSE_PLANS[0];
}
