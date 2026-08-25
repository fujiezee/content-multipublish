import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import {
  AGENT_PAIR_TTL_MS,
  formatPairCode,
  originFromRequest,
} from "@/lib/agent";
import { writeAgentHelperFolder } from "@/lib/agent-pack";
import { requireAuth } from "@/lib/auth/session";
import { resolveOwnerUserId } from "@/lib/auth/owner";
import { createAgentPairCode } from "@/lib/db";
import { zipFolder } from "@/lib/zip-folder";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ctx = await requireAuth(req);
  if (!ctx) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const ownerId = resolveOwnerUserId(ctx);
  if (!ownerId) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const origin = originFromRequest(req);
  const expiresAt = new Date(Date.now() + AGENT_PAIR_TTL_MS).toISOString();
  const row = createAgentPairCode({
    workspaceId: ctx.workspaceId,
    userId: ownerId,
    expiresAt,
  });
  const tmp = mkdtempSync(join(tmpdir(), "dw-agent-"));
  const dest = join(tmp, "点物助手");
  try {
    writeAgentHelperFolder(dest, {
      url: origin,
      code: formatPairCode(row.code),
    });
    const body = Uint8Array.from(
      zipFolder(tmp, {
        executable: (name) => name.endsWith(".command"),
      }),
    );
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition":
          "attachment; filename=\"dianwu-helper.zip\"; filename*=UTF-8''%E7%82%B9%E7%89%A9%E5%8A%A9%E6%89%8B.zip",
        "Cache-Control": "no-store",
      },
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
