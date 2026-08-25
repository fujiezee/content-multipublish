import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { LATEST_EXTENSION_VERSION } from "@/lib/extension-release";
import { zipFolder } from "@/lib/zip-folder";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  if (process.env.CLOUDFLARE === "1") {
    return NextResponse.redirect(
      new URL(`/dianwu-geo.zip?v=${encodeURIComponent(LATEST_EXTENSION_VERSION)}`, origin),
      302,
    );
  }

  const packed = join(process.cwd(), "public/dianwu-geo.zip");
  const root = join(process.cwd(), "tools/dianwu-geo");
  let version = "dev";
  let body: Uint8Array | null = null;

  try {
    const manifest = JSON.parse(
      readFileSync(join(root, "manifest.json"), "utf8"),
    ) as { version?: string };
    if (manifest.version) version = manifest.version;
    body = Uint8Array.from(zipFolder(root));
  } catch {
    if (existsSync(packed)) {
      body = Uint8Array.from(readFileSync(packed));
    }
  }

  if (!body) {
    return NextResponse.redirect(
      new URL(`/dianwu-geo.zip?v=${encodeURIComponent(LATEST_EXTENSION_VERSION)}`, origin),
      302,
    );
  }

  return new NextResponse(Buffer.from(body), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="dianwu-geo-${version}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
