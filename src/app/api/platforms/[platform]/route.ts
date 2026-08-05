import { NextResponse } from "next/server";
import {
  checkPlatformSession,
  connectPlatform,
  disconnectPlatform,
} from "@/lib/queue/session";
import { ALL_PLATFORM_IDS, type PlatformId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ platform: string }> };

function parsePlatform(raw: string): PlatformId | null {
  return ALL_PLATFORM_IDS.includes(raw as PlatformId)
    ? (raw as PlatformId)
    : null;
}

export async function POST(req: Request, ctx: Ctx) {
  const { platform: raw } = await ctx.params;
  const platform = parsePlatform(raw);
  if (!platform) {
    return NextResponse.json({ error: "未知平台" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  try {
    if (action === "connect") {
      const result = await connectPlatform(platform);
      return NextResponse.json(result);
    }
    if (action === "check") {
      const result = await checkPlatformSession(platform);
      return NextResponse.json(result);
    }
    if (action === "disconnect") {
      disconnectPlatform(platform);
      return NextResponse.json({ platform, status: "disconnected" });
    }
    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
