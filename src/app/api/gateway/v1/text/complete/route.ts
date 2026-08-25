import { NextResponse } from "next/server";
import { requirePublicApiUser } from "@/lib/auth/api";
import {
  gatewayTextComplete,
  parseGatewayTextBody,
} from "@/lib/ai/gateway";
import {
  peekTextChargeOrRespond,
  settleTextCharge,
} from "@/lib/billing/api-charge";
import { corsPreflight, withCors } from "@/lib/api-cors";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

export async function POST(req: Request) {
  const auth = await requirePublicApiUser(req);
  if (!auth.ok) return withCors(auth.response, req);

  const body = await req.json().catch(() => ({}));
  const { modelSlug, messages, temperature, maxTokens, timeoutMs } =
    parseGatewayTextBody(body);

  if (!modelSlug) {
    return withCors(
      NextResponse.json({ error: "请指定 model（目录 slug）" }, { status: 400 }),
      req,
    );
  }
  if (!messages.length) {
    return withCors(
      NextResponse.json({ error: "messages 不能为空" }, { status: 400 }),
      req,
    );
  }

  const peek = peekTextChargeOrRespond(
    auth.ctx.workspaceId,
    modelSlug,
    messages,
    maxTokens,
  );
  if (!peek.ok) return withCors(peek.response, req);

  try {
    const text = await gatewayTextComplete(modelSlug, messages, {
      temperature,
      maxTokens,
      timeoutMs,
    });
    const settled = settleTextCharge(
      auth.ctx.workspaceId,
      modelSlug,
      peek.promptTokens,
      text,
      peek.paidYuan,
      auth.ctx.email,
    );
    if (!settled.ok) {
      return withCors(
        walletOrQuotaJson(settled.error),
        req,
      );
    }
    await persistCloudflareDb();
    return withCors(
      NextResponse.json({
        model: modelSlug,
        text,
        usage: {
          prompt_tokens: settled.usage.promptTokens,
          completion_tokens: settled.usage.completionTokens,
          total_tokens: settled.usage.totalTokens,
        },
        chargedFen: settled.fen,
      }),
      req,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return withCors(NextResponse.json({ error: message }, { status: 500 }), req);
  }
}

function walletOrQuotaJson(error: string) {
  return NextResponse.json(
    { error, code: "quota", kind: "wallet" },
    { status: 402 },
  );
}
