import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  resolvePublicOrigin,
  rewritePublicMediaUrl,
  toAbsoluteMediaUrl,
} from "@/lib/content/media-urls";
import { isCloudflareRuntime, UPLOADS_DIR, ensureDataDirs } from "@/lib/paths";

/** Upload local bytes to the Dianwu CDN (cdn.dianwu.ai/upload → R2). */
export function publicMediaConfigured(): boolean {
  return Boolean(
    process.env.PUBLIC_MEDIA_UPLOAD_URL?.trim() &&
      process.env.PUBLIC_MEDIA_TOKEN?.trim(),
  );
}

export function publicMediaBaseUrl(): string {
  return (
    process.env.PUBLIC_MEDIA_BASE_URL?.trim().replace(/\/$/, "") ||
    "https://cdn.dianwu.ai/files"
  );
}

/** Prefer cdn.dianwu.ai even if the upload API still returns files.vigma.app. */
function toPublicCdnUrl(url: string): string {
  return rewritePublicMediaUrl(url);
}

function uploadEndpoint(): string {
  return (
    process.env.PUBLIC_MEDIA_UPLOAD_URL?.trim() ||
    "https://cdn.dianwu.ai/upload"
  );
}

function uploadToken(): string {
  return process.env.PUBLIC_MEDIA_TOKEN?.trim() || "";
}

export async function uploadPublicMedia(input: {
  bytes: Buffer | Uint8Array;
  filename: string;
  contentType?: string;
}): Promise<string | null> {
  if (!publicMediaConfigured()) return null;
  const filename = path.basename(input.filename).replace(
    /[^a-zA-Z0-9._-]/g,
    "_",
  );
  const form = new FormData();
  const bytes =
    input.bytes instanceof Buffer
      ? input.bytes
      : Buffer.from(input.bytes);
  const safe = filename.startsWith("dwgeo-") ? filename : `dwgeo-${filename}`;
  form.append(
    "file",
    new File([new Uint8Array(bytes)], safe, {
      type: input.contentType || "application/octet-stream",
    }),
  );

  const res = await fetch(uploadEndpoint(), {
    method: "POST",
    headers: { Authorization: `Bearer ${uploadToken()}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    url?: string;
    download_url?: string;
    message?: string;
  } | null;
  if (!res.ok || !data?.ok) {
    console.warn(
      "[public-media] upload failed",
      res.status,
      data?.message || "",
    );
    return null;
  }
  const url = data.url || data.download_url;
  return url?.trim() ? toPublicCdnUrl(url.trim()) : null;
}

/** CDN first. On Cloudflare there is no durable local disk. */
export async function persistPublicAsset(input: {
  bytes: Buffer | Uint8Array;
  filename: string;
  contentType?: string;
  label?: string;
}): Promise<string> {
  const filename = path
    .basename(input.filename)
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const publicUrl = await uploadPublicMedia({
    bytes: input.bytes,
    filename,
    contentType: input.contentType,
  });
  if (publicUrl) return publicUrl;
  if (isCloudflareRuntime()) {
    throw new Error(
      `${input.label || "文件"}已生成，但图床上传失败。请检查 PUBLIC_MEDIA_TOKEN`,
    );
  }
  ensureDataDirs();
  const buf =
    input.bytes instanceof Buffer ? input.bytes : Buffer.from(input.bytes);
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buf);
  return `/api/uploads/${filename}`;
}

/** Map /api/uploads/name → local file path if it exists. */
export function localUploadPathFromUrl(src: string): string | null {
  const s = src.trim();
  const m =
    s.match(/\/api\/uploads\/([^/?#]+)$/i) ||
    s.match(/^([^/]+\.(?:png|jpe?g|webp|gif|svg))$/i);
  if (!m) return null;
  const name = decodeURIComponent(m[1]);
  if (!name || name.includes("..") || name.includes("/")) return null;
  const file = path.join(UPLOADS_DIR, name);
  return fs.existsSync(file) ? file : null;
}

function mimeForName(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function isLocalUploadUrl(src: string): boolean {
  const s = src.trim();
  return (
    /\/api\/uploads\//i.test(s) ||
    /\/data\/uploads\//i.test(s) ||
    /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/api\/uploads\//i.test(s)
  );
}

function isPublicCdnUrl(src: string): boolean {
  const s = src.trim();
  return /^https?:\/\//i.test(s) && !isLocalUploadUrl(s);
}

async function loadBytesForPublish(
  src: string,
  origin?: string,
): Promise<{ bytes: Buffer; filename: string; contentType: string } | null> {
  const trimmed = src.trim();
  if (!trimmed || isPublicCdnUrl(trimmed)) return null;

  const file = localUploadPathFromUrl(trimmed);
  if (file) {
    const name = path.basename(file);
    return {
      bytes: fs.readFileSync(file),
      filename: name,
      contentType: mimeForName(name),
    };
  }

  const fetchUrl = toAbsoluteMediaUrl(trimmed, resolvePublicOrigin(origin));
  try {
    const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 32) return null;
    let name = path.basename(new URL(fetchUrl).pathname);
    if (!name || name === "/") {
      name = `remote-${randomUUID()}.jpg`;
    }
    const contentType = (
      res.headers.get("content-type") || mimeForName(name)
    ).split(";")[0];
    return { bytes: buf, filename: name, contentType };
  } catch {
    return null;
  }
}

async function publishOneLocalUrl(
  src: string,
  origin?: string,
): Promise<string | null> {
  if (isPublicCdnUrl(src)) return src;
  const loaded = await loadBytesForPublish(src, origin);
  if (!loaded) return null;
  return uploadPublicMedia({
    bytes: loaded.bytes,
    filename: loaded.filename,
    contentType: loaded.contentType,
  });
}

/** Upload a local cover filename or /api/uploads path to public CDN. */
export async function publishLocalCoverPath(
  coverPath: string | null | undefined,
  origin?: string,
): Promise<string | null> {
  if (!coverPath?.trim()) return null;
  const raw = coverPath.trim();
  if (isPublicCdnUrl(raw)) return raw;
  if (!publicMediaConfigured()) return null;
  const src = raw.includes("/api/uploads/")
    ? raw
    : raw.includes("/data/uploads/")
      ? raw.replace(/^\/?data\/uploads\//, "/api/uploads/")
      : `/api/uploads/${path.basename(raw)}`;
  return publishOneLocalUrl(src, origin);
}

/**
 * Rewrite local /api/uploads (and localhost absolute forms) to public CDN URLs.
 * Uploads each unique local file once; leaves untouched if CDN not configured.
 */
export async function publishLocalMediaInHtml(
  html: string,
  origin?: string,
): Promise<string> {
  if (!html || !publicMediaConfigured()) return html;

  const urls = new Set<string>();
  const re = /(\s(?:src|href|poster)=["'])([^"']+)(["'])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const src = m[2].trim();
    if (isLocalUploadUrl(src)) urls.add(src);
  }
  if (!urls.size) return html;

  const map = new Map<string, string>();
  for (const src of urls) {
    const publicUrl = await publishOneLocalUrl(src, origin);
    if (publicUrl) map.set(src, publicUrl);
  }
  if (!map.size) return html;

  return html.replace(
    /(\s(?:src|href|poster)=["'])([^"']+)(["'])/gi,
    (full, pre: string, url: string, post: string) => {
      const next = map.get(url.trim());
      return next ? `${pre}${next}${post}` : full;
    },
  );
}

/** True when HTML/markdown still points at non-public local uploads. */
export function hasNonPublicMedia(content: string): boolean {
  if (!content) return false;
  return isLocalUploadUrl(content);
}

/**
 * Ensure sync payload has no localhost / relative upload URLs.
 * Throws when local media remains (CDN not configured or upload failed).
 */
export function assertPublicMediaOrThrow(content: string, label = "正文"): void {
  if (!hasNonPublicMedia(content)) return;
  if (!publicMediaConfigured()) {
    throw new Error(
      `${label}含本机图片地址。请配置 PUBLIC_MEDIA_UPLOAD_URL / PUBLIC_MEDIA_TOKEN（cdn.dianwu.ai），否则知乎/小红书等平台无法拉图`,
    );
  }
  throw new Error(
    `${label}仍有未上云的本机图片。请检查公网图床上传是否成功后重试`,
  );
}

export async function publishLocalMediaInMarkdown(
  markdown: string,
  origin?: string,
): Promise<string> {
  if (!markdown || !publicMediaConfigured()) return markdown;
  const urls = new Set<string>();
  const re = /(!?\[[^\]]*]\()([^)\s]+)(\))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const src = m[2].trim();
    if (isLocalUploadUrl(src)) urls.add(src);
  }
  if (!urls.size) return markdown;
  const map = new Map<string, string>();
  for (const src of urls) {
    const publicUrl = await publishOneLocalUrl(src, origin);
    if (publicUrl) map.set(src, publicUrl);
  }
  if (!map.size) return markdown;
  return markdown.replace(
    /(!?\[[^\]]*]\()([^)\s]+)(\))/g,
    (full, pre: string, url: string, post: string) => {
      const next = map.get(url.trim());
      return next ? `${pre}${next}${post}` : full;
    },
  );
}
