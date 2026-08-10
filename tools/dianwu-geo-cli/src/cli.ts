#!/usr/bin/env node
import { Command } from "commander";
import {
  BridgeServer,
  ensureSharedBridgeStarted,
} from "./bridge-server.js";
import { checkAuth, printAuth } from "./commands/auth.js";
import { listPlatforms, printPlatforms } from "./commands/platforms.js";
import { printSyncResults, runSync } from "./commands/sync.js";
import { startMcpStdio } from "./mcp-stdio.js";
import {
  getBridgeHost,
  getBridgePort,
  getBridgeToken,
} from "./protocol.js";

async function withEphemeralBridge<T>(
  fn: (bridge: BridgeServer) => Promise<T>,
  options: { keepAlive?: boolean } = {},
): Promise<T> {
  const bridge = await ensureSharedBridgeStarted({
    host: getBridgeHost(),
    port: getBridgePort(),
    token: getBridgeToken(),
  });
  try {
    return await fn(bridge);
  } finally {
    if (!options.keepAlive) {
      await bridge.stop();
    }
  }
}

function parsePlatforms(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const program = new Command();

program
  .name("dianwu-geo")
  .description("点物GEO CLI — 经 WebSocket 桥接 Chrome 扩展同步草稿")
  .version("0.1.0");

program
  .command("serve")
  .description("启动 WebSocket 桥接服务（等待扩展连接）")
  .option(
    "-H, --host <host>",
    "监听地址",
    process.env.SYNC_WS_HOST || "127.0.0.1",
  )
  .option(
    "-p, --port <port>",
    "监听端口",
    process.env.SYNC_WS_PORT || "9527",
  )
  .action(async (opts: { host: string; port: string }) => {
    const port = Number(opts.port) || 9527;
    const bridge = new BridgeServer({
      host: opts.host,
      port,
      token: getBridgeToken(),
    });
    await bridge.start();
    const tokenHint = getBridgeToken()
      ? "已启用 Token 校验（DIANWU_GEO_TOKEN）"
      : "未设置 Token（仅建议本机使用）";
    console.log(`点物GEO 桥接已监听 ${bridge.address}`);
    console.log(tokenHint);
    console.log("请在扩展 Popup 开启「MCP 连接 / 同步桥接」，并确认服务器地址一致。");
    console.log("按 Ctrl+C 退出。");

    const shutdown = async () => {
      await bridge.stop();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());

    // Keep process alive
    await new Promise(() => undefined);
  });

program
  .command("sync")
  .description("同步 Markdown/HTML 到指定平台（草稿）")
  .argument("<file>", "文章文件路径（.md / .html）")
  .requiredOption(
    "-p, --platforms <list>",
    "平台 id，逗号分隔，如 zhihu,juejin",
  )
  .option("-t, --title <title>", "覆盖标题")
  .option("--cover <urlOrPath>", "封面图")
  .option("--dry-run", "仅预览请求，不实际同步")
  .action(
    async (
      file: string,
      opts: {
        platforms: string;
        title?: string;
        cover?: string;
        dryRun?: boolean;
      },
    ) => {
      const platforms = parsePlatforms(opts.platforms);
      if (opts.dryRun) {
        await runSync({
          file,
          platforms,
          title: opts.title,
          cover: opts.cover,
          dryRun: true,
        });
        return;
      }

      await withEphemeralBridge(async (bridge) => {
        console.error(`等待扩展连接 ${bridge.address} …`);
        const results = await runSync({
          file,
          platforms,
          title: opts.title,
          cover: opts.cover,
          bridge,
        });
        printSyncResults(results);
        if (results.some((r) => !r.success)) {
          process.exitCode = 1;
        }
      });
    },
  );

program
  .command("platforms")
  .alias("ls")
  .description("列出扩展支持的平台")
  .option("-a, --auth", "显示登录状态")
  .option("--refresh", "强制刷新鉴权")
  .action(async (opts: { auth?: boolean; refresh?: boolean }) => {
    await withEphemeralBridge(async (bridge) => {
      console.error(`等待扩展连接 ${bridge.address} …`);
      const platforms = await listPlatforms({
        auth: !!opts.auth || !!opts.refresh,
        forceRefresh: !!opts.refresh,
        bridge,
      });
      printPlatforms(platforms, { auth: !!opts.auth || !!opts.refresh });
    });
  });

program
  .command("auth")
  .description("检查平台登录状态")
  .argument("[platform]", "平台 id；省略则检查全部")
  .option("--refresh", "强制刷新")
  .action(async (platform: string | undefined, opts: { refresh?: boolean }) => {
    await withEphemeralBridge(async (bridge) => {
      console.error(`等待扩展连接 ${bridge.address} …`);
      const result = await checkAuth({
        platform,
        refresh: !!opts.refresh,
        bridge,
      });
      printAuth(result, platform);
      if (!Array.isArray(result) && !result.isAuthenticated) {
        process.exitCode = 1;
      }
      if (
        Array.isArray(result) &&
        result.length > 0 &&
        !result.some((p) => p.isAuthenticated)
      ) {
        process.exitCode = 1;
      }
    });
  });

program
  .command("mcp")
  .description("启动 MCP stdio 服务（同时监听 WebSocket 桥）")
  .action(async () => {
    await startMcpStdio();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
