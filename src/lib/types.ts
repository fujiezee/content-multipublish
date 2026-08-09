export type PlatformId =
  | "zhihu"
  | "weibo"
  | "baijiahao"
  | "jianshu"
  | "csdn"
  | "toutiao"
  | "juejin"
  | "weixin"
  | "bilibili"
  | "douban"
  | "sohu"
  | "dayu"
  | "yidian"
  | "cnblogs"
  | "cto51"
  | "segmentfault"
  | "imooc"
  | "oschina"
  | "yuque"
  | "woshipm"
  | "xueqiu"
  | "sohufocus"
  | "xiaohongshu"
  | "douyin"
  | "netease"
  | "smzdm"
  | "eastmoney"
  | "x";

export type SessionStatus = "connected" | "disconnected" | "expired";

export type JobStatus = "pending" | "running" | "success" | "failed";

/** extension = Chrome draft API; api = Node draft HTTP; playwright = local browser automation */
export type PublishEngine = "extension" | "playwright" | "api";

export function normalizePublishEngine(value: unknown): PublishEngine {
  if (value === "extension" || value === "api") return value;
  return "playwright";
}

export interface Article {
  id: string;
  title: string;
  body: string;
  summary: string;
  cover_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformSession {
  platform: PlatformId;
  storage_path: string;
  display_name: string | null;
  connected_at: string | null;
  last_checked_at: string | null;
  status: SessionStatus;
}

export interface PublishJob {
  id: string;
  article_id: string;
  platform: PlatformId;
  status: JobStatus;
  result_url: string | null;
  error: string | null;
  screenshot_path: string | null;
  engine: PublishEngine;
  created_at: string;
  updated_at: string;
}

export interface PublishContent {
  title: string;
  bodyMarkdown: string;
  bodyHtml: string;
  bodyText: string;
  summary: string;
  coverPath: string | null;
}

export interface PublishResult {
  success: boolean;
  url?: string;
  error?: string;
  screenshotPath?: string;
  /** Keep browser window open (e.g. for manual confirm). */
  keepOpen?: boolean;
}

/** 语料库条目分类 */
export type CorpusCategory = "brand" | "story" | "product" | "style" | "other";

export interface CorpusItem {
  id: string;
  title: string;
  category: CorpusCategory;
  tags: string;
  content: string;
  created_at: string;
  updated_at: string;
}

/** AI 文案类型 */
export type CopywritingKind =
  | "brand_intro"
  | "product"
  | "social"
  | "article"
  | "slogan";

export const CORPUS_CATEGORIES: {
  id: CorpusCategory;
  label: string;
  hint: string;
}[] = [
  { id: "brand", label: "品牌", hint: "定位、价值观、Slogan、品牌故事" },
  { id: "story", label: "故事", hint: "个人经历、客户案例、创业复盘" },
  { id: "product", label: "产品", hint: "功能、卖点、参数、使用场景" },
  { id: "style", label: "风格", hint: "范文、语气参考、禁用词" },
  { id: "other", label: "其他", hint: "任意可引用素材" },
];

export const COPYWRITING_KINDS: {
  id: CopywritingKind;
  label: string;
  hint: string;
}[] = [
  { id: "brand_intro", label: "品牌介绍", hint: "官网 About、一句话介绍" },
  { id: "product", label: "产品文案", hint: "卖点、功能说明、落地页" },
  { id: "social", label: "社媒短帖", hint: "微博、小红书、朋友圈" },
  { id: "article", label: "长文初稿", hint: "公众号、专栏文章大纲+正文" },
  { id: "slogan", label: "标语口号", hint: "多条 Slogan 备选" },
];

/** GEO 挖词：搜索意图分类 */
export type GeoKeywordIntent =
  | "informational"
  | "howto"
  | "comparison"
  | "commercial"
  | "local"
  | "question";

export interface GeoKeywordMine {
  id: string;
  seed: string;
  context: string;
  created_at: string;
  updated_at: string;
}

export interface GeoKeyword {
  id: string;
  mine_id: string;
  keyword: string;
  title: string;
  intent: GeoKeywordIntent;
  angle: string;
  norm_key: string;
  /** @deprecated use geo_keyword_articles */
  article_id: string | null;
  created_at: string;
}

/** AI 写文与长尾词的关联记录（同一长尾词可有多篇） */
export interface GeoKeywordArticle {
  id: string;
  keyword_id: string;
  article_id: string;
  brief: string;
  created_at: string;
}

export type GeoKeywordArticleWithTitle = GeoKeywordArticle & {
  article_title: string;
};

export const GEO_KEYWORD_INTENTS: {
  id: GeoKeywordIntent;
  label: string;
}[] = [
  { id: "informational", label: "科普/认知" },
  { id: "howto", label: "教程/方法" },
  { id: "comparison", label: "对比/评测" },
  { id: "commercial", label: "选购/方案" },
  { id: "local", label: "场景/人群" },
  { id: "question", label: "问答/解惑" },
];

export const PLATFORMS: {
  id: PlatformId;
  name: string;
  description: string;
  limits: string;
}[] = [
  {
    id: "zhihu",
    name: "知乎",
    description: "知乎专栏文章",
    limits: "建议标题 ≤ 100 字，正文支持富文本",
  },
  {
    id: "weibo",
    name: "微博",
    description: "微博头条文章",
    limits: "标题建议 ≤ 32 字，正文以富文本填入",
  },
  {
    id: "baijiahao",
    name: "百家号",
    description: "百度百家号图文",
    limits: "标题 2–64 字，正文建议 ≥ 300 字",
  },
  {
    id: "jianshu",
    name: "简书",
    description: "简书专栏文章",
    limits: "标题建议 ≤ 80 字，正文按富文本填入",
  },
  {
    id: "csdn",
    name: "CSDN",
    description: "CSDN 博客文章",
    limits: "标题建议 ≤ 100 字，正文按富文本填入；发布时可能需补标签/扫码",
  },
  {
    id: "toutiao",
    name: "头条号",
    description: "今日头条图文",
    limits: "标题 2–30 字，正文按富文本填入；发布前通常需封面",
  },
  {
    id: "juejin",
    name: "掘金",
    description: "稀土掘金技术文章",
    limits: "标题建议 ≤ 80 字，正文 Markdown；需选分类/标签",
  },
  {
    id: "weixin",
    name: "微信公众号",
    description: "公众号图文（优先存草稿）",
    limits: "标题建议 ≤ 64 字；自动写入正文并用后台 AI配图设封面后存草稿",
  },
  {
    id: "bilibili",
    name: "B站专栏",
    description: "哔哩哔哩专栏文章",
    limits: "标题建议 ≤ 40 字，正文富文本",
  },
  {
    id: "douban",
    name: "豆瓣",
    description: "豆瓣日记",
    limits: "标题建议 ≤ 100 字",
  },
  {
    id: "sohu",
    name: "搜狐号",
    description: "搜狐号图文",
    limits: "标题建议 ≤ 64 字",
  },
  {
    id: "dayu",
    name: "大鱼号",
    description: "UC 大鱼号图文",
    limits: "标题建议 ≤ 64 字",
  },
  {
    id: "yidian",
    name: "一点号",
    description: "一点资讯图文",
    limits: "标题建议 ≤ 64 字",
  },
  {
    id: "cnblogs",
    name: "博客园",
    description: "博客园博文",
    limits: "标题建议 ≤ 200 字，正文 Markdown/HTML",
  },
  {
    id: "cto51",
    name: "51CTO",
    description: "51CTO 博客",
    limits: "标题建议 ≤ 100 字",
  },
  {
    id: "segmentfault",
    name: "思否",
    description: "SegmentFault 文章",
    limits: "标题建议 ≤ 100 字，正文 Markdown",
  },
  {
    id: "imooc",
    name: "慕课手记",
    description: "慕课网手记",
    limits: "标题建议 ≤ 80 字",
  },
  {
    id: "oschina",
    name: "开源中国",
    description: "OSChina 博客",
    limits: "标题建议 ≤ 100 字",
  },
  {
    id: "yuque",
    name: "语雀",
    description: "语雀文档",
    limits: "标题建议 ≤ 100 字；需已有知识库",
  },
  {
    id: "woshipm",
    name: "人人都是产品经理",
    description: "产品经理社区投稿",
    limits: "标题建议 ≤ 100 字",
  },
  {
    id: "xueqiu",
    name: "雪球",
    description: "雪球长文",
    limits: "标题建议 ≤ 80 字",
  },
  {
    id: "sohufocus",
    name: "搜狐焦点",
    description: "搜狐焦点房产号",
    limits: "标题建议 ≤ 64 字",
  },
  {
    id: "xiaohongshu",
    name: "小红书",
    description: "小红书长文/图文笔记",
    limits: "标题 ≤ 20 字；常需封面图，失败时窗口留给人工确认",
  },
  {
    id: "douyin",
    name: "抖音图文",
    description: "抖音创作者中心图文",
    limits: "标题 ≤ 20 字，描述 ≤ 1000 字；通常需上传图片",
  },
  {
    id: "netease",
    name: "网易号",
    description: "网易号图文",
    limits: "标题建议 ≤ 64 字",
  },
  {
    id: "smzdm",
    name: "什么值得买",
    description: "什么值得买投稿",
    limits: "标题建议 ≤ 60 字；投稿常需商品卡/图片",
  },
  {
    id: "eastmoney",
    name: "东方财富",
    description: "东方财富股吧长文",
    limits: "标题建议 ≤ 80 字",
  },
  {
    id: "x",
    name: "X",
    description: "X (Twitter) 长文/帖子",
    limits: "长文标题建议 ≤ 100 字；需已开通 Articles 或退回普通发帖",
  },
];

/** All platform ids in registry order. */
export const ALL_PLATFORM_IDS: PlatformId[] = PLATFORMS.map((p) => p.id);
