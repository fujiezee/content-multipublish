import {
  getDoubaoStoredSecret,
  getMentionSettings,
  insertMentionRun,
  listMentionRuns,
  saveMentionSettings,
} from "@/lib/db";
import {
  listConfiguredMentionSources,
  runMentionProbe,
  scorePastedAnswer,
} from "@/lib/ai/mention-check";
import { resolveDeepSeekConfig } from "@/lib/ai/deepseek";
import {
  resolveDoubaoConfig,
} from "@/lib/ai/doubao";
import type { MentionProbeSource, MentionSource } from "@/lib/types";
import { requireApiUser } from "@/lib/auth/api";
import { consumeOrRespond, refundQuota } from "@/lib/billing/account";
import { parseListPage, slicePage } from "@/lib/list-page";

export const runtime = "nodejs";
export const maxDuration = 180;

function parseStringList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max);
}

function parseSource(raw: unknown): MentionSource {
  if (
    raw === "doubao" ||
    raw === "yuanbao" ||
    raw === "qwen" ||
    raw === "other"
  ) {
    return raw;
  }
  return "other";
}

function parseProbeSources(raw: unknown): MentionProbeSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is MentionProbeSource => x === "deepseek" || x === "doubao");
}

function configuredPayload() {
  const stored = getDoubaoStoredSecret();
  return {
    deepseek: Boolean(resolveDeepSeekConfig()),
    doubao: Boolean(resolveDoubaoConfig(stored)),
    sources: listConfiguredMentionSources(stored),
  };
}

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { limit, offset } = parseListPage(new URL(req.url));
  const rows = listMentionRuns(limit + 1, auth.ctx.workspaceId, offset);
  const page = slicePage(rows, limit, offset);
  return Response.json({
    settings: offset === 0 ? getMentionSettings() : undefined,
    runs: page.items,
    nextOffset: page.nextOffset,
    hasMore: page.hasMore,
    configured: offset === 0 ? configuredPayload() : undefined,
  });
}

export async function PUT(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const settings = saveMentionSettings({
    brands: parseStringList(record.brands, 12),
    questions: parseStringList(record.questions, 8),
  });
  return Response.json({
    settings,
    configured: configuredPayload(),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const action = record.action === "score" ? "score" : "run";
  const settings = getMentionSettings();

  const denied = consumeOrRespond(
    auth.ctx.workspaceId,
    "mentions",
    1,
    null,
    auth.ctx.email,
  );
  if (denied) return denied;

  try {
    if (action === "score") {
      const result = scorePastedAnswer({
        question:
          typeof record.question === "string" ? record.question : "",
        answer: typeof record.answer === "string" ? record.answer : "",
        brands: settings.brands,
        source: parseSource(record.source),
      });
      const run = insertMentionRun({
        model: `pasted:${result.source}`,
        results: [result],
        workspaceId: auth.ctx.workspaceId,
      });
      return Response.json({ run });
    }

    const questions = parseStringList(record.questions, 8);
    const brands = parseStringList(record.brands, 12);
    const probe = await runMentionProbe({
      brands: brands.length ? brands : settings.brands,
      questions: questions.length ? questions : settings.questions,
      sources: parseProbeSources(record.sources),
      doubaoStored: getDoubaoStoredSecret(),
    });
    if (probe.doubaoModel) {
      saveMentionSettings({
        brands: settings.brands,
        questions: settings.questions,
        doubaoModel: probe.doubaoModel,
      });
    }
    const run = insertMentionRun({
      ...probe,
      workspaceId: auth.ctx.workspaceId,
    });
    return Response.json({ run, doubaoModel: probe.doubaoModel });
  } catch (err) {
    refundQuota(auth.ctx.workspaceId, "mentions", 1, null, auth.ctx.email);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }
}
