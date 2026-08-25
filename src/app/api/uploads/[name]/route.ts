import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { UPLOADS_DIR } from "@/lib/paths";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ name: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { name } = await ctx.params;
  if (name.includes("..") || name.includes("/")) {
    return NextResponse.json({ error: "非法路径" }, { status: 400 });
  }
  const file = path.join(UPLOADS_DIR, name);
  if (!fs.existsSync(file)) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
  const buf = fs.readFileSync(file);
  const ext = path.extname(name).toLowerCase();
  const type =
    ext === ".png"
      ? "image/png"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".svg"
            ? "image/svg+xml"
            : ext === ".mp3"
              ? "audio/mpeg"
            : ext === ".wav"
              ? "audio/wav"
              : ext === ".srt"
                ? "application/x-subrip; charset=utf-8"
            : ext === ".vtt"
                ? "text/vtt; charset=utf-8"
                : ext === ".mp4"
                  ? "video/mp4"
                  : ext === ".webm"
                    ? "video/webm"
                    : ext === ".mov"
                      ? "video/quicktime"
                : "application/octet-stream";
  return new NextResponse(buf, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
