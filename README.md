# 点物GEO 文章多平台同步助手

本机运行的多平台文章发布工具：写一篇富文本文章，用 Playwright 串行同步到多个内容平台，也可配合 Chrome 扩展一键分发。

- **数据不出本机**：Cookie / 文章存在本地 `data/`，不经过第三方服务器
- **扫码连平台**：有头浏览器登录，会话持久化后可复用
- **半自动兜底**：强校验挡住时会保留窗口，关窗后继续下一平台

> 这是桌面本机工具，不是云端 SaaS。每位使用者需在自己电脑上安装并登录自己的账号。

## 环境要求

| 项 | 要求 |
|---|---|
| Node.js | **20+**（推荐 LTS） |
| 系统 | macOS / Windows / Linux（需能弹出浏览器窗口） |
| 网络 | 首次 `npm install` 会下载 Playwright Chromium |

可选：本机已安装 Google Chrome 时优先使用系统 Chrome，否则用 Playwright 自带 Chromium。

## 安装与启动

```bash
git clone https://github.com/fujiezee/content-multipublish.git
cd content-multipublish
npm install
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

生产模式：

```bash
npm run build
npm start
```

若 Chromium 未装好，可手动执行：

```bash
npm run browsers
```

## 使用流程

1. **账号**：打开「账号」页，连接目标平台（扫码/登录，等待自动检测成功）
2. **文章**：新建文章，填写标题、摘要、封面与正文
3. **发布**：勾选平台后开始串行发布；失败截图在 `data/debug/`
4. 若窗口提示补封面/标签等，在本机浏览器里补完并发布或关窗，队列才会继续

默认不会一次勾选全部平台，避免同时弹十几个登录/编辑窗。

## 支持的平台（28）

知乎、微博、百家号、简书、CSDN、头条号、掘金、微信公众号、B站专栏、豆瓣、搜狐号、大鱼号、一点号、博客园、51CTO、思否、慕课手记、开源中国、语雀、人人都是产品经理、雪球、搜狐焦点、小红书、抖音图文、网易号、什么值得买、东方财富、X。

未包含：WordPress / Typecho（需站点 URL 与 XML-RPC 等单独配置）、Hexo/Hugo（导出类）。

可选：文章编辑器内「多平台同步」按钮可配合 Chrome 扩展使用（开发者模式加载 `tools/dianwu-geo`）。官网 [dianwu.ai](https://dianwu.ai)。

## 项目结构（简）

```
src/lib/publishers/   # 各平台 Playwright 适配器
src/lib/queue/        # 串行发布队列与会话连接
src/app/              # Next.js UI + API
public/geo-sync/      # 点物GEO 文章多平台同步助手 网页 SDK（本地）
data/                 # 本地运行时数据（gitignore，勿提交）
tools/dianwu-geo/     # 点物GEO 文章多平台同步助手 Chrome 扩展（可选）
```

## 常见问题

**端口 3000 被占用**  
改用 `npx next dev -p 3001`，或结束占用进程。

**提示浏览器 / Chromium 找不到**  
执行 `npm run browsers`，确认能访问 Playwright 下载源。

**发布停住、一直不进入下一平台**  
半自动场景会 `keepOpen`：请在打开的平台窗口完成操作后**关闭该窗口**。

**某平台突然失败**  
平台改版会导致选择器失效。查看 `data/debug/` 截图，再改 `src/lib/publishers/<平台>.ts`。

**Windows 上 `better-sqlite3` 编译失败**  
需安装对应平台的构建工具（如 Visual Studio Build Tools），或使用已预编译二进制的 Node 版本。

## 隐私与免责

- 仅存储 Playwright `storageState`（Cookie 等），不收集账号密码
- 请仅用于你有权操作的账号，遵守各平台服务条款
- 开源软件按现状提供，适配器可能随时因平台改版失效

## License

应用代码见 [LICENSE](LICENSE)（MIT）。
