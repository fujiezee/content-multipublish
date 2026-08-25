# 扩展额外平台适配器

内置打包（`assets/index.ts-ZvOctxVj.js`）含 13 个平台。本目录用于按上游 [Wechatsync v2](https://github.com/wechatsync/Wechatsync/tree/v2) 模式追加平台，无需重编整个扩展。

## 版本（必跟迭代）

Chrome 显示的版本来自根目录 [`manifest.json`](../manifest.json) 的 `version` 字段（当前 **2.11.7**）。

改适配器 / 桥接 / 规则后**必须** bump：

| 变更 | 版本位 |
|------|--------|
| 修登录/发布小 bug、文案 | patch：`2.6.0` → `2.6.1` |
| 新平台、自动发布、同步历史等能力 | minor：`2.6.x` → `2.7.0` |
| 不兼容大改 | major：`2.x` → `3.0.0` |

同步更新：`inject-api.js` 的 `versionNumber`（页面桥协议号）、本文件顶部版本说明、[`CHANGELOG.md`](../CHANGELOG.md)。

## 已追加（extras）

| id | 名称 | 说明 |
| --- | --- | --- |
| `segmentfault` | 思否 | |
| `cnblogs` | 博客园 | 需 XSRF cookie |
| `cto51` | 51CTO | 产品 id 为 `cto51`（上游 `51cto`） |
| `imooc` | 慕课手记 | |
| `oschina` | 开源中国 | |
| `eastmoney` | 东方财富 | 需 `ct`/`ut` cookie |
| `jianshu` | 简书 | `author/notes` + 七牛；非上游公开源码 |
| `netease` | 网易号 | **`publishV2.do`** + 易盾 `ursToken`（旧 publish.do 已弃用） |
| `dayu` | 大鱼号 | `save-draft`；登录以 `globalConfig.isLogin/wmid` 为准（修误报未登录） |
| `sohufocus` | 搜狐焦点 | 登录：`ppinf` + `passport/getUserInfo`；旧 `mp-fe-pc` 草稿多已下线 |
| `zhihu` | 知乎 | **自动发布**：草稿字段补全 + 话题 + `PUT .../publish`（失败回退草稿编辑页） |
| `yidian` | 一点号 | `/model/Article`；字段依现网 SPA，可能需微调 |
| `sohu` | 搜狐号 | **覆盖内置**：`draft/v2` + `dv-id`/`sp-cm`（修「获取客户端失败」） |
| `douban` | 豆瓣 | **覆盖内置**：`frodotk` + `rexxar/api/v2/topic/post`；草稿=`accessible=private` |
| `smzdm` | 什么值得买 | `editorValue` + `submit_type=auto_save`；`.release-new` 取稿；WAF 重试 |
| `x` | X | `auth_token`/`ct0` + GraphQL `CreateTweet`（同步即发帖，无草稿箱） |
| `qiehao` | 企鹅号 | 登录看 `g_userInfo`/文章接口（勿用 getLoginState）；`/article/save` + DOM「存草稿」 |
| `dafeng` | 大风号 | `mp.ifeng.com` 草稿接口探测 + DOM「存草稿」 |
| `kuaichuan` | 360快传号 | Cookie 草稿 / 可选 `kuaichuanOpenToken`→`openClaw/article` + DOM |
| `sinakandian` | 新浪看点 | `mp.sina.com.cn`；并入微博时提示改用 `weibo` |
| `dongfang` | 东方号 | `mp.eastday.com` 草稿探测 + DOM「存草稿」 |
| `btime` | 北京时间号 | `mp.btime.com` 草稿探测 + DOM「存草稿」 |
| `peoplehao` | 人民号 | `pdcreator.pdnews.cn`；App 扫码入驻门槛高 |
| `xinhuahao` | 新华号 | `xhh.app.xinhuanet.com`；多为邀约入驻 |
| `zhongqing` | 中青号 | `mp.cyol.com` 草稿探测 + DOM「存草稿」 |
| `tencentcloud` | 腾讯云+ | `addArticleDraft` + `<!--markdown-->` 包裹 |
| `aliyun` | 阿里云开发者 | `putDraft?p_csrf=`（cookie `c_csrf`） |
| `huaweicloud` | 华为云社区 | `save-draft` + `/api/get-ainfo` 的 `csrf` 头；草稿箱最多 10 篇 |
| `shunqi` | 顺企网 | `news_add` 填稿确认；挂 1 张新闻图 |
| `shunqi_product` | 顺企网产品 | `product_add` 填稿确认；需产品图 |
| `bafang` | 八方资源网 | `m.b2b168.com/?pg=Supply` 填稿确认；需产品图 |
| `xiaohongshu` | 小红书 | **填稿确认制**：无稳定草稿 API；DOM 填入后待用户点发布 |
| `douyin` | 抖音文章 | **填稿确认制**：`chrome.debugger` 写入标题/正文，封面和发布人点 |
| `douyin_video` | 抖音视频 | **视频专用**（不进文章同步）：上传页塞成片，写标题/简介，发布人点 |
| `weixin` | 微信公众号 | **覆盖内置**：`chrome.debugger` 打开图文编辑器写标题/正文，封面和发表人点 |

每个平台：`adapters/<id>.js` + `rules/<id>.json`（DNR）+ `register-extra-adapters.js` 注册。

## 新增一个平台

1. 从上游复制或编写 `adapters/<id>.js`，导出 `createXxxAdapter(BaseAdapter)`
2. 在 `register-extra-adapters.js` 的 `extras` 数组里加入
3. 如需 DNR，添加 `rules/<id>.json` 并在 `manifest.json` 的 `declarative_net_request.rule_resources` 注册
4. 把 id 加入应用侧 `EXTENSION_PLATFORM_IDS`（`src/lib/dianwu-geo.ts`）
5. `chrome://extensions` 重新加载扩展

## 验证

1. 在 Chrome 登录目标平台（如 cnblogs / 51cto）
2. 打开扩展弹窗 → 点刷新 → 应出现对应格子
3. 编辑器勾选该平台 →「多平台同步」走扩展·草稿

## 发稿路径

点物网站经 `chrome.runtime.sendMessage` 直接叫扩展。本机 CLI / MCP（`ws://127.0.0.1:9527`）已停用，扩展设置里也不再展示。
