import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/auth/admin";
import { ensureAiModelCatalogSeed, syncArkAiModels } from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 补种精选 + 从火山方舟 /models 同步，并写入刊例价 */
export async function POST() {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;
  try {
    ensureAiModelCatalogSeed();
    const result = await syncArkAiModels();
    await persistCloudflareDb();
    const base = `方舟拉取 ${result.fetched} 个，新增 ${result.inserted}，写价 ${result.priced}，跳过 ${result.skipped}`;
    return NextResponse.json({
      ok: true,
      message: result.warning ? `${base}（${result.warning}，已只回填刊例）` : base,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "同步失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
