import { requirePublicApiUser } from "@/lib/auth/api";
import {
  gatewayTextStream,
  parseGatewayTextBody,
} from "@/lib/ai/gateway";
import {
  peekTextChargeOrRespond,
  settleTextCharge,
} from "@/lib/billing/api-charge";
import { corsHeaders, corsPreflight, withCors } from "@/lib/api-cors";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import { NextResponse } from "next/server";

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

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const workspaceId = auth.ctx.workspaceId;
  const email = auth.ctx.email;
  const promptTokens = peek.promptTokens;
  const paidYuan = peek.paidYuan;

  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      send({ type: "meta", model: modelSlug });

      let thinking = "";
      let content = "";
      let finishReason: string | undefined;
      try {
        for await (const chunk of gatewayTextStream(modelSlug, messages, {
          temperature,
          maxTokens,
          timeoutMs,
          signal: abort.signal,
        })) {
          if (chunk.type === "thinking") {
            thinking += chunk.text;
            send({ type: "thinking", delta: chunk.text });
          } else if (chunk.type === "content") {
            content += chunk.text;
            send({ type: "content", delta: chunk.text });
          } else if (chunk.type === "finish") {
            finishReason = chunk.reason;
          }
        }
        const settled = settleTextCharge(
          workspaceId,
          modelSlug,
          promptTokens,
          content,
          paidYuan,
          email,
        );
        if (!settled.ok) {
          send({ type: "error", message: settled.error, code: "quota" });
        } else {
          await persistCloudflareDb();
          send({
            type: "done",
            text: content,
            thinking: thinking || undefined,
            finishReason,
            usage: {
              prompt_tokens: settled.usage.promptTokens,
              completion_tokens: settled.usage.completionTokens,
              total_tokens: settled.usage.totalTokens,
            },
            chargedFen: settled.fen,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  const headers = new Headers(corsHeaders(req));
  headers.set("Content-Type", "application/x-ndjson; charset=utf-8");
  headers.set("Cache-Control", "no-cache, no-transform");
  headers.set("Connection", "keep-alive");
  headers.set("X-Accel-Buffering", "no");

  return new Response(readable, { headers });
}
