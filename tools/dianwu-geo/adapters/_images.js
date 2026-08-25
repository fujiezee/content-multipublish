/**
 * Shared image rehost helpers for platform adapters.
 *
 * BaseAdapter.processImages catches upload errors and keeps the original URL.
 * Always call assertHostedImages after processImages so drafts never "succeed"
 * with external URLs that platforms strip.
 */

/**
 * @param {string} content HTML or Markdown
 * @returns {string[]}
 */
export function extractImageSrcs(content) {
  const srcs = [];
  const html = String(content || "");
  const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = imgRe.exec(html))) {
    if (m[1]) srcs.push(m[1]);
  }
  const srcsetRe = /\ssrcset=["']([^"']+)["']/gi;
  while ((m = srcsetRe.exec(html))) {
    for (const part of String(m[1]).split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (url) srcs.push(url);
    }
  }
  const mdRe = /!\[[^\]]*]\(([^)\s]+)\)/g;
  while ((m = mdRe.exec(html))) {
    if (m[1]) srcs.push(m[1]);
  }
  return srcs;
}

/**
 * Collapse `https://host/../../../public/foo.png` (and relative `../public/`)
 * into a fetchable URL. Next.js serves /public at the site root.
 * @param {string} src
 * @param {string} [origin]
 */
export function normalizeFetchableImageUrl(src, origin) {
  const s = String(src || "").trim();
  if (!s || s.startsWith("data:") || s.startsWith("blob:")) return s;
  try {
    const href = /^https?:\/\//i.test(s)
      ? new URL(s).href
      : s.startsWith("//")
        ? new URL(`https:${s}`).href
        : origin
          ? new URL(s, origin.endsWith("/") ? origin : `${origin}/`).href
          : s;
    const u = new URL(href);
    u.pathname = u.pathname.replace(/^\/public\//, "/");
    return u.href;
  } catch {
    return s;
  }
}

function rewriteContentImageUrls(content, origin) {
  return String(content || "").replace(
    /(<img\b[^>]*?\bsrc=["'])([^"']+)(["'])/gi,
    (_, pre, src, post) => `${pre}${normalizeFetchableImageUrl(src, origin)}${post}`,
  );
}

function inferMediaOrigin(content) {
  const m = String(content || "").match(
    /https?:\/\/(?:www\.)?dianwu\.(?:tech|ai)\b[^"'\s]*/i,
  );
  if (!m) return undefined;
  try {
    return new URL(m[0]).origin;
  } catch {
    return undefined;
  }
}

/**
 * @param {string} url
 * @param {string[]} patterns
 */
export function matchesHostPatterns(url, patterns) {
  const s = String(url || "");
  return (patterns || []).some((p) => p && s.includes(p));
}

/**
 * @param {string} content
 * @param {string[]} allowedHostPatterns
 * @param {string} platformName
 */
export function assertHostedImages(content, allowedHostPatterns, platformName) {
  const bad = extractImageSrcs(content).filter(
    (src) =>
      !src.startsWith("data:") &&
      !matchesHostPatterns(src, allowedHostPatterns),
  );
  if (!bad.length) return;
  const sample = bad[0].slice(0, 96);
  throw new Error(
    `${platformName}草稿需要平台图床地址，仍有 ${bad.length} 张未转存成功（如 ${sample}）`,
  );
}

/**
 * For platforms without a working upload API: only allow already-hosted images.
 * @param {string[]} allowedHostPatterns
 * @param {string} platformName
 */
export function createHostOnlyUpload(allowedHostPatterns, platformName) {
  return async function uploadImageByUrl(src) {
    if (matchesHostPatterns(src, allowedHostPatterns)) {
      return { url: src };
    }
    throw new Error(
      `${platformName}尚未接入平台图床转存，无法把外链图写入草稿。请去掉正文外链图，或改用已支持转存的平台（如头条、企鹅号、搜狐号）。`,
    );
  };
}

/**
 * Require absolute public https URL (no localhost / relative uploads).
 * Used by fill-and-confirm platforms like 小红书.
 * @param {string} src
 * @param {string} platformName
 */
export function assertPublicImageUrl(src, platformName) {
  if (
    !src ||
    src.startsWith("/api/uploads/") ||
    /127\.0\.0\.1|localhost/i.test(src)
  ) {
    throw new Error(
      `${platformName}需要公网图片地址，请先同步到 CDN（勿用本机 /api/uploads）`,
    );
  }
  if (!/^https?:\/\//i.test(src)) {
    throw new Error(`${platformName}图片地址必须是绝对 URL：${src.slice(0, 80)}`);
  }
}

/**
 * After rehost for paste-into-editor platforms that accept any public CDN.
 * @param {string} content
 * @param {string} platformName
 */
export function assertNoLocalImages(content, platformName) {
  const bad = extractImageSrcs(content).filter(
    (src) =>
      src.startsWith("/api/uploads/") ||
      /127\.0\.0\.1|localhost/i.test(src) ||
      !/^https?:\/\//i.test(src),
  );
  if (!bad.length) return;
  throw new Error(
    `${platformName}仍有本机/相对图片地址（${bad.length} 张），请先上云后再同步`,
  );
}

/**
 * Patch BaseAdapter.processImages so built-in platforms also fail closed
 * when uploads leave non-platform URLs (shared catch previously kept them).
 * @param {new (...args: unknown[]) => { processImages: Function, meta?: { name?: string, id?: string } }} BaseAdapter
 */
export function patchBaseProcessImages(BaseAdapter) {
  const proto = BaseAdapter?.prototype;
  if (!proto || typeof proto.processImages !== "function") return false;
  if (proto.__dwgeoProcessImagesPatched) return true;
  const original = proto.processImages;
  proto.processImages = async function patchedProcessImages(
    content,
    uploadFn,
    options,
  ) {
    const origin = inferMediaOrigin(content);
    const rewritten = rewriteContentImageUrls(content, origin);
    const wrapped = async (src) => {
      const url = normalizeFetchableImageUrl(src, origin);
      try {
        return await uploadFn(url);
      } catch (err) {
        if (/\/public\/|\.\.\//.test(String(src))) {
          throw new Error(
            `图片不是可拉取的公网地址（${url.slice(0, 96)}）。请在编辑器里删掉这张图并重新上传后再同步。`,
          );
        }
        throw err;
      }
    };
    const out = await original.call(this, rewritten, wrapped, options);
    const skipPatterns = options?.skipPatterns || [];
    // Fill-confirm platforms may keep third-party public CDNs.
    if (options?.allowPublicExternal) {
      assertNoLocalImages(out, this.meta?.name || this.meta?.id || "平台");
      return out;
    }
    if (skipPatterns.length) {
      assertHostedImages(
        out,
        skipPatterns,
        this.meta?.name || this.meta?.id || "平台",
      );
    }
    return out;
  };
  proto.__dwgeoProcessImagesPatched = true;
  return true;
}

/**
 * processImages + CDN host assert.
 * @param {{ processImages: Function }} adapter
 * @param {string} content
 * @param {(src: string) => Promise<{ url: string, attrs?: Record<string, string> }>} uploadFn
 * @param {{ skipPatterns: string[], onProgress?: Function, platformName: string }} options
 */
export async function processAndAssertImages(
  adapter,
  content,
  uploadFn,
  options,
) {
  const { skipPatterns, onProgress, platformName } = options;
  const out = await adapter.processImages(content, uploadFn, {
    skipPatterns,
    onProgress,
  });
  assertHostedImages(out, skipPatterns, platformName);
  return out;
}
