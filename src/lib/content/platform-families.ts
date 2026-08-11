import type { CorpusCategory, PlatformId } from "@/lib/types";

/** Platform tone families for multi-variant publishing. */
export type PlatformFamily =
  | "tech"
  | "media"
  | "knowledge"
  | "social"
  | "wechat"
  | "cloud"
  | "finance";

export type VariantSource = "generated" | "adapted" | "manual";

export const PLATFORM_FAMILIES: {
  id: PlatformFamily;
  label: string;
  hint: string;
}[] = [
  {
    id: "tech",
    label: "技术长文",
    hint: "CSDN / 掘金 / 博客园等：干货、可复现、少硬广",
  },
  {
    id: "media",
    label: "资讯媒体",
    hint: "头条 / 百家号 / 搜狐号等：信息流标题、价值前置",
  },
  {
    id: "knowledge",
    label: "知识社区",
    hint: "知乎 / 豆瓣 / 简书等：问题意识、论证完整",
  },
  {
    id: "social",
    label: "社媒短内容",
    hint: "微博 / 小红书 / 抖音等：短、钩子、口语",
  },
  {
    id: "wechat",
    label: "公众号",
    hint: "微信公众号：标题克制、段落节奏、品牌感",
  },
  {
    id: "cloud",
    label: "云厂商社区",
    hint: "腾讯云+ / 阿里云 / 华为云：技术实践 + 云场景",
  },
  {
    id: "finance",
    label: "财经社区",
    hint: "雪球 / 东财等：风险提示、不荐股、表述克制",
  },
];

export const ALL_PLATFORM_FAMILIES: PlatformFamily[] = PLATFORM_FAMILIES.map(
  (f) => f.id,
);

const PLATFORM_TO_FAMILY: Record<PlatformId, PlatformFamily> = {
  csdn: "tech",
  juejin: "tech",
  cnblogs: "tech",
  cto51: "tech",
  segmentfault: "tech",
  oschina: "tech",
  imooc: "tech",
  yuque: "tech",

  toutiao: "media",
  baijiahao: "media",
  sohu: "media",
  dayu: "media",
  yidian: "media",
  netease: "media",
  qiehao: "media",
  dafeng: "media",
  kuaichuan: "media",
  sinakandian: "media",
  dongfang: "media",
  btime: "media",
  peoplehao: "media",
  xinhuahao: "media",
  zhongqing: "media",

  zhihu: "knowledge",
  douban: "knowledge",
  jianshu: "knowledge",
  woshipm: "knowledge",
  bilibili: "knowledge",

  weibo: "social",
  xiaohongshu: "social",
  douyin: "social",
  x: "social",
  smzdm: "social",

  weixin: "wechat",

  tencentcloud: "cloud",
  aliyun: "cloud",
  huaweicloud: "cloud",

  xueqiu: "finance",
  eastmoney: "finance",
  sohufocus: "finance",
};

export function platformFamily(platform: PlatformId): PlatformFamily {
  return PLATFORM_TO_FAMILY[platform] ?? "knowledge";
}

export function platformsInFamily(family: PlatformFamily): PlatformId[] {
  return (Object.keys(PLATFORM_TO_FAMILY) as PlatformId[]).filter(
    (id) => PLATFORM_TO_FAMILY[id] === family,
  );
}

export function isPlatformFamily(value: unknown): value is PlatformFamily {
  return (
    typeof value === "string" &&
    ALL_PLATFORM_FAMILIES.includes(value as PlatformFamily)
  );
}

export function defaultFamilyForKind(
  kind: "brand_intro" | "product" | "social" | "article" | "slogan",
): PlatformFamily {
  if (kind === "social") return "social";
  if (kind === "slogan") return "wechat";
  return "tech";
}

/** Preferred corpus categories when adapting for each family. */
export const FAMILY_CORPUS_CATEGORIES: Record<PlatformFamily, CorpusCategory[]> =
  {
    tech: ["product", "style", "brand"],
    media: ["brand", "story", "product"],
    knowledge: ["story", "product", "brand"],
    social: ["brand", "product", "style"],
    wechat: ["brand", "story", "product"],
    cloud: ["product", "style", "brand"],
    finance: ["product", "brand", "other"],
  };

/** Extra terms to boost corpus scoring per family. */
export const FAMILY_CORPUS_BOOST_TERMS: Record<PlatformFamily, string[]> = {
  tech: ["技术", "开发", "API", "教程", "架构", "性能", "代码"],
  media: ["热点", "行业", "趋势", "解读", "资讯"],
  knowledge: ["方法论", "案例", "认知", "原理", "问题"],
  social: ["种草", "体验", "口播", "短句", "钩子"],
  wechat: ["品牌", "故事", "价值观", "用户"],
  cloud: ["云", "部署", "容器", "Serverless", "运维"],
  finance: ["风险", "市场", "投研", "基本面", "合规"],
};

/** Writing / adapt instructions injected into AI prompts. */
export const FAMILY_INSTRUCTIONS: Record<PlatformFamily, string> = {
  tech: `目标调性：技术社区长文（CSDN/掘金/博客园等）。
- 总字数 3000–5000 字；5–8 个小标题；讲清原理、步骤、坑与可复现做法。
- 少硬广与口号；可用产品作案例，但以解决问题为主。
- 可用少量代码/清单；语气专业、克制。`,
  media: `目标调性：资讯/信息流媒体（头条/百家号/搜狐号等）。
- 总字数 2000–4000 字；开篇 3 句内给出核心信息与读者收益。
- 标题信息密度高，避免夸张承诺与标题党（「必火」「躺赚」等）。
- 段落短、小标题清晰；硬广软化，合规表述。`,
  knowledge: `目标调性：知识社区（知乎/豆瓣/简书等）。
- 总字数 2500–4500 字；先抛问题或常见误解，再论证。
- 结构完整：现象 → 原因 → 方法 → 边界；少口号、少鸡汤。
- 可转述的判断优先于堆砌卖点。`,
  social: `目标调性：社媒短内容（微博/小红书/抖音等）。
- 控制在 150–400 字；强钩子开篇；口语、有节奏；可适量 emoji。
- 不要长文结构；最多 1 个行动号召；禁止写成提纲式长文。`,
  wechat: `目标调性：微信公众号图文。
- 总字数 2500–4500 字；标题 ≤ 64 字；段落节奏适合手机阅读。
- 有品牌温度但不空洞；结尾轻 CTA；避免过度营销话术。`,
  cloud: `目标调性：云厂商开发者社区（腾讯云+/阿里云/华为云）。
- 总字数 2500–4500 字；偏技术实践与场景落地。
- 可自然提及云能力，禁止贬低竞品与无依据对比。
- 步骤可跟做；少软文腔。`,
  finance: `目标调性：财经社区（雪球/东财等）。
- 总字数 2000–4000 字；分析克制，必须含风险提示（不构成投资建议）。
- 禁止荐股、收益承诺、「稳赚/必涨」等表述。
- 用逻辑与公开信息框架，不编造数据。`,
};

/** Phrase softeners applied at sync polish (rule-based). */
export const FAMILY_BAN_REPLACEMENTS: Record<
  PlatformFamily,
  Array<{ pattern: RegExp; replace: string }>
> = {
  tech: [
    { pattern: /赋能/g, replace: "帮助" },
    { pattern: /一站式解决一切/g, replace: "覆盖常见场景" },
  ],
  media: [
    { pattern: /躺赚/g, replace: "提高效率" },
    { pattern: /必火/g, replace: "更易传播" },
    { pattern: /100%保证/g, replace: "有助于" },
    { pattern: /稳赚不赔/g, replace: "需结合自身情况评估" },
  ],
  knowledge: [
    { pattern: /赋能/g, replace: "帮助" },
    { pattern: /降维打击/g, replace: "明显优势" },
  ],
  social: [
    { pattern: /稳赚/g, replace: "可能受益" },
    { pattern: /必涨/g, replace: "值得关注" },
  ],
  wechat: [
    { pattern: /赋能/g, replace: "帮助" },
    { pattern: /闭环闭环/g, replace: "闭环" },
  ],
  cloud: [
    { pattern: /吊打竞品/g, replace: "相较常见方案" },
    { pattern: /完胜\w+/g, replace: "在部分场景更合适" },
  ],
  finance: [
    { pattern: /稳赚/g, replace: "存在不确定性" },
    { pattern: /必涨/g, replace: "走势不明" },
    { pattern: /保本/g, replace: "本金可能亏损" },
    { pattern: /内幕消息/g, replace: "公开信息" },
    { pattern: /荐股/g, replace: "讨论标的" },
  ],
};

/** Soft title length caps used by polishForPlatform. */
export const PLATFORM_TITLE_MAX: Partial<Record<PlatformId, number>> = {
  weibo: 32,
  toutiao: 30,
  bilibili: 40,
  weixin: 64,
  xiaohongshu: 20,
  douyin: 20,
  baijiahao: 64,
  jianshu: 80,
  csdn: 100,
  zhihu: 100,
  juejin: 80,
  sohu: 64,
  dayu: 64,
  yidian: 64,
  sohufocus: 64,
  netease: 64,
  smzdm: 60,
  eastmoney: 80,
  x: 100,
  qiehao: 64,
  dafeng: 64,
  kuaichuan: 64,
  sinakandian: 64,
  dongfang: 64,
  btime: 64,
  peoplehao: 64,
  xinhuahao: 64,
  zhongqing: 64,
  tencentcloud: 80,
  aliyun: 100,
  huaweicloud: 64,
  douban: 100,
  cnblogs: 200,
};

export function familyLabel(family: PlatformFamily): string {
  return PLATFORM_FAMILIES.find((f) => f.id === family)?.label ?? family;
}
