import { NextResponse } from "next/server";
import { requirePublicApiUser } from "@/lib/auth/api";
import {
  openAiChatComplete,
  openAiChatStreamChunks,
  parseOpenAiChatBody,
} from "@/lib/ai/gateway/openai-compat";
import {
  peekTextChargeOrRespond,
  settleTextCharge,
} from "@/lib/billing/api-charge";
import { corsHeaders, corsPreflight, withCors } from "@/lib/api-cors";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

/** OpenAI 兼容：POST /v1/chat/completions */
export async function POST(req: Request) {
  const auth = await requirePublicApiUser(req);
  if (!auth.ok) return withCors(auth.response, req);

  const body = await req.json().catch(() => ({}));
  const { model, messages, stream, temperature, maxTokens } =
    parseOpenAiChatBody(body);

  if (!model) {
    return withCors(
      NextResponse.json(
        {
          error: {
            message: "model is required",
            type: "invalid_request_error",
          },
        },
        { status: 400 },
      ),
      req,
    );
  }
  if (!messages.length) {
    return withCors(
      NextResponse.json(
        {
          error: {
            message: "messages is required",
            type: "invalid_request_error",
          },
        },
        { status: 400 },
      ),
      req,
    );
  }

  const peek = peekTextChargeOrRespond(
    auth.ctx.workspaceId,
    model,
    messages,
    maxTokens,
  );
  if (!peek.ok) {
    const payload = await peek.response.clone().json().catch(() => ({}));
    const message =
      typeof (payload as { error?: string }).error === "string"
        ? (payload as { error: string }).error
        : "余额不足";
    return withCors(
      NextResponse.json(
        {
          error: {
            message,
            type:
              peek.response.status === 404
                ? "invalid_request_error"
                : "insufficient_quota",
            code: peek.response.status === 404 ? "model_not_found" : "quota",
          },
        },
        { status: peek.response.status },
      ),
      req,
    );
  }

  if (!stream) {
    try {
      const out = await openAiChatComplete({
        model,
        messages,
        temperature,
        maxTokens,
      });
      const settled = settleTextCharge(
        auth.ctx.workspaceId,
        model,
        peek.promptTokens,
        out.choices[0]?.message?.content || "",
        peek.paidYuan,
        auth.ctx.email,
      );
      if (!settled.ok) {
        return withCors(
          NextResponse.json(
            {
              error: {
                message: settled.error,
                type: "insufficient_quota",
                code: "quota",
              },
            },
            { status: 402 },
          ),
          req,
        );
      }
      await persistCloudflareDb();
      out.usage = {
        prompt_tokens: settled.usage.promptTokens,
        completion_tokens: settled.usage.completionTokens,
        total_tokens: settled.usage.totalTokens,
      };
      return withCors(NextResponse.json(out), req);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return withCors(
        NextResponse.json(
          { error: { message, type: "api_error" } },
          { status: 500 },
        ),
        req,
      );
    }
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const workspaceId = auth.ctx.workspaceId;
  const email = auth.ctx.email;
  const promptTokens = peek.promptTokens;
  const paidYuan = peek.paidYuan;

  const readable = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      };
      let content = "";
      try {
        for await (const chunk of openAiChatStreamChunks({
          model,
          messages,
          temperature,
          maxTokens,
          signal: abort.signal,
        })) {
          const delta = chunk.choices?.[0]?.delta as
            | { content?: string }
            | undefined;
          if (typeof delta?.content === "string") content += delta.content;
          send(chunk);
        }
        const settled = settleTextCharge(
          workspaceId,
          model,
          promptTokens,
          content,
          paidYuan,
          email,
        );
        if (!settled.ok) {
          send({
            error: {
              message: settled.error,
              type: "insufficient_quota",
              code: "quota",
            },
          });
        } else {
          await persistCloudflareDb();
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ error: { message, type: "api_error" } });
      } finally {
        controller.close();
      }
    },
  });

  const headers = new Headers(corsHeaders(req));
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache, no-transform");
  headers.set("Connection", "keep-alive");
  headers.set("X-Accel-Buffering", "no");

  return new Response(readable, { headers });
}
