import { NextResponse } from "next/server";
import { requirePublicApiUser } from "@/lib/auth/api";
import { listOpenAiModels } from "@/lib/ai/gateway/openai-compat";
import { corsPreflight, withCors } from "@/lib/api-cors";

export const runtime = "nodejs";

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

/** OpenAI 兼容：GET /v1/models */
export async function GET(req: Request) {
  const auth = await requirePublicApiUser(req);
  if (!auth.ok) return withCors(auth.response, req);
  return withCors(NextResponse.json(listOpenAiModels()), req);
}
