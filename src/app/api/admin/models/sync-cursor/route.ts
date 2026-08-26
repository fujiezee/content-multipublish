import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/auth/admin";
import { ensureAiModelCatalogSeed, syncCursorAiModels } from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 补种精选 + 从 Cursor API /v1/models 同步 */
export async function POST() {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;
  try {
    ensureAiModelCatalogSeed();
    const result = await syncCursorAiModels();
    await persistCloudflareDb();
    return NextResponse.json({
      ok: true,
      message: `Cursor 拉取 ${result.fetched} 个，新增 ${result.inserted}，跳过 ${result.skipped}`,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "同步失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
