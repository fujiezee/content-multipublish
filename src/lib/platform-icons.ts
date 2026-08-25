import type { PlatformId } from "@/lib/types";

export type PlatformIconMeta = {
  /** Direct favicon / logo URL (prefer China-reachable CDN) */
  icon: string;
  /** Fallback brand color when image fails */
  color: string;
  /** 1–2 char label on color badge */
  mark: string;
};

/**
 * Prefer each platform's own CDN icon — Google favicon proxy is blocked in CN.
 */
export const PLATFORM_ICONS: Record<PlatformId, PlatformIconMeta> = {
  zhihu: {
    icon: "https://static.zhihu.com/heifetz/favicon.ico",
    color: "#0066ff",
    mark: "知",
  },
  weibo: {
    icon: "https://weibo.com/favicon.ico",
    color: "#e6162d",
    mark: "微",
  },
  baijiahao: {
    icon: "https://baijiahao.baidu.com/favicon.ico",
    color: "#2932e1",
    mark: "百",
  },
  jianshu: {
    icon: "https://cdn2.jianshu.com/favicon.ico",
    color: "#ea6f5a",
    mark: "简",
  },
  csdn: {
    icon: "https://g.csdnimg.cn/static/logo/favicon32.ico",
    color: "#fc5531",
    mark: "C",
  },
  toutiao: {
    icon: "https://sf1-cdn-tos.toutiaostatic.com/obj/ttfe/pgcfe/sz/mp_logo.png",
    color: "#f04142",
    mark: "头",
  },
  juejin: {
    icon: "https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/favicon-32x32.png",
    color: "#1e80ff",
    mark: "掘",
  },
  weixin: {
    icon: "https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico",
    color: "#07c160",
    mark: "微",
  },
  bilibili: {
    icon: "https://www.bilibili.com/favicon.ico",
    color: "#fb7299",
    mark: "B",
  },
  douban: {
    icon: "https://img3.doubanio.com/favicon.ico",
    color: "#00b51d",
    mark: "豆",
  },
  sohu: {
    icon: "https://statics.itc.cn/web/static/images/pic/sohu-logo/favicon.ico",
    color: "#ffd700",
    mark: "搜",
  },
  dayu: {
    icon: "https://mp.dayu.com/favicon.ico",
    color: "#ff6600",
    mark: "鱼",
  },
  yidian: {
    icon: "https://www.yidianzixun.com/favicon.ico",
    color: "#e60012",
    mark: "一",
  },
  cnblogs: {
    icon: "https://www.cnblogs.com/favicon.ico",
    color: "#2b579a",
    mark: "园",
  },
  cto51: {
    icon: "https://blog.51cto.com/favicon.ico",
    color: "#ff6600",
    mark: "51",
  },
  segmentfault: {
    icon: "https://segmentfault.com/favicon.ico",
    color: "#009a61",
    mark: "SF",
  },
  imooc: {
    icon: "https://www.imooc.com/favicon.ico",
    color: "#f01414",
    mark: "慕",
  },
  oschina: {
    icon: "https://www.oschina.net/favicon.ico",
    color: "#21b351",
    mark: "开",
  },
  yuque: {
    icon: "https://mdn.alipayobjects.com/huamei_0prmtq/afts/img/A*vMqYSoYAS5EAAAAAAAAAAAAADvuFAQ/original",
    color: "#36b37e",
    mark: "语",
  },
  woshipm: {
    icon: "https://www.woshipm.com/favicon.ico",
    color: "#1a73e8",
    mark: "产",
  },
  xueqiu: {
    icon: "https://xqimg.imedao.com/1775aab854f24af3fe6a6b36.png",
    color: "#3b7cff",
    mark: "雪",
  },
  sohufocus: {
    icon: "https://house.focus.cn/favicon.ico",
    color: "#ffd100",
    mark: "焦",
  },
  xiaohongshu: {
    icon: "https://www.xiaohongshu.com/favicon.ico",
    color: "#ff2442",
    mark: "红",
  },
  shunqi: {
    icon: "https://www.11467.com/favicon.ico",
    color: "#c62828",
    mark: "顺",
  },
  shunqi_product: {
    icon: "https://www.11467.com/favicon.ico",
    color: "#b71c1c",
    mark: "产",
  },
  bafang: {
    icon: "https://www.b2b168.com/favicon.ico",
    color: "#e65100",
    mark: "八",
  },
  douyin: {
    icon: "https://lf1-cdn-tos.bytegoofy.com/goofy/ies/douyin_web/public/favicon.ico",
    color: "#111111",
    mark: "抖",
  },
  netease: {
    icon: "https://static.ws.126.net/163/f2e/product/post_cms/favicon.ico",
    color: "#c20c0c",
    mark: "易",
  },
  smzdm: {
    icon: "https://res.smzdm.com/resources/public/img/web_v3/favicon.ico",
    color: "#e02020",
    mark: "值",
  },
  eastmoney: {
    icon: "https://guba.eastmoney.com/favicon.ico",
    color: "#d40000",
    mark: "财",
  },
  x: {
    icon: "https://abs.twimg.com/favicons/twitter.3.ico",
    color: "#000000",
    mark: "X",
  },
  qiehao: {
    icon: "https://om.gtimg.cn/om/om_2.0/images/favicon_om.ico",
    color: "#12b7f5",
    mark: "企",
  },
  dafeng: {
    icon: "https://www.ifeng.com/favicon.ico",
    color: "#e60012",
    mark: "风",
  },
  kuaichuan: {
    icon: "https://kuaichuan.360kuai.com/favicon.ico",
    color: "#00b365",
    mark: "快",
  },
  sinakandian: {
    icon: "https://www.sina.com.cn/favicon.ico",
    color: "#ff8200",
    mark: "浪",
  },
  dongfang: {
    icon: "https://www.eastday.com/favicon.ico",
    color: "#e60012",
    mark: "东",
  },
  btime: {
    icon: "https://www.btime.com/favicon.ico",
    color: "#1a5cff",
    mark: "时",
  },
  peoplehao: {
    icon: "https://www.people.com.cn/favicon.ico",
    color: "#c40000",
    mark: "人",
  },
  xinhuahao: {
    icon: "https://www.xinhuanet.com/favicon.ico",
    color: "#c41230",
    mark: "华",
  },
  zhongqing: {
    icon: "https://www.cyol.com/favicon.ico",
    color: "#0b5cad",
    mark: "青",
  },
  tencentcloud: {
    icon: "https://cloud.tencent.com/favicon.ico",
    color: "#0052d9",
    mark: "腾",
  },
  aliyun: {
    icon: "https://developer.aliyun.com/favicon.ico",
    color: "#ff6a00",
    mark: "阿",
  },
  huaweicloud: {
    icon: "https://bbs.huaweicloud.com/favicon.ico",
    color: "#cf0a2c",
    mark: "华",
  },
  dianwu: {
    icon: "https://dianwu.ai/favicon.ico",
    color: "#e8c56a",
    mark: "点",
  },
};

export function platformFaviconUrl(id: PlatformId) {
  return PLATFORM_ICONS[id].icon;
}
