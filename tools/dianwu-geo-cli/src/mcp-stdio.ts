import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  BridgeServer,
  ensureSharedBridgeStarted,
} from "./bridge-server.js";
import { checkAuth } from "./commands/auth.js";
import { listPlatforms } from "./commands/platforms.js";
import { runSync } from "./commands/sync.js";
import { getBridgeHost, getBridgePort, getBridgeToken } from "./protocol.js";

function textResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

export async function startMcpStdio(options: {
  bridge?: BridgeServer;
} = {}): Promise<void> {
  const bridge =
    options.bridge ??
    (await ensureSharedBridgeStarted({
      host: getBridgeHost(),
      port: getBridgePort(),
      token: getBridgeToken(),
    }));

  // Log to stderr so stdout stays clean for MCP stdio
  console.error(
    `[dianwu-geo-mcp] WebSocket bridge ${bridge.address}` +
      (getBridgeToken() ? " (token required)" : " (no token)"),
  );

  const server = new McpServer({
    name: "dianwu-geo",
    version: "0.1.0",
  });

  server.tool(
    "list_platforms",
    "列出点物GEO 扩展支持的平台；可附带登录状态",
    {
      auth: z
        .boolean()
        .optional()
        .describe("为 true 时强制刷新并包含登录状态"),
    },
    async ({ auth }) => {
      const platforms = await listPlatforms({
        auth: !!auth,
        forceRefresh: !!auth,
        bridge,
      });
      return textResult(platforms);
    },
  );

  server.tool(
    "check_auth",
    "检查一个或全部平台的登录状态（依赖本机 Chrome 扩展 Cookie）",
    {
      platform: z
        .string()
        .optional()
        .describe("平台 id，如 zhihu / juejin；省略则检查全部"),
      refresh: z.boolean().optional().describe("强制刷新"),
    },
    async ({ platform, refresh }) => {
      const result = await checkAuth({
        platform,
        refresh: !!refresh,
        bridge,
      });
      return textResult(result);
    },
  );

  server.tool(
    "sync_article",
    "通过 Chrome 扩展将文章同步为各平台草稿（不会自动正式发表）",
    {
      file: z
        .string()
        .optional()
        .describe("本地 Markdown/HTML 文件路径；与 title+content/markdown 二选一"),
      title: z.string().optional().describe("文章标题"),
      markdown: z.string().optional().describe("Markdown 正文"),
      content: z.string().optional().describe("HTML 正文"),
      cover: z.string().optional().describe("封面 URL 或本地路径"),
      platforms: z
        .array(z.string())
        .describe("平台 id 列表，如 [\"zhihu\",\"juejin\"]"),
    },
    async ({ file, title, markdown, content, cover, platforms }) => {
      if (file) {
        const results = await runSync({
          file,
          platforms,
          title,
          cover,
          bridge,
        });
        return textResult(results);
      }

      if (!title) throw new Error("缺少 title（或提供 file）");
      if (!markdown && !content) {
        throw new Error("缺少 markdown 或 content（或提供 file）");
      }

      await bridge.waitForExtension();
      const results = await bridge.call("syncArticle", {
        platforms,
        article: { title, markdown, content, cover },
      });
      return textResult(results);
    },
  );

  server.tool(
    "extract_article",
    "从浏览器当前活动标签页提取文章（需扩展已连接）",
    {},
    async () => {
      await bridge.waitForExtension();
      const article = await bridge.call("extractArticle", {});
      return textResult(article);
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
