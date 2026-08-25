import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/auth/admin";
import { ensureAiModelCatalogSeed, syncCloudflareAiModels } from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 补种精选 + 从 Cloudflare 统一目录 /ai/catalog/models 与 Workers AI /models/search 同步 */
export async function POST() {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;
  try {
    ensureAiModelCatalogSeed();
    const result = await syncCloudflareAiModels();
    await persistCloudflareDb();
    return NextResponse.json({
      ok: true,
      message: `Cloudflare 拉取 ${result.fetched} 个，新增 ${result.inserted}，更新 ${result.updated}，跳过 ${result.skipped}。含统一目录（第三方视频/图/文）和 Workers AI 托管模型。`,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "同步失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
