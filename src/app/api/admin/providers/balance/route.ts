import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/auth/admin";
import { listProviderBalances } from "@/lib/ai/provider-balance";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;
  try {
    const providers = await listProviderBalances();
    return NextResponse.json({
      providers,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "查询失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
