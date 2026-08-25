import { NextResponse } from "next/server";
import { resolveAuth, authRequired } from "@/lib/auth/session";
import { API_PUBLIC_BASE } from "@/lib/billing/markup";
import { ensureDefaultWorkspace } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/types";

function publicApiHostname(): string {
  try {
    return new URL(API_PUBLIC_BASE).hostname.toLowerCase();
  } catch {
    return "api.dianwu.ai";
  }
}

export function requestHostname(req: Request): string {
  const raw =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return raw.split(",")[0].trim().split(":")[0].toLowerCase();
}

export function isPublicModelApiHost(host: string): boolean {
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return true;
  }
  return host === publicApiHostname();
}

export function publicModelApiHostResponse(req: Request): NextResponse | null {
  if (isPublicModelApiHost(requestHostname(req))) return null;
  return NextResponse.json(
    {
      error: `模型 API 请使用 ${API_PUBLIC_BASE}`,
      baseUrl: API_PUBLIC_BASE,
    },
    { status: 403 },
  );
}

export async function requireApiUser(
  req?: Request,
): Promise<
  { ok: true; ctx: AuthContext } | { ok: false; response: NextResponse }
> {
  const ctx = await resolveAuth(req);
  if (ctx) return { ok: true, ctx };
  if (!authRequired()) {
    const ws = ensureDefaultWorkspace();
    return {
      ok: true,
      ctx: {
        userId: "local",
        workspaceId: ws.id,
        email: "local@dianwu.geo",
        displayName: "本地工作区",
      },
    };
  }
  return {
    ok: false,
    response: NextResponse.json({ error: "请先登录" }, { status: 401 }),
  };
}

/** OpenAI / 网关公开调用：只接受 api.dianwu.ai（本地开发除外） */
export async function requirePublicApiUser(req: Request) {
  const blocked = publicModelApiHostResponse(req);
  if (blocked) return { ok: false as const, response: blocked };
  return requireApiUser(req);
}
