# 点物GEO 扩展 Changelog

版本号以 `manifest.json` 的 `version` 为准（Chrome 扩展管理页显示）。

## 2.6.0 — 2026-08-12

- 新增扩展平台：**小红书**（`xiaohongshu`）填稿确认制——打开创作页填好标题/正文，不自动点发布；任务状态为「待你发布」
- 页面桥协议 `versionNumber` → 1200（扩展/SaaS 版本握手 + 绑定 token）

## 2.5.11 — 2026-08-12

- 知乎：本机/内网图改为二进制 OSS 上传（平台服务端拉不到 127.0.0.1）

## 2.5.10 — 2026-08-12

- 同步草稿前把正文 `/api/uploads/...` 相对图链改成绝对地址，扩展可下载并上传到各平台 CDN

## 2.5.9 — 2026-08-11

- 新增扩展平台：**人民号**（`peoplehao`）、**新华号**（`xinhuahao`）、**中青号**（`zhongqing`）

## 2.5.8 — 2026-08-11

- 新增扩展平台：**东方号**（`dongfang`）、**北京时间号**（`btime`）

## 2.5.7 — 2026-08-11

- 新增扩展平台：**大风号**（`dafeng`）、**360快传号**（`kuaichuan`）、**新浪看点**（`sinakandian`）
- 快传号可选开放平台 Token：`chrome.storage.local.kuaichuanOpenToken` → `openClaw/article`
- 新浪看点若已并入微博头条文章，明确提示改用「微博」平台

## 2.5.6 — 2026-08-11

- 修复扩展弹窗同步报 `Cannot read properties of undefined (reading 'results')`：族分流拦截需返回 Promise，兼容 `await sendMessage`

## 2.5.5 — 2026-08-11

- 扩展弹窗勾选多平台时，按平台族自动选用编辑器变体正文（`dwgeoFamilyVariants` + popup intercept）
- 打开扩展面板时由网站推送各族变体到扩展存储

## 2.5.4 — 2026-08-11

- 博客园：编辑器同步常无 `markdown`，改为从 HTML 转 Markdown 再写 `postBody`，避免「内容不能为空」

## 2.5.3 — 2026-08-10

- 修复 extras 被核心 `Wu()` 覆盖：`registry.get` 对覆盖平台（含豆瓣）每次取用前强制重挂，避免仍走内置旧 `/j/note/autosave`

## 2.5.2 — 2026-08-10

- 豆瓣：对接新版 `rexxar/api/v2/topic/post`（`Authorization: Bearer frodotk`）；草稿优先写 `accessible=private`

## 2.5.1 — 2026-08-10

- 修复 extras 偶发未挂上导致「Platform not found」：`registry.get` 未命中时强制重注册；SW startup/installed 再刷一遍

## 2.5.0 — 2026-08-10

- 新增扩展平台：**华为云社区**（`huaweicloud`）— `save-draft` Markdown 草稿（`csrf` 来自 `/api/get-ainfo`）

## 2.4.1 — 2026-08-10

- 修复扩展同步误报「扩展未返回该平台结果」：开始 `addTask` 时清除旧的 `activeSyncState`，编辑器只认选中平台匹配的完成状态

## 2.4.0 — 2026-08-10

- 新增扩展平台：**腾讯云+**（`tencentcloud`）— `/api/article/addArticleDraft` Markdown 草稿
- 新增扩展平台：**阿里云开发者**（`aliyun`）— `putDraft` + `c_csrf`，同步为 Markdown 草稿

## 2.3.1 — 2026-08-10

- 修复企鹅号误报未登录：不再用 QQ 扫码用的 `getLoginState` 判登录
- 改为创作页 `g_userInfo` / `/article/*` 接口 / 已开 `om.qq.com` 标签读取登录态
- DOM 存草稿等待编辑器加载，鉴权失败时仍尝试打开创作页填稿

## 2.3.0 — 2026-08-10

- 新增扩展平台：**X**（`x`）— Cookie 登录检测 + GraphQL `CreateTweet`（无独立草稿箱，同步即发帖）
- 新增扩展平台：**企鹅号**（`qiehao`）— `/article/save` 草稿；失败时标签页填编辑器并点「存草稿」
- DNR：`x.com` / `api.x.com`、`om.qq.com` Origin/Referer

## 2.2.0 — 2026-08-10

- 新增扩展平台：**什么值得买**（`smzdm`）草稿同步
- 登录检测走 `zhiyou` 用户接口；保存字段 `editorValue` / `submit_type=auto_save`
- DNR 覆盖 `post.smzdm.com` Origin/Referer，带 WAF 挑战重试

## 2.1.0 — 2026-08-10

- 知乎：扩展路径改为自动发布，补全话题/封面/声明等字段
- 搜狐焦点 / 豆瓣 / 搜狐号 / 大鱼 / 网易号等登录与草稿修复
- 扩展「同步历史」可写入编辑器「本文同步记录」
- MCP / 本机桥接：关闭时不再刷 `ws://127.0.0.1:9527` 连接错误
- 页面桥 `inject-api` `versionNumber` → 1100

## 2.0.0

- 品牌更名「点物GEO 文章多平台同步助手」
- 扩展草稿平台扩展与 CLI/MCP 同步桥接初版
