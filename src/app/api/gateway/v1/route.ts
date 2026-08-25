import { NextResponse } from "next/server";
import { requirePublicApiUser } from "@/lib/auth/api";
import { gatewayOpenApiSpec } from "@/lib/ai/gateway";
import { corsPreflight, withCors } from "@/lib/api-cors";

export const runtime = "nodejs";

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

/** 网关能力说明（OpenAPI 雏形） */
export async function GET(req: Request) {
  const auth = await requirePublicApiUser(req);
  if (!auth.ok) return withCors(auth.response, req);
  return withCors(NextResponse.json(gatewayOpenApiSpec()), req);
}
