import { NextResponse } from "next/server";
import { requirePublicApiUser } from "@/lib/auth/api";
import { gatewayVideoModels, gatewayVideoPresets } from "@/lib/ai/gateway";
import { corsPreflight, withCors } from "@/lib/api-cors";

export const runtime = "nodejs";

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

/** 视频模型目录 + 可用 preset（480/720 组合） */
export async function GET(req: Request) {
  const auth = await requirePublicApiUser(req);
  if (!auth.ok) return withCors(auth.response, req);

  const [models, presets] = await Promise.all([
    Promise.resolve(gatewayVideoModels()),
    gatewayVideoPresets(),
  ]);

  return withCors(NextResponse.json({ models, presets }), req);
}
