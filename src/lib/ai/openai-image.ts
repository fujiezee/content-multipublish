import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { UPLOADS_DIR, ensureDataDirs } from "@/lib/paths";
import { uploadPublicMedia } from "@/lib/storage/public-media";

export type ImageGenConfig = {
  apiKey: string;
  /** Origin only, e.g. https://api.openai-proxy.org */
  origin: string;
  /** OpenAI-compatible /v1 base (fallback chat path) */
  openAiBaseUrl: string;
  model: string;
};

function normalizeOrigin(baseUrl: string): string {
  let u = baseUrl.replace(/\/$/, "");
  u = u.replace(/\/v1$/i, "");
  return u;
}

/** openai-proxy.org (+ compatible) config for Gemini image models. */
export function resolveImageGenConfig(): ImageGenConfig | null {
  const apiKey =
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.DEEPSEEK_API_KEY?.trim() ||
    "";
  if (!apiKey) return null;

  let openAiBaseUrl =
    process.env.GEMINI_IMAGE_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    "https://api.openai-proxy.org/v1";
  openAiBaseUrl = openAiBaseUrl.replace(/\/$/, "");
  if (!openAiBaseUrl.endsWith("/v1")) {
    openAiBaseUrl = `${openAiBaseUrl}/v1`;
  }

  const model =
    process.env.GEMINI_IMAGE_MODEL?.trim() ||
    process.env.OPENAI_IMAGE_MODEL?.trim() ||
    "gemini-3.1-flash-image";

  return {
    apiKey,
    origin: normalizeOrigin(openAiBaseUrl),
    openAiBaseUrl,
    model,
  };
}

function extFromMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  return ".png";
}

async function persistImageBytes(
  buf: Buffer,
  mime = "image/png",
): Promise<string> {
  ensureDataDirs();
  if (buf.length < 32) {
    throw new Error("图像数据无效");
  }
  const name = `${randomUUID()}${extFromMime(mime)}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
  const publicUrl = await uploadPublicMedia({
    bytes: buf,
    filename: name,
    contentType: mime,
  });
  return publicUrl || `/api/uploads/${name}`;
}

async function saveBase64Image(b64: string, mime = "image/png"): Promise<string> {
  const clean = b64.replace(/\s/g, "");
  const buf = Buffer.from(clean, "base64");
  return persistImageBytes(buf, mime);
}

async function saveRemoteImage(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(`下载生成图失败 HTTP ${res.status}`);
  }
  const mime = res.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return persistImageBytes(buf, mime);
}

function extractInlineFromGemini(json: unknown): { data: string; mime: string } | null {
  const candidates =
    (json as { candidates?: unknown[] })?.candidates ||
    (json as { response?: { candidates?: unknown[] } })?.response?.candidates;
  if (!Array.isArray(candidates)) return null;

  for (const cand of candidates) {
    const parts = (cand as { content?: { parts?: unknown[] } })?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const p = part as {
        inlineData?: { data?: string; mimeType?: string; mime_type?: string };
        inline_data?: { data?: string; mimeType?: string; mime_type?: string };
      };
      const inline = p.inlineData || p.inline_data;
      if (inline?.data && typeof inline.data === "string") {
        return {
          data: inline.data,
          mime: inline.mimeType || inline.mime_type || "image/png",
        };
      }
    }
  }
  return null;
}

/**
 * Preferred path on openai-proxy.org:
 * POST /google/v1/models/{model}:generateContent
 */
async function generateViaGoogleProxy(
  config: ImageGenConfig,
  prompt: string,
): Promise<string | null> {
  const url = `${config.origin}/google/v1/models/${encodeURIComponent(config.model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
      "x-goog-api-key": config.apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });

  const raw = await res.text();
  if (!res.ok) {
    // 404 / not supported → let caller try chat fallback
    if (res.status === 404 || res.status === 405) return null;
    throw new Error(
      `Google 图像接口 ${res.status}: ${raw.slice(0, 300)}（${url}）`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Google 图像接口返回非 JSON: ${raw.slice(0, 200)}`);
  }

  const inline = extractInlineFromGemini(json);
  if (!inline) {
    throw new Error(
      `Google 图像接口未返回 inlineData。片段: ${raw.slice(0, 280)}`,
    );
  }
  return saveBase64Image(inline.data, inline.mime);
}

function collectChatImageRefs(payload: unknown): string[] {
  const refs: string[] = [];
  const push = (url: string) => {
    const u = url.trim();
    if (
      u.startsWith("data:image/") ||
      /^https?:\/\//i.test(u) ||
      u.startsWith("/api/uploads/")
    ) {
      refs.push(u);
    }
  };

  const walk = (node: unknown, depth = 0) => {
    if (node == null || depth > 10) return;
    if (typeof node === "string") {
      if (node.startsWith("data:image/") || /^https?:\/\//i.test(node.trim())) {
        push(node);
      } else {
        for (const m of node.matchAll(
          /!\[[^\]]*]\((data:image\/[^)]+|https?:\/\/[^)\s]+)\)/g,
        )) {
          if (m[1]) push(m[1]);
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (typeof o.b64_json === "string") {
      const mime =
        typeof o.mime_type === "string"
          ? o.mime_type
          : typeof o.mimeType === "string"
            ? o.mimeType
            : "image/png";
      refs.push(`data:${mime};base64,${o.b64_json}`);
    }
    if (typeof o.url === "string") push(o.url);
    if (typeof o.image_url === "string") push(o.image_url);
    if (o.image_url && typeof o.image_url === "object") {
      const u = (o.image_url as { url?: string }).url;
      if (typeof u === "string") push(u);
    }
    // nested Gemini inline inside chat wrappers
    const nested = extractInlineFromGemini(o);
    if (nested) refs.push(`data:${nested.mime};base64,${nested.data}`);

    for (const v of Object.values(o)) walk(v, depth + 1);
  };

  walk(payload);
  return [...new Set(refs)];
}

async function materializeRef(ref: string): Promise<string> {
  if (ref.startsWith("/api/uploads/")) return ref;
  if (ref.startsWith("data:image/")) {
    const m = ref.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
    if (!m) throw new Error("无法解析 data URL");
    return saveBase64Image(m[2], m[1]);
  }
  if (/^https?:\/\//i.test(ref)) return saveRemoteImage(ref);
  throw new Error("无法识别的图像引用");
}

/** Fallback: OpenAI chat/completions (many proxies drop image bytes). */
async function generateViaChatFallback(
  config: ImageGenConfig,
  prompt: string,
): Promise<string | null> {
  const res = await fetch(`${config.openAiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      modalities: ["text", "image"],
      stream: false,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(
      `图像 chat 接口 ${res.status}: ${raw.slice(0, 300)}（model=${config.model}）`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  for (const ref of collectChatImageRefs(json)) {
    try {
      return await materializeRef(ref);
    } catch {
      // continue
    }
  }
  return null;
}

/**
 * Generate one image. Prefer openai-proxy Google native path, then chat fallback.
 */
export async function generateImageWithChat(prompt: string): Promise<{
  url: string;
  model: string;
}> {
  const config = resolveImageGenConfig();
  if (!config) {
    throw new Error(
      "未配置图像 API。请在 .env.local 设置 OPENAI_API_KEY，并设 OPENAI_BASE_URL=https://api.openai-proxy.org/v1",
    );
  }

  try {
    const viaGoogle = await generateViaGoogleProxy(config, prompt);
    if (viaGoogle) {
      return { url: viaGoogle, model: config.model };
    }
  } catch (err) {
    // If google path hard-fails with auth/billing, surface it; otherwise try chat
    const msg = err instanceof Error ? err.message : String(err);
    if (/401|403|402|配额|billing|API key/i.test(msg)) {
      throw err;
    }
    // fall through to chat for non-proxy origins
  }

  const viaChat = await generateViaChatFallback(config, prompt);
  if (viaChat) {
    return { url: viaChat, model: config.model };
  }

  throw new Error(
    `图像模型未返回图片。已尝试 ${config.origin}/google/v1/models/${config.model}:generateContent 与 chat/completions。请确认代理支持该模型。`,
  );
}
