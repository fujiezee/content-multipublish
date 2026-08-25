import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireApiUser } from "@/lib/auth/api";
import { streamDistillWriterAgent } from "@/lib/ai/writer-agent";
import {
  createWriterAgent,
  findWriterAgentBySeed,
  listWriterAgents,
  updateWriterAgent,
} from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_AGENTS = 20;

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({
    items: listWriterAgents(auth.ctx.workspaceId),
  });
}

function persistWriter(input: {
  workspaceId: string;
  seed: string;
  name: string;
  hint: string;
  instruction: string;
}) {
  const seed = input.seed.replace(/\s+/g, " ").trim();
  const name = input.name.trim().slice(0, 16);
  const hint = input.hint.trim().slice(0, 24);
  const instruction = input.instruction.trim();
  if (seed.length < 2) {
    throw new Error("写个名字，比如司马生");
  }
  if (!name) throw new Error("写手还没有名字");
  if (instruction.length < 40) throw new Error("提示词太短，先蒸馏完整再保存");

  const existing = findWriterAgentBySeed(input.workspaceId, seed);
  const now = new Date().toISOString();
  if (existing) {
    const item = updateWriterAgent(existing.id, {
      name,
      seed,
      hint,
      instruction,
    });
    return { item, updated: true };
  }
  if (listWriterAgents(input.workspaceId).length >= MAX_AGENTS) {
    throw new Error(`写手最多 ${MAX_AGENTS} 个，先删一个再用`);
  }
  const item = {
    id: randomUUID(),
    workspace_id: input.workspaceId,
    name,
    seed,
    hint,
    instruction,
    created_at: now,
    updated_at: now,
  };
  createWriterAgent(item);
  return { item, updated: false };
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const seed = typeof body.seed === "string" ? body.seed.replace(/\s+/g, " ").trim() : "";

  if (body.save === true) {
    try {
      const saved = persistWriter({
        workspaceId: auth.ctx.workspaceId,
        seed,
        name: typeof body.name === "string" ? body.name : "",
        hint: typeof body.hint === "string" ? body.hint : "",
        instruction: typeof body.instruction === "string" ? body.instruction : "",
      });
      return NextResponse.json(saved, { status: saved.updated ? 200 : 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败";
      const status = /太短|没有名字|写个名字|最多/.test(message) ? 400 : 500;
      return NextResponse.json({ error: message }, { status });
    }
  }

  if (seed.length < 2) {
    return NextResponse.json({ error: "写个名字，比如司马生" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        for await (const event of streamDistillWriterAgent(seed, {
          signal: abort.signal,
        })) {
          send(event);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "蒸馏失败";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
