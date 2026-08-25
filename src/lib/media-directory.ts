import { PLATFORM_ICONS } from "@/lib/platform-icons";
import { PLATFORMS, type PlatformId } from "@/lib/types";

export type MediaNavCategoryId =
  | "yellow_pages"
  | "media_hao"
  | "news"
  | "baike"
  | "knowledge"
  | "tech"
  | "social"
  | "video"
  | "audio"
  | "local"
  | "ecommerce"
  | "jobs"
  | "property"
  | "auto"
  | "wechat"
  | "cloud"
  | "finance"
  | "global"
  | "llm";

export type MediaNavEntry = {
  id: string;
  name: string;
  href: string;
  note: string;
  /** Set when this site is already a publish target in 点物GEO. */
  platformId?: PlatformId;
  favicon: string;
  mark: string;
  color: string;
};

export type MediaNavCategory = {
  id: MediaNavCategoryId;
  label: string;
  hint: string;
  entries: MediaNavEntry[];
};

function supported(id: PlatformId, href: string, note?: string): MediaNavEntry {
  const meta = PLATFORMS.find((p) => p.id === id);
  const icon = PLATFORM_ICONS[id];
  return {
    id,
    name: meta?.name || id,
    href,
    note: note || meta?.description || "",
    platformId: id,
    favicon: icon.icon,
    mark: icon.mark,
    color: icon.color,
  };
}

function link(
  id: string,
  name: string,
  href: string,
  note: string,
  mark: string,
  color: string,
): MediaNavEntry {
  let host = "example.com";
  try {
    host = new URL(href).hostname;
  } catch {
    // keep fallback
  }
  return {
    id,
    name,
    href,
    note,
    favicon: `https://${host}/favicon.ico`,
    mark,
    color,
  };
}

export const MEDIA_NAV_CATEGORIES: MediaNavCategory[] = [
  {
    id: "yellow_pages",
    label: "企业黄页",
    hint: "B2B、供求、企业名录。已支持分发的可直接去后台发；其余只是打开网站。",
    entries: [
      supported("shunqi", "https://www.11467.com", "顺企网企业新闻"),
      supported("shunqi_product", "https://www.11467.com", "顺企网添加产品"),
      supported("bafang", "https://www.b2b168.com", "八方资源网发布产品"),
      link("huangye88", "黄页88", "https://www.huangye88.com", "企业黄页与供求", "黄", "#c62828"),
      link("hc360", "慧聪网", "https://www.hc360.com", "行业 B2B 供求", "慧", "#e65100"),
      link("makepolo", "马可波罗网", "https://www.makepolo.com", "采购与供应商名录", "马", "#1565c0"),
      link("gongchang", "世界工厂网", "https://www.gongchang.com", "制造业供求黄页", "工", "#2e7d32"),
      link("qjy168", "勤加缘网", "https://www.qjy168.com", "中小企业黄页", "勤", "#6a1b9a"),
      link("1688", "阿里巴巴1688", "https://www.1688.com", "国内批发采购", "阿", "#ff6a00"),
      link("madeinchina", "中国制造网", "https://cn.made-in-china.com", "出口供应商名录", "制", "#c62828"),
      link("chinacn", "中国供应商", "https://cn.china.cn", "企业与产品黄页", "供", "#0d47a1"),
      link("aicaigou", "百度爱采购", "https://b2b.baidu.com", "百度 B2B 采购", "爱", "#2932e1"),
      link("jqw", "金泉网", "https://www.jqw.com", "企业供求信息", "金", "#ef6c00"),
      link("atobo", "阿土伯", "https://www.atobo.com.cn", "企业名录黄页", "土", "#00695c"),
      link("sooshong", "搜好货", "https://www.sooshong.com", "产品与企业检索", "搜", "#0277bd"),
      link("ebdoor", "一比多", "https://www.ebdoor.com", "行业门户黄页", "一", "#ad1457"),
      link("nowec", "环球经贸网", "https://www.nowec.com", "外贸与内贸供求", "环", "#283593"),
      link("by518", "百业网", "https://www.by518.com", "地方企业黄页", "百", "#5d4037"),
      link("food21", "食品商务网", "https://www.21food.cn", "食品行业黄页", "食", "#c62828"),
      link("chemnet", "化工网", "https://china.chemnet.com", "化工行业黄页", "化", "#00695c"),
      link("toocle", "生意宝", "https://china.toocle.com", "网盛生意宝 B2B", "生", "#1565c0"),
      link("bmlink", "中国建材网", "https://www.bmlink.com", "建材行业黄页", "材", "#5d4037"),
      link("gongkong", "中国工控网", "https://www.gongkong.com", "工业自动化门户", "控", "#1565c0"),
      link("guidechem", "盖德化工网", "https://www.guidechem.com", "化工产品与供应商", "盖", "#00695c"),
      link("elecfans", "电子发烧友", "https://www.elecfans.com", "电子行业社区与黄页", "电", "#0277bd"),
      link("ef360", "中国服装网", "https://www.ef360.com", "服装行业门户", "服", "#ad1457"),
      link("alibaba", "阿里巴巴国际站", "https://www.alibaba.com", "跨境 B2B 供应", "阿", "#ff6a00"),
      link("qcc", "企查查", "https://www.qcc.com", "企业工商信息检索", "企", "#1565c0"),
      link("tianyancha", "天眼查", "https://www.tianyancha.com", "企业信息与舆情", "天", "#0d47a1"),
      link("aiqicha", "爱企查", "https://aiqicha.baidu.com", "百度企业查询", "爱", "#2932e1"),
      link("58", "58同城", "https://www.58.com", "分类信息与商家", "58", "#ff552e"),
      link("ganji", "赶集网", "https://www.ganji.com", "分类信息", "赶", "#00aa00"),
    ],
  },
  {
    id: "media_hao",
    label: "媒体号",
    hint: "信息流创作者后台。点开官网或入驻页；带「可分发」的已在工作台接入。",
    entries: [
      supported("toutiao", "https://www.toutiao.com"),
      supported("baijiahao", "https://baijiahao.baidu.com"),
      supported("sohu", "https://www.sohu.com"),
      supported("dayu", "https://mp.dayu.com"),
      supported("qiehao", "https://om.qq.com"),
      supported("netease", "https://www.163.com"),
      supported("yidian", "https://www.yidianzixun.com"),
      supported("dafeng", "https://www.ifeng.com"),
      supported("kuaichuan", "https://www.360kuai.com"),
      supported("dongfang", "https://www.eastday.com"),
      supported("btime", "https://www.btime.com"),
      supported("sinakandian", "https://news.sina.com.cn"),
      supported("peoplehao", "https://www.people.com.cn"),
      supported("xinhuahao", "https://www.xinhuanet.com"),
      supported("zhongqing", "https://www.cyol.com"),
      link("meipian", "美篇", "https://www.meipian.cn", "图文创作与传播", "美", "#e91e63"),
      link("qutoutiao", "趣头条", "https://www.qutoutiao.net", "下沉市场信息流", "趣", "#ff6f00"),
      link("thepaper-hao", "澎湃号", "https://www.thepaper.cn", "澎湃新闻入驻号", "湃", "#1a237e"),
      link("guancha-hao", "观察者号", "https://www.guancha.cn", "观察者网投稿/入驻", "观", "#b71c1c"),
    ],
  },
  {
    id: "news",
    label: "新闻网站",
    hint: "主流新闻站首页，便于查看稿件会落在什么阅读环境。只导航，不代发。",
    entries: [
      link("people", "人民网", "https://www.people.com.cn", "人民日报社", "人", "#c62828"),
      link("xinhua", "新华网", "https://www.xinhuanet.com", "新华社", "新", "#b71c1c"),
      link("cctv", "央视网", "https://www.cctv.com", "中央广播电视总台", "央", "#1565c0"),
      link("gmw", "光明网", "https://www.gmw.cn", "光明日报", "光", "#0d47a1"),
      link("chinanews", "中国新闻网", "https://www.chinanews.com.cn", "中新社", "中", "#c62828"),
      link("cnr", "央广网", "https://www.cnr.cn", "中央广播电视总台央广", "广", "#1565c0"),
      link("youth", "中国青年网", "https://www.youth.cn", "共青团中央", "青", "#0d47a1"),
      link("huanqiu", "环球网", "https://www.huanqiu.com", "环球时报", "环", "#b71c1c"),
      link("chinadaily", "中国日报", "https://cn.chinadaily.com.cn", "China Daily", "日", "#c62828"),
      link("thepaper", "澎湃新闻", "https://www.thepaper.cn", "上海报业澎湃", "湃", "#1a237e"),
      link("jiemian", "界面新闻", "https://www.jiemian.com", "上海报业界面", "界", "#263238"),
      link("caixin", "财新", "https://www.caixin.com", "财新传媒", "财", "#c62828"),
      link("yicai", "第一财经", "https://www.yicai.com", "第一财经", "一", "#c62828"),
      link("36kr", "36氪", "https://36kr.com", "创投与科技资讯", "氪", "#1a1a1a"),
      link("huxiu", "虎嗅", "https://www.huxiu.com", "商业资讯", "虎", "#f4511e"),
      link("tmtpost", "钛媒体", "https://www.tmtpost.com", "TMT 资讯", "钛", "#1565c0"),
      link("guancha", "观察者网", "https://www.guancha.cn", "时政评论", "观", "#b71c1c"),
      link("ifeng-news", "凤凰网", "https://www.ifeng.com", "凤凰资讯", "凤", "#f57c00"),
      link("china-com", "中国网", "https://www.china.com.cn", "国务院新闻办", "国", "#c62828"),
      link("ce-cn", "中国经济网", "https://www.ce.cn", "经济日报社", "经", "#b71c1c"),
      link("haiwainet", "海外网", "https://www.haiwainet.cn", "人民日报海外版", "海", "#c62828"),
      link("shobserver", "上观新闻", "https://www.shobserver.com", "解放日报 / 上观", "上", "#1565c0"),
      link("bjnews", "新京报", "https://www.bjnews.com.cn", "新京报", "京", "#1a237e"),
      link("infzm", "南方周末", "https://www.infzm.com", "南方报业", "南", "#2e7d32"),
      link("nbd", "每日经济新闻", "https://www.nbd.com.cn", "每日经济新闻", "每", "#c62828"),
      link("stcn", "证券时报", "https://www.stcn.com", "证券时报网", "证", "#b71c1c"),
      link("sciencenet", "科学网", "https://www.sciencenet.cn", "中国科学报社", "科", "#0d47a1"),
      link("eeo", "经济观察网", "https://www.eeo.com.cn", "经济观察报", "观", "#37474f"),
    ],
  },
  {
    id: "baike",
    label: "百科词条",
    hint: "搜品牌、问 AI 时经常落到这里。只导航，方便去认领或完善词条。",
    entries: [
      link("baike", "百度百科", "https://baike.baidu.com", "中文百科主站", "百", "#2932e1"),
      link("wikipedia", "维基百科", "https://zh.wikipedia.org", "多语言百科", "维", "#000000"),
      link("sogou-baike", "搜狗百科", "https://baike.sogou.com", "搜狗百科", "搜", "#fb6022"),
      link("360-baike", "360百科", "https://baike.so.com", "360 百科", "360", "#00b42a"),
      link("zhidao", "百度知道", "https://zhidao.baidu.com", "问答收录", "问", "#2932e1"),
      link("mbalib", "MBA智库", "https://wiki.mbalib.com", "经管百科", "智", "#1565c0"),
      link("hudong", "互动百科", "https://www.baike.com", "互动百科", "互", "#c62828"),
    ],
  },
  {
    id: "knowledge",
    label: "知识社区",
    hint: "问答、专栏、产品社区。",
    entries: [
      supported("zhihu", "https://www.zhihu.com"),
      supported("douban", "https://www.douban.com"),
      supported("jianshu", "https://www.jianshu.com"),
      supported("woshipm", "https://www.woshipm.com"),
      supported("bilibili", "https://www.bilibili.com"),
      link("guokr", "果壳", "https://www.guokr.com", "科学与泛知识", "壳", "#19b955"),
      link("sspai", "少数派", "https://sspai.com", "效率与数字生活", "少", "#d32f2f"),
      link("pmcaff", "PMCAFF", "https://www.pmcaff.com", "产品经理社区", "PM", "#1565c0"),
      link("zcool", "站酷", "https://www.zcool.com.cn", "设计师作品社区", "酷", "#ff6a00"),
      link("uisdc", "优设", "https://www.uisdc.com", "设计师媒体", "设", "#5c6bc0"),
      link("huaban", "花瓣", "https://huaban.com", "灵感与素材", "瓣", "#e91e63"),
    ],
  },
  {
    id: "tech",
    label: "技术社区",
    hint: "开发者博客与技术社区。",
    entries: [
      supported("csdn", "https://www.csdn.net"),
      supported("juejin", "https://juejin.cn"),
      supported("cnblogs", "https://www.cnblogs.com"),
      supported("cto51", "https://www.51cto.com"),
      supported("segmentfault", "https://segmentfault.com"),
      supported("oschina", "https://www.oschina.net"),
      supported("imooc", "https://www.imooc.com"),
      supported("yuque", "https://www.yuque.com"),
      link("github", "GitHub", "https://github.com", "代码托管与开源", "GH", "#24292f"),
      link("gitee", "Gitee", "https://gitee.com", "国内代码托管", "G", "#c71d23"),
      link("v2ex", "V2EX", "https://www.v2ex.com", "创意工作者社区", "V", "#333333"),
      link("infoq", "InfoQ", "https://www.infoq.cn", "软件与架构资讯", "IQ", "#0b6e99"),
      link("stackoverflow", "Stack Overflow", "https://stackoverflow.com", "英文技术问答", "SO", "#f48024"),
      link("toutiaoio", "开发者头条", "https://toutiao.io", "技术文章聚合", "头", "#f04142"),
      link("geekbang", "极客时间", "https://time.geekbang.org", "技术专栏与课程", "极", "#fa8919"),
    ],
  },
  {
    id: "social",
    label: "社媒",
    hint: "短内容与社交平台。",
    entries: [
      supported("weibo", "https://weibo.com"),
      supported("xiaohongshu", "https://www.xiaohongshu.com"),
      supported("douyin", "https://www.douyin.com"),
      supported("x", "https://x.com"),
      supported("smzdm", "https://www.smzdm.com"),
      link("kuaishou", "快手", "https://www.kuaishou.com", "短视频与直播", "快", "#ff4906"),
      link("tieba", "百度贴吧", "https://tieba.baidu.com", "兴趣论坛", "吧", "#2932e1"),
      link("jike", "即刻", "https://web.okjike.com", "兴趣社交", "即", "#ffe411"),
      link("wechat-channels", "视频号", "https://channels.weixin.qq.com", "微信短视频", "视", "#07c160"),
    ],
  },
  {
    id: "video",
    label: "视频平台",
    hint: "中长视频与短视频分发场。只打开站点，不代发。",
    entries: [
      link("ixigua", "西瓜视频", "https://www.ixigua.com", "字节中视频", "西", "#fe2c55"),
      link("youku", "优酷", "https://www.youku.com", "阿里视频", "优", "#00a0e9"),
      link("qqvideo", "腾讯视频", "https://v.qq.com", "腾讯视频", "腾", "#ff6a00"),
      link("iqiyi", "爱奇艺", "https://www.iqiyi.com", "爱奇艺", "爱", "#00be06"),
      link("kuaishou-v", "快手", "https://www.kuaishou.com", "短视频", "快", "#ff4906"),
      link("channels-v", "视频号", "https://channels.weixin.qq.com", "微信视频号", "视", "#07c160"),
      supported("bilibili", "https://www.bilibili.com", "B站视频与专栏"),
      supported("douyin", "https://www.douyin.com", "抖音短视频"),
    ],
  },
  {
    id: "audio",
    label: "音频播客",
    hint: "播客、有声和知识音频。品牌访谈、产品故事常出现在这里。",
    entries: [
      link("ximalaya", "喜马拉雅", "https://www.ximalaya.com", "有声与播客", "喜", "#ff5a00"),
      link("qingting", "蜻蜓FM", "https://www.qingting.fm", "广播与播客", "蜻", "#ff6f00"),
      link("lizhi", "荔枝", "https://www.lizhi.fm", "UGC 播客", "荔", "#e91e63"),
      link("xiaoyuzhou", "小宇宙", "https://www.xiaoyuzhoufm.com", "播客客户端", "宙", "#5b3cc4"),
      link("music163", "网易云音乐", "https://music.163.com", "音乐与播客", "云", "#c20c0c"),
      link("dedao", "得到", "https://www.dedao.cn", "知识服务与音频", "得", "#c62828"),
    ],
  },
  {
    id: "local",
    label: "本地生活",
    hint: "到店、点评、地图。本地品牌被搜到时经常落在这些页。",
    entries: [
      link("dianping", "大众点评", "https://www.dianping.com", "到店点评", "点", "#ff6633"),
      link("meituan", "美团", "https://www.meituan.com", "到店与外卖", "美", "#ffd100"),
      link("amap", "高德地图", "https://www.amap.com", "门店与导航", "高", "#0091ff"),
      link("baidu-map", "百度地图", "https://map.baidu.com", "地点与商户", "图", "#2932e1"),
      link("qq-map", "腾讯地图", "https://map.qq.com", "地点与路线", "腾", "#1aad19"),
    ],
  },
  {
    id: "ecommerce",
    label: "电商内容",
    hint: "店铺、详情页和站内内容。适合对照竞品出现位置。",
    entries: [
      link("taobao", "淘宝", "https://www.taobao.com", "C2C 与内容", "淘", "#ff5000"),
      link("tmall", "天猫", "https://www.tmall.com", "品牌旗舰", "猫", "#ff0036"),
      link("jd", "京东", "https://www.jd.com", "自营与店铺", "京", "#e1251b"),
      link("pdd", "拼多多", "https://www.pinduoduo.com", "拼团电商", "拼", "#e02e24"),
      link("suning", "苏宁易购", "https://www.suning.com", "家电零售", "苏", "#ffaa00"),
      link("vip", "唯品会", "https://www.vip.com", "特卖电商", "唯", "#f10180"),
      link("dewu", "得物", "https://www.dewu.com", "潮流鉴定电商", "得", "#111111"),
      supported("xiaohongshu", "https://www.xiaohongshu.com", "小红书笔记与店铺"),
      supported("douyin", "https://www.douyin.com", "抖音橱窗与直播"),
    ],
  },
  {
    id: "jobs",
    label: "招聘平台",
    hint: "公司主页和职位页也会被搜到。雇主品牌内容常出现在这里。",
    entries: [
      link("zhipin", "BOSS直聘", "https://www.zhipin.com", "直聊招聘", "直", "#00a6a7"),
      link("liepin", "猎聘", "https://www.liepin.com", "中高端招聘", "猎", "#00a0e9"),
      link("zhaopin", "智联招聘", "https://www.zhaopin.com", "综合招聘", "智", "#1e88e5"),
      link("51job", "前程无忧", "https://www.51job.com", "综合招聘", "前", "#ff6a00"),
      link("lagou", "拉勾", "https://www.lagou.com", "互联网招聘", "拉", "#00b38a"),
      link("kanzhun", "看准", "https://www.kanzhun.com", "公司口碑", "准", "#3f51b5"),
      link("maimai", "脉脉", "https://maimai.cn", "职场社交", "脉", "#1976d2"),
    ],
  },
  {
    id: "property",
    label: "房产",
    hint: "新房、二手房门户。地产品牌和门店内容常在这里。",
    entries: [
      supported("sohufocus", "https://house.focus.cn", "搜狐焦点房产"),
      link("ke", "贝壳找房", "https://www.ke.com", "二手房与新房", "贝", "#00ae66"),
      link("lianjia", "链家", "https://www.lianjia.com", "房产经纪", "链", "#00ae66"),
      link("anjuke", "安居客", "https://www.anjuke.com", "房产信息", "安", "#3d7eff"),
      link("fang", "房天下", "https://www.fang.com", "新房与家居", "房", "#e40000"),
    ],
  },
  {
    id: "auto",
    label: "汽车媒体",
    hint: "车企、经销商和零部件内容常被搜到这些站。",
    entries: [
      link("autohome", "汽车之家", "https://www.autohome.com.cn", "看车社区", "车", "#d22222"),
      link("dongchedi", "懂车帝", "https://www.dongchedi.com", "字节汽车内容", "懂", "#1a1a1a"),
      link("yiche", "易车", "https://www.yiche.com", "买车门户", "易", "#e53935"),
      link("pcauto", "太平洋汽车", "https://www.pcauto.com.cn", "汽车评测", "太", "#1565c0"),
    ],
  },
  {
    id: "wechat",
    label: "公众号",
    hint: "微信公众平台。",
    entries: [
      supported("weixin", "https://mp.weixin.qq.com"),
      link("channels-wx", "视频号", "https://channels.weixin.qq.com", "微信短视频号", "视", "#07c160"),
      link("work-weixin", "企业微信", "https://work.weixin.qq.com", "企业与客户联系", "企", "#3076e7"),
    ],
  },
  {
    id: "cloud",
    label: "云厂商社区",
    hint: "云开发者博客。",
    entries: [
      supported("tencentcloud", "https://cloud.tencent.com/developer"),
      supported("aliyun", "https://developer.aliyun.com"),
      supported("huaweicloud", "https://bbs.huaweicloud.com"),
    ],
  },
  {
    id: "finance",
    label: "财经社区",
    hint: "投资社区与房产媒体。",
    entries: [
      supported("xueqiu", "https://xueqiu.com"),
      supported("eastmoney", "https://www.eastmoney.com"),
      supported("sohufocus", "https://house.focus.cn"),
      link("10jqka", "同花顺", "https://www.10jqka.com.cn", "行情与资讯", "顺", "#e53935"),
      link("wallstreetcn", "华尔街见闻", "https://wallstreetcn.com", "全球财经资讯", "华", "#1a1a1a"),
      link("cls", "财联社", "https://www.cls.cn", "电报与快讯", "联", "#c62828"),
      link("sina-finance", "新浪财经", "https://finance.sina.com.cn", "财经门户", "财", "#e6162d"),
      link("jrj", "金融界", "https://www.jrj.com.cn", "证券资讯", "金", "#c62828"),
    ],
  },
  {
    id: "llm",
    label: "点物目录",
    hint: "推送到 dianwu.ai/directory。仅本地工作区可用。",
    entries: [
      supported("dianwu", "https://dianwu.ai/directory", "点物目录"),
    ],
  },
  {
    id: "global",
    label: "出海国际",
    hint: "海外被搜到、被问到时常见的出处。只导航。",
    entries: [
      link("linkedin", "LinkedIn", "https://www.linkedin.com", "职业社交与公司页", "in", "#0a66c2"),
      link("youtube", "YouTube", "https://www.youtube.com", "视频平台", "YT", "#ff0000"),
      link("medium", "Medium", "https://medium.com", "英文长文", "M", "#000000"),
      link("facebook", "Facebook", "https://www.facebook.com", "社交主页", "f", "#1877f2"),
      link("instagram", "Instagram", "https://www.instagram.com", "图片与短视频", "IG", "#e1306c"),
      link("reddit", "Reddit", "https://www.reddit.com", "英文社区", "R", "#ff4500"),
      link("quora", "Quora", "https://www.quora.com", "英文问答", "Q", "#b92b27"),
      link("gmb", "Google 商家", "https://www.google.com/business/", "地图与商家资料", "G", "#4285f4"),
      link("amazon", "Amazon", "https://www.amazon.com", "跨境零售", "A", "#ff9900"),
      link("alibaba-com", "Alibaba.com", "https://www.alibaba.com", "跨境批发", "阿", "#ff6a00"),
      supported("x", "https://x.com", "X / Twitter"),
    ],
  },
];

export const MEDIA_NAV_CATEGORY_IDS = MEDIA_NAV_CATEGORIES.map((c) => c.id);

export function isMediaNavCategoryId(
  value: string,
): value is MediaNavCategoryId {
  return MEDIA_NAV_CATEGORIES.some((c) => c.id === value);
}
