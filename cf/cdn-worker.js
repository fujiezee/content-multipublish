/** Public media CDN. Only allowlisted R2 prefixes — never dianwu-geo/content.db. */

const ALLOW_PREFIXES = ["uploads/"];
const PUBLIC_BASE = "https://cdn.dianwu.ai/files";

function objectKey(pathname) {
  let p = decodeURIComponent(pathname || "").replace(/^\/+/, "");
  if (p.startsWith("files/")) p = p.slice("files/".length);
  if (!p || p.includes("..") || p.includes("\\")) return null;
  if (!ALLOW_PREFIXES.some((prefix) => p.startsWith(prefix))) return null;
  return p;
}

function mimeFromName(name) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  return "application/octet-stream";
}

function corsHeaders(methods) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders("GET, HEAD, POST, OPTIONS"),
    },
  });
}

function authorized(request, env) {
  const token = String(env.UPLOAD_TOKEN || "").trim();
  if (!token) return false;
  const header = String(request.headers.get("Authorization") || "");
  return header === `Bearer ${token}`;
}

async function handleUpload(request, env) {
  if (!authorized(request, env)) {
    return json({ ok: false, message: "未授权" }, 401);
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, message: "请上传文件" }, 400);
  }
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return json({ ok: false, message: "请上传文件" }, 400);
  }
  const timestamp = Date.now();
  const safeName = String(file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = `uploads/${timestamp}-${safeName}`;
  const arrayBuffer = await file.arrayBuffer();
  await env.FILES.put(filePath, arrayBuffer, {
    httpMetadata: { contentType: file.type || mimeFromName(safeName) },
  });
  const url = `${PUBLIC_BASE}/${filePath}`;
  return json({
    ok: true,
    url,
    download_url: url,
    filename: file.name,
    size: file.size,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders("GET, HEAD, POST, OPTIONS"),
      });
    }

    if (request.method === "POST" && (url.pathname === "/upload" || url.pathname === "/files/upload")) {
      return handleUpload(request, env);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    const key = objectKey(url.pathname);
    if (!key) return new Response("Not Found", { status: 404 });

    const obj = await env.FILES.get(key);
    if (!obj) return new Response("Not Found", { status: 404 });

    const headers = new Headers();
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set(
      "Content-Type",
      obj.httpMetadata?.contentType || mimeFromName(key),
    );
    if (obj.size != null) headers.set("Content-Length", String(obj.size));
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    return new Response(obj.body, { status: 200, headers });
  },
};
