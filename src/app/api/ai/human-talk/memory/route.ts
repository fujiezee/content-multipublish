import { requireApiUser } from "@/lib/auth/api";
import { listHumanTalkRules, setHumanTalkRuleEnabled } from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const rules = listHumanTalkRules(auth.ctx.workspaceId);
  return Response.json({
    rules: rules.map((row) => ({
      id: row.id,
      rule: row.rule,
      enabled: Boolean(row.enabled),
      hitCount: row.hit_count,
    })),
  });
}

export async function PATCH(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    enabled?: boolean;
  };
  const id = String(body.id || "").trim();
  if (!id) {
    return Response.json({ error: "没有这条规则" }, { status: 400 });
  }
  const next = setHumanTalkRuleEnabled(
    id,
    auth.ctx.workspaceId,
    body.enabled !== false,
  );
  if (!next) {
    return Response.json({ error: "没有这条规则" }, { status: 404 });
  }
  await persistCloudflareDb();
  return Response.json({
    rule: {
      id: next.id,
      rule: next.rule,
      enabled: Boolean(next.enabled),
      hitCount: next.hit_count,
    },
  });
}
