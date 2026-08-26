import { requireApiUser } from "@/lib/auth/api";
import { withHumanTalk } from "@/lib/ai/human-talk-agent";
import { recordHumanTalkRevision } from "@/lib/ai/human-talk-memory";
import { reviseHumanTalkDraft } from "@/lib/ai/human-talk-revise";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";

export const runtime = "nodejs";
export const maxDuration = 180;

const KINDS = new Set(["article", "podcast", "script"]);

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as {
    kind?: string;
    text?: string;
    message?: string;
    reviewModel?: string;
  };
  const kind = KINDS.has(String(body.kind || ""))
    ? (body.kind as "article" | "podcast" | "script")
    : "article";
  const text = String(body.text || "").trim();
  const message = String(body.message || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return Response.json({ error: "没有可改的稿" }, { status: 400 });
  }
  if (!message) {
    return Response.json({ error: "说哪句假、接不上" }, { status: 400 });
  }

  try {
    const result = await withHumanTalk(
      auth.ctx.workspaceId,
      body.reviewModel,
      () => reviseHumanTalkDraft({ kind, text, message }),
    );
    let rule = result.rule;
    if (result.changed) {
      rule =
        recordHumanTalkRevision({
          workspaceId: auth.ctx.workspaceId,
          kind,
          before: text,
          after: result.text,
          rule,
          userNote: message,
        }).rule || rule;
      await persistCloudflareDb();
    }
    return Response.json({
      text: result.text,
      changed: result.changed,
      rule,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "改稿失败";
    return Response.json({ error: detail }, { status: 500 });
  }
}
