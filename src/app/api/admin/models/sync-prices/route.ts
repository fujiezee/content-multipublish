import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/auth/admin";
import { ensureAiModelCatalogSeed, syncOfficialAiModelPricing } from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";

/** 按内置刊例表回填全部模型官方价 */
export async function POST() {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;
  try {
    ensureAiModelCatalogSeed();
    const result = syncOfficialAiModelPricing();
    await persistCloudflareDb();
    return NextResponse.json({
      ok: true,
      message: `价格回填 ${result.priced}/${result.total}，跳过 ${result.skipped}${
        result.disabled ? `，停用退役 ${result.disabled}` : ""
      }`,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "同步失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
