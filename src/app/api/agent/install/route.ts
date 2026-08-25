import { chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { NextResponse } from "next/server";
import {
  AGENT_PAIR_TTL_MS,
  formatPairCode,
  isLoopbackOrigin,
  originFromRequest,
} from "@/lib/agent";
import { writeAgentHelperFolder } from "@/lib/agent-pack";
import { requireAuth } from "@/lib/auth/session";
import { resolveOwnerUserId } from "@/lib/auth/owner";
import { createAgentPairCode } from "@/lib/db";

export const runtime = "nodejs";

function desktopHelperDir() {
  return join(homedir(), "Desktop", "点物助手");
}

export async function POST(req: Request) {
  const ctx = await requireAuth(req);
  if (!ctx) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const ownerId = resolveOwnerUserId(ctx);
  if (!ownerId) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const origin = originFromRequest(req);
  if (!isLoopbackOrigin(origin) || process.platform !== "darwin") {
    return NextResponse.json({ needDownload: true });
  }

  const expiresAt = new Date(Date.now() + AGENT_PAIR_TTL_MS).toISOString();
  const row = createAgentPairCode({
    workspaceId: ctx.workspaceId,
    userId: ownerId,
    expiresAt,
  });
  const dest = desktopHelperDir();
  writeAgentHelperFolder(dest, {
    url: origin,
    code: formatPairCode(row.code),
  });
  const command = join(dest, "打开点物助手.command");
  chmodSync(command, 0o755);
  chmodSync(join(dest, "helper.py"), 0o755);
  try {
    execFileSync("xattr", ["-cr", dest], { stdio: "ignore" });
  } catch {
    // 没有隔离标记也没关系
  }
  try {
    execFileSync("open", ["-a", "Terminal", command], { stdio: "ignore" });
  } catch {
    execFileSync("open", [dest], { stdio: "ignore" });
    return NextResponse.json({
      path: dest,
      opened: false,
    });
  }
  return NextResponse.json({
    path: dest,
    opened: true,
  });
}
