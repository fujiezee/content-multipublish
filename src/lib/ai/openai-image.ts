import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { geminiImageRefCap } from "@/lib/ai/image-gen-models-shared";
import {
  localUploadPathFromUrl,
  persistPublicAsset,
} from "@/lib/storage/public-media";
import { rewritePublicMediaUrl } from "@/lib/content/media-urls";

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

function compressPngForWeb(buf: Buffer, mime: string): { bytes: Buffer; mime: string } {
  if (!mime.includes("png") || buf.length < 180_000) {
    return { bytes: buf, mime };
  }
  if (process.platform !== "darwin") {
    return { bytes: buf, mime };
  }
  const id = randomUUID();
  const tmpIn = path.join(os.tmpdir(), `${id}.png`);
  const tmpOut = path.join(os.tmpdir(), `${id}.jpg`);
  try {
    fs.writeFileSync(tmpIn, buf);
    execFileSync(
      "sips",
      ["-s", "format", "jpeg", "-s", "formatOptions", "78", tmpIn, "--out", tmpOut],
      { timeout: 20_000, stdio: "ignore" },
    );
    const jpeg = fs.readFileSync(tmpOut);
    if (jpeg.length > 32 && jpeg.length < buf.length * 0.85) {
      return { bytes: jpeg, mime: "image/jpeg" };
    }
  } catch {
    // keep original PNG
  } finally {
    fs.rmSync(tmpIn, { force: true });
    fs.rmSync(tmpOut, { force: true });
  }
  return { bytes: buf, mime };
}

export async function persistGeneratedImage(
  buf: Buffer,
  mime = "image/png",
): Promise<string> {
  if (buf.length < 32) {
    throw new Error("图像数据无效");
  }
  const compressed = compressPngForWeb(buf, mime);
  const name = `${randomUUID()}${extFromMime(compressed.mime)}`;
  return persistPublicAsset({
    bytes: compressed.bytes,
    filename: name,
    contentType: compressed.mime,
    label: "图片",
  });
}

async function persistImageBytes(
  buf: Buffer,
  mime = "image/png",
): Promise<string> {
  return persistGeneratedImage(buf, mime);
}

async function saveBase64Image(b64: string, mime = "image/png"): Promise<string> {
  const clean = b64.replace(/\s/g, "");
  const buf = Buffer.from(clean, "base64");
  return persistImageBytes(buf, mime);
}

export async function loadImageRef(src: string): Promise<ImageInlineRef | null> {
  const raw = rewritePublicMediaUrl(src.trim());
  if (!raw) return null;
  const local = localUploadPathFromUrl(
    raw.includes("/api/uploads/") ? raw : `/api/uploads/${path.basename(raw)}`,
  );
  if (local) {
    const ext = path.extname(local).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : "image/jpeg";
    return { mime, data: fs.readFileSync(local).toString("base64") };
  }
  if (!/^https?:\/\//i.test(raw)) return null;
  const res = await fetch(raw, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  const mime = res.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 32) return null;
  return {
    mime: mime.split(";")[0] || "image/jpeg",
    data: buf.toString("base64"),
    url: raw,
  };
}

async function saveRemoteImage(url: string): Promise<string> {
  const res = await fetch(rewritePublicMediaUrl(url), { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(`下载生成图失败 HTTP ${res.status}`);
  }
  const mime = res.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return persistImageBytes(buf, mime);
}

function extractInlineFromGemini(json: unknown): { data: string; mime: string } | null {
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth = 0): { data: string; mime: string } | null => {
    if (node == null || depth > 12) return null;
    if (typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = walk(item, depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    const o = node as Record<string, unknown>;
    const inline = (o.inlineData || o.inline_data) as
      | { data?: string; mimeType?: string; mime_type?: string }
      | undefined;
    if (inline?.data && typeof inline.data === "string" && inline.data.length > 80) {
      return {
        data: inline.data,
        mime: inline.mimeType || inline.mime_type || "image/png",
      };
    }
    if (typeof o.b64_json === "string" && o.b64_json.length > 80) {
      return { data: o.b64_json, mime: "image/png" };
    }
    for (const v of Object.values(o)) {
      const hit = walk(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(json);
}

function geminiFailureHint(json: unknown, raw: string): string {
  const text = JSON.stringify(json ?? {}).slice(0, 400);
  const finish = text.match(/"finishReason"\s*:\s*"([^"]+)"/)?.[1];
  const block = text.match(/"blockReason"\s*:\s*"([^"]+)"/)?.[1];
  const message = text.match(/"message"\s*:\s*"([^"]{0,160})"/)?.[1];
  const bits = [
    finish && finish !== "STOP" ? `finish=${finish}` : "",
    block ? `block=${block}` : "",
    message || "",
  ].filter(Boolean);
  return bits.join("；") || raw.slice(0, 180);
}

/**
 * Preferred path on openai-proxy.org:
 * POST /google/v1/models/{model}:generateContent
 */
export type ImageInlineRef = { mime: string; data: string; url?: string };

async function generateViaGoogleProxy(
  config: ImageGenConfig,
  prompt: string,
  aspectRatio = "1:1",
  references: ImageInlineRef[] = [],
): Promise<string | null> {
  const url = `${config.origin}/google/v1/models/${encodeURIComponent(config.model)}:generateContent`;
  // TEXT+IMAGE + 16:9 在代理上常要 90s+，容易被中间层 50s 掐断。
  // IMAGE-only 更快；16:9 再失败就回退 1:1（约 16s）。
  const attempts: Array<{
    responseModalities: string[];
    imageConfig?: { aspectRatio: string };
  }> = [{ responseModalities: ["IMAGE"], imageConfig: { aspectRatio } }];
  if (aspectRatio !== "1:1") {
    attempts.push({
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "1:1" },
    });
  } else {
    attempts.push({
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: "1:1" },
    });
  }

  let lastErr = "";
  for (const gen of attempts) {
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
            parts: [
              ...references.slice(0, geminiImageRefCap(config.model)).map((ref) => ({
                inlineData: { mimeType: ref.mime, data: ref.data },
              })),
              { text: prompt },
            ],
          },
        ],
        generationConfig: gen,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const raw = await res.text();
    if (!res.ok) {
      lastErr = `Google 图像接口 ${res.status}: ${raw.slice(0, 220)}`;
      if (res.status === 401 || res.status === 403 || res.status === 402) {
        throw new Error(lastErr);
      }
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      lastErr = `Google 图像接口返回非 JSON: ${raw.slice(0, 160)}`;
      continue;
    }
    const inline = extractInlineFromGemini(json);
    if (inline) {
      return saveBase64Image(inline.data, inline.mime);
    }
    lastErr = `Google 图像接口未返回图片。${geminiFailureHint(json, raw)}`;
  }
  if (lastErr) throw new Error(lastErr);
  return null;
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

/** 文章封面 / 正文信息图：永远走 Gemini，不会落到火山 Seedream。 */
export async function generateGeminiStill(
  prompt: string,
  options?: {
    aspectRatio?: string;
    references?: ImageInlineRef[];
  },
): Promise<{ url: string; model: string }> {
  const { ARTICLE_STILL_IMAGE_GEN_MODEL, resolveImageGenModel } = await import(
    "@/lib/ai/image-gen-models"
  );
  if (resolveImageGenModel(ARTICLE_STILL_IMAGE_GEN_MODEL).provider !== "gemini") {
    throw new Error("文章封面/信息图必须走 Gemini，不能改成火山");
  }
  return generateImageWithChat(prompt, {
    ...options,
    model: ARTICLE_STILL_IMAGE_GEN_MODEL,
  });
}

/**
 * Generate one image. Prefer openai-proxy Google native path, then chat fallback.
 */
export async function generateImageWithChat(
  prompt: string,
  options?: {
    aspectRatio?: string;
    references?: ImageInlineRef[];
    model?: string;
  },
): Promise<{
  url: string;
  model: string;
}> {
  const { resolveImageGenModel } = await import("@/lib/ai/image-gen-models");
  const picked = resolveImageGenModel(options?.model);
  // 未传 model 时 resolve 会落到 Seedream。封面/信息图必须显式传 gemini。
  if (picked.provider === "ark") {
    const { generateArkImage } = await import("@/lib/ai/ark-image");
    return generateArkImage({
      model: picked.id,
      prompt,
      aspectRatio: options?.aspectRatio,
      references: options?.references,
    });
  }
  if (picked.provider === "cloudflare") {
    const { generateCloudflareImage } = await import("@/lib/ai/cloudflare-ai");
    return generateCloudflareImage({
      model: picked.model || picked.id,
      prompt,
      aspectRatio: options?.aspectRatio,
    });
  }

  const config = resolveImageGenConfig();
  if (!config) {
    throw new Error(
      "未配置图像 API。请在 .env.local 设置 OPENAI_API_KEY，并设 OPENAI_BASE_URL=https://api.openai-proxy.org/v1",
    );
  }
  const resolved = {
    ...config,
    model: picked.model?.trim() || config.model,
  };

  const aspectRatio = options?.aspectRatio || "1:1";
  const ratioHint =
    aspectRatio === "3:4"
      ? "画幅必须是竖版 3:4（约 1080×1440），不要横版、不要正方形。"
      : aspectRatio === "16:9"
        ? "画幅必须是横版 16:9（约 1920×1080），不要竖版。"
        : aspectRatio === "9:16"
          ? "画幅必须是竖版 9:16（约 1080×1920），不要横版。"
          : "画幅必须是正方形 1:1，不要横版。";
  const sizedPrompt = new RegExp(
    `${aspectRatio.replace(":", "\\:")}|画幅必须`,
    "i",
  ).test(prompt)
    ? prompt
    : `${ratioHint}\n${prompt}`;

  let lastErr = "";
  try {
    const viaGoogle = await generateViaGoogleProxy(
      resolved,
      sizedPrompt,
      aspectRatio,
      options?.references,
    );
    if (viaGoogle) {
      return { url: viaGoogle, model: resolved.model };
    }
  } catch (err) {
    lastErr = err instanceof Error ? err.message : String(err);
    if (/401|403|402|配额|billing|API key/i.test(lastErr)) {
      throw err;
    }
  }

  try {
    const viaChat = await generateViaChatFallback(resolved, sizedPrompt);
    if (viaChat) {
      return { url: viaChat, model: resolved.model };
    }
  } catch (err) {
    const chatErr = err instanceof Error ? err.message : String(err);
    lastErr = lastErr ? `${lastErr}；${chatErr}` : chatErr;
  }

  throw new Error(
    lastErr ||
      `图像模型未返回图片。已尝试 ${resolved.origin}/google/v1/models/${resolved.model}:generateContent 与 chat/completions。`,
  );
}
