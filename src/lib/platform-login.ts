import type { PlatformId } from "@/lib/types";

/** Chrome / extension login pages (not Playwright). Keep in sync with publisher loginUrl. */
export const PLATFORM_LOGIN_URLS: Record<PlatformId, string> = {
  zhihu: "https://www.zhihu.com/signin",
  weibo: "https://weibo.com/login.php",
  baijiahao: "https://baijiahao.baidu.com/",
  jianshu: "https://www.jianshu.com/sign_in",
  csdn: "https://passport.csdn.net/login",
  toutiao: "https://mp.toutiao.com/auth/page/login",
  juejin: "https://juejin.cn/login",
  weixin: "https://mp.weixin.qq.com/",
  bilibili: "https://passport.bilibili.com/login",
  douban: "https://accounts.douban.com/passport/login",
  sohu: "https://mp.sohu.com/mpfe/v3/login",
  dayu: "https://mp.dayu.com/",
  yidian: "https://mp.yidianzixun.com/",
  cnblogs: "https://account.cnblogs.com/signin",
  cto51: "https://home.51cto.com/index",
  segmentfault: "https://segmentfault.com/user/login",
  imooc: "https://www.imooc.com/user/newlogin",
  oschina: "https://www.oschina.net/home/login",
  yuque: "https://www.yuque.com/login",
  woshipm: "https://www.woshipm.com/login",
  xueqiu: "https://xueqiu.com/",
  sohufocus: "https://login.focus.cn/?ru=https%3A%2F%2Fhouse.focus.cn%2F",
  xiaohongshu: "https://creator.xiaohongshu.com/login",
  shunqi: "https://cp.11467.com/home/login/index",
  shunqi_product: "https://cp.11467.com/home/login/index",
  bafang: "https://m.b2b168.com/Index.aspx?pg=login",
  douyin: "https://creator.douyin.com/",
  netease: "https://mp.163.com/login.html",
  smzdm: "https://www.smzdm.com/user/login",
  eastmoney: "https://passport2.eastmoney.com/pub/login",
  x: "https://x.com/i/flow/login",
  // Creator home, not /userAuth/index — the scan page kicks an existing om session.
  qiehao: "https://om.qq.com/article/articlePublish",
  dafeng: "https://mp.ifeng.com/login",
  kuaichuan: "https://kuaichuan.360kuai.com/",
  sinakandian: "https://mp.sina.com.cn/",
  dongfang: "https://mp.eastday.com/",
  btime: "https://mp.btime.com/",
  peoplehao: "https://pdcreator.pdnews.cn/login",
  xinhuahao: "https://xhh.app.xinhuanet.com/",
  zhongqing: "https://mp.cyol.com/",
  tencentcloud: "https://cloud.tencent.com/login",
  aliyun: "https://developer.aliyun.com/article/new",
  huaweicloud:
    "https://auth.huaweicloud.com/authui/login?service=https%3A%2F%2Fbbs.huaweicloud.com%2Fblogs%2Farticle",
  dianwu: "https://dianwu.ai/directory",
};

export function platformLoginUrl(platform: PlatformId): string {
  return PLATFORM_LOGIN_URLS[platform] || "";
}

/** Copy after window.open(platformLoginUrl). 企鹅号 must not send people to 扫码页. */
export function platformLoginActionCopy(
  platform: PlatformId,
  name: string,
): { opened: string; notDetected: string; linkTitle: string } {
  if (platform === "qiehao") {
    return {
      opened:
        "已打开企鹅号创作后台。请停在后台页，不要去扫码登录（扫码页会把已登录会话踢掉）。确认后台打开后再点一次「刷新登录」",
      notDetected:
        "尚未从扩展检测到企鹅号登录。请停在已打开的创作后台，不要去扫码页，再点「刷新登录」",
      linkTitle: "打开企鹅号创作后台",
    };
  }
  return {
    opened: `已打开 ${name} 登录页。登录完成后请再点一次「刷新登录」，确认后再重试`,
    notDetected: `${name} 尚未检测到登录。请先在打开的标签页登录，再点「刷新登录」`,
    linkTitle: "打开平台登录页",
  };
}
