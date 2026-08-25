# @dianwu/geo-cli

**已停用。** 发稿只走点物网站 → Chrome 扩展，不再提供本机 `serve` / MCP。本目录仅作归档。

## 架构

```
dianwu-geo CLI / MCP  ──WS :9527──►  Chrome 扩展 MCPClient  ──►  平台草稿 API
```

扩展是 WebSocket **客户端**；本工具是 **服务端**（与 Wechatsync CLI 相同模型）。

## 安装

```bash
cd tools/dianwu-geo-cli
npm install
npm run build
```

在仓库根目录也可：

```bash
npm run geo:serve
npm run geo:sync -- fixtures/...   # 见根 package.json
```

## 快速开始

1. Chrome 加载扩展 `tools/dianwu-geo`，登录目标平台
2. 打开扩展 Popup：开启「MCP 连接」；底部「CLI / MCP 同步桥接」确认地址为 `ws://127.0.0.1:9527`
3. 启动桥接：

```bash
npm start
# 或
node dist/cli.js serve
```

4. 另开终端同步：

```bash
node dist/cli.js platforms --auth
node dist/cli.js sync fixtures/sample.md -p juejin,zhihu
```

`sync` / `platforms` / `auth` 也会在需要时自动短生命周期启动 WS 并等待扩展。

## 命令

| 命令 | 说明 |
|------|------|
| `serve` | 常驻 WebSocket 桥 |
| `sync <file> -p a,b` | 同步 Markdown/HTML 为草稿 |
| `platforms` / `ls -a` | 平台列表；`-a` 含登录态 |
| `auth [platform]` | 检查登录 |
| `mcp` | MCP stdio（同时监听 WS） |

### sync 示例

```bash
node dist/cli.js sync article.md -p zhihu,juejin
node dist/cli.js sync article.md -t "标题" -p juejin --cover https://example.com/cover.jpg
node dist/cli.js sync article.md -p juejin --dry-run
```

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `SYNC_WS_HOST` | 监听地址 | `127.0.0.1` |
| `SYNC_WS_PORT` | 端口 | `9527` |
| `DIANWU_GEO_TOKEN` | 校验 Token（兼容 `WECHATSYNC_TOKEN` / `MCP_TOKEN`） | 空（本机可不设） |

远程桥接（扩展在笔记本、CLI 在服务器）：

```bash
SYNC_WS_HOST=0.0.0.0 DIANWU_GEO_TOKEN=your-secret node dist/cli.js serve
```

扩展 Popup 将服务器地址设为 `ws://<服务器IP>:9527`，Token 填同一值。

## Cursor / Claude MCP 配置示例

```json
{
  "mcpServers": {
    "dianwu-geo": {
      "command": "node",
      "args": [
        "/ABS/PATH/content-multipublish/tools/dianwu-geo-cli/dist/cli.js",
        "mcp"
      ],
      "env": {
        "DIANWU_GEO_TOKEN": "optional-secret"
      }
    }
  }
}
```

MCP 工具：`list_platforms`、`check_auth`、`sync_article`、`extract_article`。

使用前请保持扩展 MCP 已开启并连上本桥。

## 协议（给扩展）

服务端 → 扩展：

```json
{ "id": "uuid", "method": "syncArticle", "params": { "platforms": ["juejin"], "article": { "title": "...", "markdown": "..." } } }
```

扩展 → 服务端：

```json
{ "id": "uuid", "result": [ { "platform": "juejin", "success": true, "postUrl": "..." } ] }
```

方法：`listPlatforms`、`checkAuth`、`syncArticle`、`extractArticle`、`uploadImage`。
