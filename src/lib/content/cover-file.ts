import fs from "fs";
import path from "path";
import { DATA_DIR, UPLOADS_DIR } from "@/lib/paths";

/** Resolve a stored cover_path to a local file Playwright can upload. */
export function resolveCoverFile(
  coverPath: string | null | undefined,
): string | null {
  if (!coverPath?.trim()) return null;
  const raw = coverPath.trim();
  if (/^https?:\/\//i.test(raw) && !/\/api\/uploads\//i.test(raw)) {
    return null;
  }
  const name = raw
    .replace(/^\/?api\/uploads\//, "")
    .replace(/^\/?data\/uploads\//, "")
    .split("/")
    .pop();
  const candidates = [
    raw,
    path.join(process.cwd(), raw.replace(/^\//, "")),
    path.join(DATA_DIR, raw.replace(/^\/?data\//, "")),
    name ? path.join(UPLOADS_DIR, name) : "",
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {
      // skip
    }
  }
  return null;
}

/** Absolute URL the extension / remote platforms can fetch. */
export function coverPublicUrl(
  coverPath: string | null | undefined,
  origin: string,
): string | undefined {
  if (!coverPath?.trim()) return undefined;
  const raw = coverPath.trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `${origin.replace(/\/$/, "")}${raw}`;
  const name = raw.split("/").pop();
  return name ? `${origin.replace(/\/$/, "")}/api/uploads/${name}` : undefined;
}
