# 点物GEO 文章多平台同步助手

本机运行的 GEO 内容与多平台文章同步工具：用语料库与 AI 写稿、挖长尾词，再把一篇富文本文章**优先用 Chrome 扩展**同步到各平台草稿箱，确认后再发布；扩展未覆盖的平台可用本机 Playwright 半自动兜底。

- **GEO 写稿闭环**：语料库 → AI 写文案（可选风格）→ GEO 挖词关联 → 文章编辑 → 多平台草稿同步
- **扩展优先**：使用浏览器里已登录的 Cookie，调用各平台 Web 草稿接口（与手点插件同路）
- **数据不出本机**：文章、语料、挖词与本机会话存在本地 `data/`，不经过第三方服务器
- **草稿确认**：默认同步为草稿，不追求无人值守直接发表
- **半自动兜底**：强校验挡住时会保留 Playwright 窗口，关窗后继续下一平台

> 这是桌面本机工具，不是云端 SaaS。每位使用者需在自己电脑上安装并登录自己的账号。AI 写稿需自行配置 DeepSeek API Key（见下文）。

## 环境要求

| 项 | 要求 |
|---|---|
| Node.js | **20+**（推荐 LTS） |
| 系统 | macOS / Windows / Linux（需能弹出浏览器窗口） |
| Chrome | 用于加载扩展「点物GEO 文章多平台同步助手」 |
| 网络 | 首次 `npm install` 会下载 Playwright Chromium（本机自动兜底用） |
| DeepSeek（可选） | GEO 挖词 / AI 写文案需要；见 `.env.example` |

## 安装与启动

```bash
git clone https://github.com/fujiezee/content-multipublish.git
cd content-multipublish
npm install
cp .env.example .env   # 填写 DEEPSEEK_API_KEY 后可用挖词与写文案
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

### A. GEO 写稿（可选）

1. **语料库**（`/corpus`）：沉淀品牌、故事、产品、风格参考等素材，供 AI 引用
2. **GEO 挖词**（`/keywords`）：输入主词与背景，生成长尾词、推荐标题与写作角度；全库去重，可继续追加
3. **AI 写文案**（`/writing`）：选文案类型与**写作风格**，基于语料流式生成；可从挖词页一键带入长尾词并关联文章
4. **保存为文章**：进入编辑器继续改稿、配封面，再走多平台同步

写作风格可选：

| 风格 | 说明 |
|---|---|
| 默认 | 专业、真诚、有温度 |
| Dan Koe | 短句断言、高能动身份叙事 |
| 金枪大叔 | 挑衅起手、口语相声腔、语言钉 + 反扣 |
| 李叫兽 | 认知反转、结构化说理、可转述模型 |

环境变量见 `.env.example`（`DEEPSEEK_API_KEY`、`DEEPSEEK_REASONING_MODEL` 等）。

### B. 多平台同步

1. **扩展**：按上文加载 `tools/dianwu-geo`，并在 Chrome 登录目标平台
2. **文章**：新建或打开文章，填写标题、摘要、封面与正文
3. **同步**：编辑器点「多平台同步」，勾选平台后开始；扩展覆盖的平台同步到**草稿**，完成后可打开草稿链接确认发布

发稿只走 **点物网站 → Chrome 扩展**，没有本机 CLI / MCP 脚本。

## 界面入口

| 路径 | 说明 |
|---|---|
| `/` | 文章列表 |
| `/keywords` | GEO 挖词 |
| `/corpus` | 语料库 |
| `/writing` | AI 写文案 |
| `/accounts` | 本机账号（Playwright / API 会话） |
| `/jobs` | 同步记录 |

## 支持的平台（40）

知乎、微博、百家号、简书、CSDN、头条号、掘金、微信公众号、B站专栏、豆瓣、搜狐号、大鱼号、一点号、博客园、51CTO、思否、慕课手记、开源中国、语雀、人人都是产品经理、雪球、搜狐焦点、小红书、抖音图文、网易号、什么值得买、东方财富、X、企鹅号、大风号、360快传号、新浪看点、东方号、北京时间号、人民号、新华号、中青号、腾讯云+、阿里云开发者、华为云社区。

其中扩展草稿同步覆盖 38 个（含人民号/新华号/中青号等资讯号；小红书/抖音走本机）；思否在本机会话已连接时可优先走 Node API 草稿。

未包含：WordPress / Typecho（需站点 URL 与 XML-RPC 等单独配置）、Hexo/Hugo（导出类）。

## 项目结构（简）

```
tools/dianwu-geo/       # Chrome 扩展（主同步路径）
tools/dianwu-geo-cli/   # 已停用：本机 CLI / MCP 桥
src/lib/dianwu-geo.ts   # 编辑器 ↔ 扩展桥接
src/lib/ai/             # DeepSeek 写文案、GEO 挖词
src/lib/draft-adapters/ # Node 草稿 API（Cookie + HTTP，实验）
src/lib/publishers/     # 各平台 Playwright 适配器（兜底）
src/lib/queue/          # 本机串行发布队列与会话连接
src/app/                # Next.js UI + API（文章 / 挖词 / 语料 / 写文案 / 账号 / 任务）
data/                   # 本地运行时数据（gitignore，勿提交）
```

## 常见问题

**端口 3000 被占用**  
改用 `npx next dev -p 3001`，或结束占用进程。扩展需把该源加入可访问站点（本扩展已允许 localhost / 127.0.0.1）。

**未检测到扩展**  
确认已加载 `tools/dianwu-geo`（不是旧目录）、扩展已启用，并用 `http://localhost:3000` 打开后硬刷新（Cmd+Shift+R）。

**挖词 / 写文案失败**  
确认 `.env` 已配置有效的 `DEEPSEEK_API_KEY`，并重启 `npm run dev`。

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
- AI 请求发往你配置的 DeepSeek（或兼容）接口；语料与文章仍只存在本机
- 请仅用于你有权操作的账号，遵守各平台服务条款
- 开源软件按现状提供，适配器可能随时因平台改版失效

## License

应用代码见 [LICENSE](LICENSE)（MIT）。
