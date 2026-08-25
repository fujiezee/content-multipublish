import { NextResponse } from "next/server";
import { requirePublicApiUser } from "@/lib/auth/api";
import {
  gatewayImageGenerate,
  parseGatewayImageBody,
} from "@/lib/ai/gateway";
import { corsPreflight, withCors } from "@/lib/api-cors";
import { consumeOrRespond, refundQuota } from "@/lib/billing/account";
import { publicModelUnavailableResponse } from "@/lib/billing/api-charge";

export const runtime = "nodejs";
export const maxDuration = 300;

function pathFromUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/api/uploads/")) {
    return `data/uploads/${url.split("/").pop()}`;
  }
  return url;
}

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

export async function POST(req: Request) {
  const auth = await requirePublicApiUser(req);
  if (!auth.ok) return withCors(auth.response, req);

  const body = await req.json().catch(() => ({}));
  const { modelSlug, prompt, aspectRatio } = parseGatewayImageBody(body);

  if (!modelSlug) {
    return withCors(
      NextResponse.json({ error: "请指定 model（目录 slug）" }, { status: 400 }),
      req,
    );
  }
  if (!prompt) {
    return withCors(
      NextResponse.json({ error: "prompt 不能为空" }, { status: 400 }),
      req,
    );
  }

  const hidden = publicModelUnavailableResponse(modelSlug);
  if (hidden) return withCors(hidden, req);

  const denied = consumeOrRespond(
    auth.ctx.workspaceId,
    "images",
    1,
    modelSlug,
    auth.ctx.email,
  );
  if (denied) return withCors(denied, req);

  try {
    const out = await gatewayImageGenerate(modelSlug, { prompt, aspectRatio });
    return withCors(
      NextResponse.json({
        slug: out.slug,
        model: out.model,
        provider: out.provider,
        url: out.url,
        path: pathFromUrl(out.url),
        aspectRatio: aspectRatio || null,
      }),
      req,
    );
  } catch (err) {
    refundQuota(auth.ctx.workspaceId, "images", 1, modelSlug, auth.ctx.email);
    const message = err instanceof Error ? err.message : "生图失败";
    return withCors(NextResponse.json({ error: message }, { status: 500 }), req);
  }
}
