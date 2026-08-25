/**
 * Aliyun OSS Authorization V1 (HMAC-SHA1) for STS PUT.
 * Matches ali-oss 6.20 (vscode-zhihu): x-oss-date in both the Date slot and
 * CanonicalizedOSSHeaders. Do not send `Date` — fetch/XHR strip it as forbidden.
 */

async function hmacSha1Base64(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

/**
 * @param {Record<string, string>} headers
 */
function canonicalizedOssHeaders(headers) {
  return Object.keys(headers)
    .filter((k) => k.toLowerCase().startsWith("x-oss-"))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((k) => `${k.toLowerCase()}:${String(headers[k]).trim()}`)
    .join("\n");
}

/**
 * @param {{
 *   method?: string;
 *   bucket: string;
 *   objectKey: string;
 *   accessId: string;
 *   accessKey: string;
 *   stsToken: string;
 *   contentType?: string;
 *   contentMd5?: string;
 *   date?: string;
 *   cname?: boolean;
 * }} input
 */
export async function ossV1PutHeaders(input) {
  const method = (input.method || "PUT").toUpperCase();
  const date = input.date || new Date().toUTCString();
  const contentType = input.contentType || "";
  const contentMd5 = input.contentMd5 || "";
  const objectKey = String(input.objectKey || "").replace(/^\/+/, "");
  const resource = input.cname
    ? `/${objectKey}`
    : `/${input.bucket}/${objectKey}`;

  /** @type {Record<string, string>} */
  const headers = {
    "x-oss-date": date,
    "x-oss-security-token": input.stsToken,
  };
  if (contentType) headers["Content-Type"] = contentType;
  if (contentMd5) headers["Content-MD5"] = contentMd5;

  const ossHeaders = canonicalizedOssHeaders(headers);
  const stringToSign = [
    method,
    contentMd5,
    contentType,
    date,
    ossHeaders,
    resource,
  ].join("\n");

  const signature = await hmacSha1Base64(input.accessKey, stringToSign);
  headers.Authorization = `OSS ${input.accessId}:${signature}`;
  return headers;
}
