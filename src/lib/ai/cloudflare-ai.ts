import {
  hasCloudflareAiReady,
  resolveCloudflareAccountId,
  resolveCloudflareAiToken,
} from "@/lib/ai/model-catalog/cloudflare-seed";
import { persistGeneratedImage } from "@/lib/ai/openai-image";

function isHostedWorkersAiModel(model: string) {
  return /^@(cf|hf)\//i.test(model.trim());
}

function runUrl(model: string) {
  const account = resolveCloudflareAccountId();
  const id = model.trim().replace(/^\//, "");
  if (isHostedWorkersAiModel(id)) {
    return `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${id}`;
  }
  return `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run`;
}

async function runCloudflareAi(
  model: string,
  body: Record<string, unknown>,
  timeoutMs = 180_000,
): Promise<{ json: Record<string, unknown>; bytes: Buffer | null; mime: string }> {
  if (!hasCloudflareAiReady()) {
    throw new Error("还没配 Cloudflare Workers AI。请设置 CLOUDFLARE_AI_TOKEN");
  }
  const token = resolveCloudflareAiToken();
  const hosted = isHostedWorkersAiModel(model);
  const res = await fetch(runUrl(model), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(hosted ? body : { model: model.trim(), input: body }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const mime = (res.headers.get("content-type") || "").toLowerCase();
  if (mime.startsWith("image/")) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      throw new Error(`Workers AI 出图失败（${res.status}）`);
    }
    return { json: {}, bytes: buf, mime: mime.split(";")[0] || "image/png" };
  }
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    json = {};
  }
  if (!res.ok || json.success === false) {
    const errors = json.errors as Array<{ message?: string }> | undefined;
    throw new Error(
      errors?.[0]?.message ||
        (typeof json.error === "string" ? json.error : "") ||
        `Workers AI 失败（${res.status}）`,
    );
  }
  return { json, bytes: null, mime };
}

function pickBase64Image(json: Record<string, unknown>): string | null {
  const result = json.result;
  if (typeof json.image === "string" && json.image.length > 80 && !json.image.startsWith("http")) {
    return json.image;
  }
  if (!result || typeof result !== "object") return null;
  const rec = result as Record<string, unknown>;
  if (typeof rec.image === "string" && rec.image.length > 80 && !rec.image.startsWith("http")) {
    return rec.image;
  }
  if (Array.isArray(rec.images) && typeof rec.images[0] === "string" && !rec.images[0].startsWith("http")) {
    return rec.images[0];
  }
  return null;
}

function pickImageUrl(json: Record<string, unknown>): string | null {
  const bags: unknown[] = [json, json.result];
  for (const bag of bags) {
    if (!bag || typeof bag !== "object") continue;
    const rec = bag as Record<string, unknown>;
    for (const key of ["image", "url", "image_url"]) {
      const value = rec[key];
      if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
    }
    if (Array.isArray(rec.images) && typeof rec.images[0] === "string" && /^https?:\/\//i.test(rec.images[0])) {
      return rec.images[0];
    }
  }
  return null;
}

function sizeForRatio(aspectRatio?: string): { width: number; height: number } {
  if (aspectRatio === "9:16") return { width: 768, height: 1344 };
  if (aspectRatio === "3:4") return { width: 768, height: 1024 };
  if (aspectRatio === "16:9") return { width: 1344, height: 768 };
  return { width: 1024, height: 1024 };
}

export async function generateCloudflareImage(input: {
  model: string;
  prompt: string;
  aspectRatio?: string;
}): Promise<{ url: string; model: string }> {
  const model = input.model.trim();
  if (!model) throw new Error("缺少 Workers AI 出图模型");
  const hosted = isHostedWorkersAiModel(model);
  const size = sizeForRatio(input.aspectRatio);
  const body: Record<string, unknown> = { prompt: input.prompt };
  if (hosted) {
    Object.assign(body, size);
    if (/schnell|lightning|lcm/i.test(model)) {
      body.num_steps = 4;
    }
  } else if (input.aspectRatio) {
    body.ratio = input.aspectRatio;
  }

  const out = await runCloudflareAi(model, body);
  if (out.bytes && out.bytes.length > 32) {
    const url = await persistGeneratedImage(out.bytes, out.mime || "image/png");
    return { url, model };
  }
  const remote = pickImageUrl(out.json);
  if (remote) {
    const img = await fetch(remote, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new Error("Cloudflare 图片地址无法下载");
    const buf = Buffer.from(await img.arrayBuffer());
    const mime = (img.headers.get("content-type") || "image/png").split(";")[0];
    const url = await persistGeneratedImage(buf, mime || "image/png");
    return { url, model };
  }
  const b64 = pickBase64Image(out.json);
  if (!b64) {
    throw new Error("Workers AI 没有返回图片");
  }
  const buf = Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ""), "base64");
  const url = await persistGeneratedImage(buf, "image/png");
  return { url, model };
}

function pickVideoUrl(json: Record<string, unknown>): string | null {
  const bags: unknown[] = [json, json.result];
  for (const bag of bags) {
    if (!bag || typeof bag !== "object") continue;
    const rec = bag as Record<string, unknown>;
    for (const key of ["video", "url", "video_url"]) {
      const value = rec[key];
      if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
    }
  }
  return null;
}

export async function generateCloudflareVideo(input: {
  model: string;
  prompt: string;
  duration?: number;
  ratio?: string;
  resolution?: string;
  imageUrl?: string;
}): Promise<string> {
  const model = input.model.trim();
  if (!model) throw new Error("缺少 Cloudflare 出片模型");
  const body: Record<string, unknown> = { prompt: input.prompt };
  if (input.duration) body.duration = input.duration;
  if (input.ratio) body.ratio = input.ratio;
  if (input.resolution) body.resolution = input.resolution;
  if (input.imageUrl) {
    body.image = input.imageUrl;
    body.image_url = input.imageUrl;
  }
  const out = await runCloudflareAi(model, body, 300_000);
  const url = pickVideoUrl(out.json);
  if (!url) {
    throw new Error("Cloudflare 没有返回视频地址");
  }
  return url;
}
