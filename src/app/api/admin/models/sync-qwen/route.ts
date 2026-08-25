import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/auth/admin";
import { ensureAiModelCatalogSeed, syncQwenAiModels } from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 补种精选 + 从阿里云百炼 MaaS /models 同步 */
export async function POST() {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;
  try {
    ensureAiModelCatalogSeed();
    const result = await syncQwenAiModels();
    await persistCloudflareDb();
    return NextResponse.json({
      ok: true,
      message: `千问拉取 ${result.fetched} 个，新增 ${result.inserted}，跳过 ${result.skipped}`,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "同步失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
