import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { UPLOADS_DIR, ensureDataDirs } from "@/lib/paths";
import { uploadPublicMedia } from "@/lib/storage/public-media";

export const runtime = "nodejs";

export async function POST(req: Request) {
  ensureDataDirs();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  }

  const ext = path.extname(file.name) || ".png";
  const name = `${randomUUID()}${ext}`;
  const dest = path.join(UPLOADS_DIR, name);
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(dest, buf);

  const publicUrl = await uploadPublicMedia({
    bytes: buf,
    filename: name,
    contentType: file.type || undefined,
  });

  return NextResponse.json({
    path: `data/uploads/${name}`,
    // Prefer public CDN so platform draft fetchers (Zhihu etc.) can pull images.
    url: publicUrl || `/api/uploads/${name}`,
    localUrl: `/api/uploads/${name}`,
  });
}
