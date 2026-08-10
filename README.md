# 点物GEO 文章多平台同步助手

本机运行的多平台文章同步工具：写一篇富文本文章，**优先用 Chrome 扩展**把内容同步到各平台草稿箱，确认后再发布；扩展未覆盖的平台可用本机 Playwright 半自动兜底。

- **扩展优先**：使用浏览器里已登录的 Cookie，调用各平台 Web 草稿接口（与手点插件同路）
- **数据不出本机**：文章与本机会话存在本地 `data/`，不经过第三方服务器
- **草稿确认**：默认同步为草稿，不追求无人值守直接发表
- **半自动兜底**：强校验挡住时会保留 Playwright 窗口，关窗后继续下一平台

> 这是桌面本机工具，不是云端 SaaS。每位使用者需在自己电脑上安装并登录自己的账号。

## 环境要求

| 项 | 要求 |
|---|---|
| Node.js | **20+**（推荐 LTS） |
| 系统 | macOS / Windows / Linux（需能弹出浏览器窗口） |
| Chrome | 用于加载扩展「点物GEO 文章多平台同步助手」 |
| 网络 | 首次 `npm install` 会下载 Playwright Chromium（本机自动兜底用） |

## 安装与启动

```bash
git clone https://github.com/fujiezee/content-multipublish.git
cd content-multipublish
npm install
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)（推荐 `127.0.0.1` / `localhost`，以便扩展注入）。

### 加载 Chrome 扩展（推荐）

1. 打开 `chrome://extensions`，开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选择仓库内 `tools/dianwu-geo`
3. 在 Chrome 中登录要同步的平台账号
4. 硬刷新编辑器页面后再点「多平台同步」

官网：[dianwu.ai](https://dianwu.ai)

生产模式：

```bash
npm run build
npm start
```

若 Chromium 未装好（仅本机自动需要），可手动执行：

```bash
npm run browsers
```

## 使用流程

1. **扩展**：按上文加载 `tools/dianwu-geo`，并在 Chrome 登录目标平台
2. **文章**：新建文章，填写标题、摘要、封面与正文
3. **同步**：编辑器点「多平台同步」，勾选平台后开始；扩展覆盖的平台同步到**草稿**，完成后可打开草稿链接确认发布
4. **CLI / MCP 桥接**：用命令行或 Agent 经 WebSocket（默认 `9527`）驱动同一套扩展草稿同步（见下节）
5. **API 草稿（实验）**：思否等在「账号」页已连接本机会话时，可走 Node 草稿 API（无需开浏览器窗口）
6. **本机自动（实验）**：扩展未覆盖或未安装时，可用 Playwright 串行打开编辑页；失败截图在 `data/debug/`。补封面/标签后请关闭窗口，队列才会继续

默认不会一次勾选全部平台。API / 扩展 / 本机自动可混选，按平台能力分流。

### CLI / MCP（Wechatsync 式编排）

扩展内已有 MCP WebSocket 客户端；仓库提供配套服务端与命令行：

```bash
cd tools/dianwu-geo-cli && npm install && npm run build
# 终端 A：桥接服务
npm run geo:serve
# 扩展 Popup：开启「MCP 连接」，底部确认地址 ws://127.0.0.1:9527
# 终端 B：
npm run geo:platforms -- --auth
npm run geo:sync -- tools/dianwu-geo-cli/fixtures/sample.md -p juejin
```

Agent 接入：`npm run geo:mcp`（stdio MCP + 同时监听 WS）。说明见 [`tools/dianwu-geo-cli/README.md`](tools/dianwu-geo-cli/README.md)。

远程桥接：`SYNC_WS_HOST=0.0.0.0 DIANWU_GEO_TOKEN=secret npm run geo:serve`，扩展填写对应 `ws://<host>:9527` 与同一 Token。

## 支持的平台（28）

知乎、微博、百家号、简书、CSDN、头条号、掘金、微信公众号、B站专栏、豆瓣、搜狐号、大鱼号、一点号、博客园、51CTO、思否、慕课手记、开源中国、语雀、人人都是产品经理、雪球、搜狐焦点、小红书、抖音图文、网易号、什么值得买、东方财富、X。

其中扩展草稿同步覆盖约 24 个（知乎、掘金、头条、微博、B站、百家号、CSDN、语雀、豆瓣、搜狐、雪球、微信、人人都是产品经理、思否、博客园、51CTO、慕课手记、开源中国、东方财富、简书、网易号、大鱼号、搜狐焦点、一点号等）；思否在本机会话已连接时可优先走 Node API 草稿；其余走本机自动。

未包含：WordPress / Typecho（需站点 URL 与 XML-RPC 等单独配置）、Hexo/Hugo（导出类）。

## 项目结构（简）

```
tools/dianwu-geo/       # Chrome 扩展（主同步路径）
tools/dianwu-geo-cli/   # CLI / MCP WebSocket 桥（编排层）
src/lib/dianwu-geo.ts   # 编辑器 ↔ 扩展桥接
src/lib/draft-adapters/ # Node 草稿 API（Cookie + HTTP，实验）
src/lib/publishers/     # 各平台 Playwright 适配器（兜底）
src/lib/queue/          # 本机串行发布队列与会话连接
src/app/                # Next.js UI + API
data/                   # 本地运行时数据（gitignore，勿提交）
```

## 常见问题

**端口 3000 被占用**  
改用 `npx next dev -p 3001`，或结束占用进程。扩展需把该源加入可访问站点（本扩展已允许 localhost / 127.0.0.1）。

**未检测到扩展**  
确认已加载 `tools/dianwu-geo`（不是旧目录）、扩展已启用，并用 `http://localhost:3000` 打开后硬刷新（Cmd+Shift+R）。

**提示浏览器 / Chromium 找不到**  
仅本机自动需要：执行 `npm run browsers`。

**本机自动停住、一直不进入下一平台**  
半自动场景会 `keepOpen`：请在打开的平台窗口完成操作后**关闭该窗口**。

**某平台突然失败**  
扩展路径：平台 Web API 变更；本机自动：选择器失效。查看 `data/debug/` 截图，再改对应适配器。

**Windows 上 `better-sqlite3` 编译失败**  
需安装对应平台的构建工具（如 Visual Studio Build Tools），或使用已预编译二进制的 Node 版本。

## 隐私与免责

- 扩展使用你浏览器中的登录态；本机自动仅存储 Playwright `storageState`（Cookie 等），不收集账号密码
- 请仅用于你有权操作的账号，遵守各平台服务条款
- 开源软件按现状提供，适配器可能随时因平台改版失效

## License

应用代码见 [LICENSE](LICENSE)（MIT）。
