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
          : "application/octet-stream";
  return new NextResponse(buf, {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000" },
  });
}
