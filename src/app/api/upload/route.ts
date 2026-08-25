import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { isCloudflareRuntime, UPLOADS_DIR, ensureDataDirs } from "@/lib/paths";
import { uploadPublicMedia } from "@/lib/storage/public-media";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  ensureDataDirs();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  }

  const ext = path.extname(file.name) || ".png";
  const name = `${randomUUID()}${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const publicUrl = await uploadPublicMedia({
    bytes: buf,
    filename: name,
    contentType: file.type || undefined,
  });
  if (!publicUrl && isCloudflareRuntime()) {
    return NextResponse.json({ error: "图床上传失败" }, { status: 502 });
  }
  if (!isCloudflareRuntime()) {
    ensureDataDirs();
    fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
  }

  return NextResponse.json({
    path: publicUrl || `data/uploads/${name}`,
    // Prefer public CDN so platform draft fetchers (Zhihu etc.) can pull images.
    url: publicUrl || `/api/uploads/${name}`,
    localUrl: publicUrl || `/api/uploads/${name}`,
  });
}
