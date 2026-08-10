# 扩展额外平台适配器

内置打包（`assets/index.ts-ZvOctxVj.js`）含 13 个平台。本目录用于按上游 [Wechatsync v2](https://github.com/wechatsync/Wechatsync/tree/v2) 模式追加平台，无需重编整个扩展。

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
| `netease` | 网易号 | `publish.do` `saveDraft`；可能触发验证码 |
| `dayu` | 大鱼号 | `dashboard/save-draft` + ns 图床 |
| `sohufocus` | 搜狐焦点 | `publishNewsInfo` `status:4` |
| `yidian` | 一点号 | `/model/Article`；字段依现网 SPA，可能需微调 |

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

## CLI / MCP 同步桥接

扩展 SW 会连接本机 WebSocket（默认 `ws://127.0.0.1:9527`），由 [`tools/dianwu-geo-cli`](../dianwu-geo-cli/) 提供服务端。

1. `cd tools/dianwu-geo-cli && npm i && npm run build && npm start`
2. Popup 开启「MCP 连接」；底部「CLI / MCP 同步桥接」可改服务器地址与 Token
3. `node dist/cli.js platforms --auth` / `sync article.md -p juejin`

配置项存于 `chrome.storage.local`：`mcpServerUrl`、`mcpToken`（由 `sync-bridge-config.js` 在连接时改写 WebSocket URL）。
