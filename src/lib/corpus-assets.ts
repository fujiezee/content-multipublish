import { splitHtmlBlocks } from "@/lib/ai/infographic-insert";
import type { CorpusAsset, CorpusAssetKind, CorpusItem } from "@/lib/types";

function newAssetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const MAX_CORPUS_ASSETS = 12;

export function parseCorpusAssets(raw: unknown): CorpusAsset[] {
  let list: unknown[] = [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw || "[]") as unknown;
      list = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  }
  const out: CorpusAsset[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!url) continue;
    const kind: CorpusAssetKind = o.kind === "image" ? "image" : "screenshot";
    out.push({
      id: typeof o.id === "string" && o.id.trim() ? o.id.trim() : newAssetId(),
      url,
      path: typeof o.path === "string" && o.path.trim() ? o.path.trim() : undefined,
      caption: typeof o.caption === "string" ? o.caption.trim() : "",
      kind,
    });
    if (out.length >= MAX_CORPUS_ASSETS) break;
  }
  return out;
}

export function serializeCorpusAssets(assets: CorpusAsset[] | undefined): string {
  return JSON.stringify(parseCorpusAssets(assets));
}

export function corpusAssetsHay(item: Pick<CorpusItem, "assets">): string {
  return (item.assets || []).map((asset) => asset.caption).join(" ");
}

export function formatCorpusAssetsBlock(
  item: CorpusItem,
  mode: "markdown" | "caption",
): string {
  const assets = (item.assets || []).filter((asset) => asset.url);
  if (!assets.length) return "";
  if (mode === "caption") {
    return assets
      .map((asset, i) => {
        const kind = asset.kind === "screenshot" ? "截图" : "图片";
        return `- 配图${i + 1}（${kind}）：${asset.caption || "（无说明）"}`;
      })
      .join("\n");
  }
  return [
    "配图（必须原样插入下面 Markdown，URL 一字不改；说明是图里有什么）：",
    ...assets.map((asset, i) => {
      const kind = asset.kind === "screenshot" ? "截图" : "图片";
      const cap = asset.caption || `语料配图${i + 1}`;
      return `${i + 1}. [${kind}] ${cap}\n   ![${cap}](${asset.url})`;
    }),
  ].join("\n");
}

export function collectCorpusAssets(items: CorpusItem[]): CorpusAsset[] {
  return items.flatMap((item) =>
    (item.assets || []).filter((asset) => asset.url && asset.caption),
  );
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function corpusAssetHtml(asset: CorpusAsset): string {
  const alt = escapeAttr(asset.caption);
  const src = escapeAttr(asset.url);
  return `<p><img src="${src}" alt="${alt}" data-corpus-asset="1"></p><p><em>${escapeAttr(asset.caption)}</em></p>`;
}

function captionTokens(caption: string): string[] {
  const parts = caption
    .replace(/[^\u4e00-\u9fffA-Za-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
  const extra: string[] = [];
  for (const part of parts) {
    if (part.length >= 4 && /[\u4e00-\u9fff]/.test(part)) {
      for (let i = 0; i < part.length - 1; i++) {
        extra.push(part.slice(i, i + 2));
      }
    }
  }
  return [...new Set([...parts, ...extra])].slice(0, 16);
}

function placeAfterMatch(html: string, caption: string, block: string): string | null {
  const tokens = captionTokens(caption);
  if (!tokens.length) return null;
  const blocks = splitHtmlBlocks(html);
  let best = -1;
  let bestHits = 0;
  for (let i = 0; i < blocks.length; i++) {
    const text = blocks[i].replace(/<[^>]+>/g, " ");
    const hits = tokens.filter((token) => text.includes(token)).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = i;
    }
  }
  if (best < 0 || bestHits === 0) return null;
  const next = [...blocks];
  next.splice(best + 1, 0, block);
  return next.join("\n");
}

/** Put unused corpus images into generated HTML, near the matching paragraph. */
export function insertCorpusAssetsIntoHtml(
  html: string,
  items: CorpusItem[],
): string {
  let next = html || "";
  for (const item of items) {
    for (const asset of item.assets || []) {
      if (!asset.url || !asset.caption) continue;
      if (next.includes(asset.url)) continue;
      const hint = [asset.caption, item.title, item.content.slice(0, 120)].join(
        " ",
      );
      const block = corpusAssetHtml(asset);
      next = placeAfterMatch(next, hint, block) ?? `${next.trim()}\n${block}`;
    }
  }
  return next;
}
