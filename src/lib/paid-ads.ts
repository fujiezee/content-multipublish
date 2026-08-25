export type PaidAdCategory = "search" | "feed" | "short" | "social";

export const PAID_AD_CATEGORIES: { id: PaidAdCategory; label: string }[] = [
  { id: "search", label: "搜索" },
  { id: "feed", label: "信息流" },
  { id: "short", label: "短视频" },
  { id: "social", label: "社交" },
];

export type PaidAdSku = {
  id: string;
  name: string;
  site: string;
  href: string;
  category: PaidAdCategory;
  /** 点物代投服务费（每月，标价） */
  serviceYuan: number;
  /** 建议给平台的日消耗，能跑起来的门槛 */
  dailyYuan: number;
  /** 平台侧常见首充 / 预存 */
  rechargeYuan: number;
  days: number;
  cpcHint: string;
  note: string;
};

export const PAID_AD_SKUS: PaidAdSku[] = [
  {
    id: "baidu-search",
    name: "百度搜索",
    site: "百度推广",
    href: "https://e.baidu.com",
    category: "search",
    serviceYuan: 1200,
    dailyYuan: 200,
    rechargeYuan: 5000,
    days: 2,
    cpcHint: "普通行业约 ¥1–8 / 次",
    note: "搜品牌、搜品类的人。医疗教育金融会贵很多。",
  },
  {
    id: "baidu-feed",
    name: "百度信息流",
    site: "百度营销",
    href: "https://e.baidu.com",
    category: "feed",
    serviceYuan: 1000,
    dailyYuan: 200,
    rechargeYuan: 3000,
    days: 2,
    cpcHint: "约 ¥0.3–2 / 次",
    note: "手百、贴吧、好看视频里刷到。适合线索和品牌。",
  },
  {
    id: "google-search",
    name: "Google 搜索",
    site: "Google Ads",
    href: "https://ads.google.com",
    category: "search",
    serviceYuan: 1500,
    dailyYuan: 150,
    rechargeYuan: 1000,
    days: 3,
    cpcHint: "视行业约 ¥2–20 / 次",
    note: "出海、英文站、外贸询盘。落地页要能打开。",
  },
  {
    id: "google-display",
    name: "Google 展示",
    site: "Google Ads",
    href: "https://ads.google.com",
    category: "feed",
    serviceYuan: 1200,
    dailyYuan: 100,
    rechargeYuan: 1000,
    days: 3,
    cpcHint: "展示便宜，转化看素材",
    note: "网站联盟和 YouTube 周边曝光。适合铺量。",
  },
  {
    id: "douyin",
    name: "抖音",
    site: "巨量引擎",
    href: "https://www.oceanengine.com",
    category: "short",
    serviceYuan: 1500,
    dailyYuan: 300,
    rechargeYuan: 3000,
    days: 2,
    cpcHint: "计划日预算常见 ¥300 起",
    note: "短视频和直播信息流。素材要竖屏，冷启动别低于日预算。",
  },
  {
    id: "kuaishou",
    name: "快手",
    site: "磁力引擎",
    href: "https://ad.e.kuaishou.com",
    category: "short",
    serviceYuan: 1200,
    dailyYuan: 200,
    rechargeYuan: 1000,
    days: 2,
    cpcHint: "商品推广常见 ¥100 / 日起",
    note: "下沉市场和直播间。比抖音便宜一档，转化看品。",
  },
  {
    id: "xiaohongshu",
    name: "小红书",
    site: "聚光",
    href: "https://ad.xiaohongshu.com",
    category: "social",
    serviceYuan: 1500,
    dailyYuan: 200,
    rechargeYuan: 1000,
    days: 2,
    cpcHint: "信息流 + 搜索，约 ¥0.5–3 / 次",
    note: "种草和搜词。有笔记再加热，比纯冷启便宜。",
  },
  {
    id: "tencent",
    name: "腾讯广告",
    site: "朋友圈 / 视频号",
    href: "https://ad.qq.com",
    category: "social",
    serviceYuan: 1300,
    dailyYuan: 200,
    rechargeYuan: 1000,
    days: 3,
    cpcHint: "朋友圈按曝光，视频号按播放",
    note: "微信里看到。适合本地和品牌，审核比信息流慢。",
  },
  {
    id: "bilibili",
    name: "B站",
    site: "B站效果推广",
    href: "https://e.bilibili.com",
    category: "short",
    serviceYuan: 1000,
    dailyYuan: 150,
    rechargeYuan: 1000,
    days: 2,
    cpcHint: "约 ¥0.3–2 / 次",
    note: "年轻和兴趣圈层。科技、游戏、知识稿合适。",
  },
  {
    id: "weibo",
    name: "微博",
    site: "粉丝通",
    href: "https://e.weibo.com",
    category: "social",
    serviceYuan: 800,
    dailyYuan: 150,
    rechargeYuan: 1000,
    days: 1,
    cpcHint: "约 ¥0.3–1.5 / 次",
    note: "话题和热搜周边。适合事件和品牌声量。",
  },
];

const SKU_MAP = new Map(PAID_AD_SKUS.map((sku) => [sku.id, sku]));

export function getPaidAdSku(id: string): PaidAdSku | undefined {
  return SKU_MAP.get(id);
}

export function formatYuan(value: number): string {
  return `¥${value}`;
}

export type PaidAdOrderStatus =
  | "pending"
  | "accepted"
  | "published"
  | "failed"
  | "cancelled";

export type PaidAdOrderItem = {
  id: string;
  order_id: string;
  sku_id: string;
  sku_name: string;
  price_yuan: number;
  status: PaidAdOrderStatus;
};

export type PaidAdOrder = {
  id: string;
  workspace_id: string;
  article_id: string;
  article_title: string;
  landing_url: string;
  status: PaidAdOrderStatus;
  total_yuan: number;
  note: string;
  created_at: string;
  updated_at: string;
  items: PaidAdOrderItem[];
};
