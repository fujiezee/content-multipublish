import { parseArticleFile } from "../article.js";
import {
  ensureSharedBridgeStarted,
  type BridgeServer,
} from "../bridge-server.js";
import type { SyncArticleParams } from "../protocol.js";

export type SyncResultItem = {
  platform?: string;
  success?: boolean;
  postUrl?: string;
  url?: string;
  error?: string;
  [key: string]: unknown;
};

export async function runSync(options: {
  file: string;
  platforms: string[];
  title?: string;
  cover?: string;
  dryRun?: boolean;
  bridge?: BridgeServer;
  waitExtensionMs?: number;
}): Promise<SyncResultItem[]> {
  const platforms = options.platforms.map((p) => p.trim()).filter(Boolean);
  if (!platforms.length) {
    throw new Error("请用 -p/--platforms 指定至少一个平台，例如 -p zhihu,juejin");
  }

  const article = parseArticleFile(options.file, {
    title: options.title,
    cover: options.cover,
  });

  const params: SyncArticleParams = {
    platforms,
    article: {
      title: article.title,
      markdown: article.markdown || undefined,
      content: article.content || undefined,
      cover: article.cover,
    },
  };

  if (options.dryRun) {
    console.log(JSON.stringify({ dryRun: true, ...params }, null, 2));
    return [];
  }

  const bridge = options.bridge ?? (await ensureSharedBridgeStarted());
  await bridge.waitForExtension(options.waitExtensionMs);

  const results = await bridge.call<SyncResultItem[]>("syncArticle", params);
  return Array.isArray(results) ? results : [];
}

export function printSyncResults(results: SyncResultItem[]) {
  if (!results.length) {
    console.log("无结果");
    return;
  }
  let ok = 0;
  let fail = 0;
  for (const r of results) {
    const platform = r.platform || "?";
    if (r.success) {
      ok++;
      const url = r.postUrl || r.url || "";
      console.log(`✓ ${platform}${url ? `  ${url}` : ""}`);
    } else {
      fail++;
      console.log(`✗ ${platform}  ${r.error || "失败"}`);
    }
  }
  console.log(`\n完成：${ok} 成功 / ${fail} 失败`);
}
