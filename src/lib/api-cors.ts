import { NextResponse } from "next/server";

const ALLOW_HEADERS = "Authorization, Content-Type";
const ALLOW_METHODS = "GET, POST, OPTIONS";

/** 模型 API 对外 CORS（api.dianwu.ai / 第三方 SDK） */
export function corsHeaders(req?: Request): HeadersInit {
  const origin = req?.headers.get("origin")?.trim() || "*";
  return {
    "Access-Control-Allow-Origin": origin === "null" ? "*" : origin,
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function withCors(res: NextResponse, req?: Request): NextResponse {
  const headers = corsHeaders(req);
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value);
  }
  return res;
}

export function corsPreflight(req?: Request): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req),
  });
}
