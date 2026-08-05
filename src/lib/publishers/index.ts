import { baijiahaoPublisher } from "@/lib/publishers/baijiahao";
import { bilibiliPublisher } from "@/lib/publishers/bilibili";
import { cnblogsPublisher } from "@/lib/publishers/cnblogs";
import { csdnPublisher } from "@/lib/publishers/csdn";
import { cto51Publisher } from "@/lib/publishers/cto51";
import { dayuPublisher } from "@/lib/publishers/dayu";
import { doubanPublisher } from "@/lib/publishers/douban";
import { douyinPublisher } from "@/lib/publishers/douyin";
import { eastmoneyPublisher } from "@/lib/publishers/eastmoney";
import { imoocPublisher } from "@/lib/publishers/imooc";
import { jianshuPublisher } from "@/lib/publishers/jianshu";
import { juejinPublisher } from "@/lib/publishers/juejin";
import { neteasePublisher } from "@/lib/publishers/netease";
import { oschinaPublisher } from "@/lib/publishers/oschina";
import { segmentfaultPublisher } from "@/lib/publishers/segmentfault";
import { smzdmPublisher } from "@/lib/publishers/smzdm";
import { sohuPublisher } from "@/lib/publishers/sohu";
import { sohufocusPublisher } from "@/lib/publishers/sohufocus";
import { toutiaoPublisher } from "@/lib/publishers/toutiao";
import { weiboPublisher } from "@/lib/publishers/weibo";
import { weixinPublisher } from "@/lib/publishers/weixin";
import { woshipmPublisher } from "@/lib/publishers/woshipm";
import { xPublisher } from "@/lib/publishers/x";
import { xiaohongshuPublisher } from "@/lib/publishers/xiaohongshu";
import { xueqiuPublisher } from "@/lib/publishers/xueqiu";
import { yidianPublisher } from "@/lib/publishers/yidian";
import { yuquePublisher } from "@/lib/publishers/yuque";
import { zhihuPublisher } from "@/lib/publishers/zhihu";
import type { PlatformPublisher } from "@/lib/publishers/types";
import type { PlatformId } from "@/lib/types";

const registry: Record<PlatformId, PlatformPublisher> = {
  zhihu: zhihuPublisher,
  weibo: weiboPublisher,
  baijiahao: baijiahaoPublisher,
  jianshu: jianshuPublisher,
  csdn: csdnPublisher,
  toutiao: toutiaoPublisher,
  juejin: juejinPublisher,
  weixin: weixinPublisher,
  bilibili: bilibiliPublisher,
  douban: doubanPublisher,
  sohu: sohuPublisher,
  dayu: dayuPublisher,
  yidian: yidianPublisher,
  cnblogs: cnblogsPublisher,
  cto51: cto51Publisher,
  segmentfault: segmentfaultPublisher,
  imooc: imoocPublisher,
  oschina: oschinaPublisher,
  yuque: yuquePublisher,
  woshipm: woshipmPublisher,
  xueqiu: xueqiuPublisher,
  sohufocus: sohufocusPublisher,
  xiaohongshu: xiaohongshuPublisher,
  douyin: douyinPublisher,
  netease: neteasePublisher,
  smzdm: smzdmPublisher,
  eastmoney: eastmoneyPublisher,
  x: xPublisher,
};

export function getPublisher(platform: PlatformId): PlatformPublisher {
  const pub = registry[platform];
  if (!pub) throw new Error(`未知平台: ${platform}`);
  return pub;
}

export function listPublishers(): PlatformPublisher[] {
  return Object.values(registry);
}
