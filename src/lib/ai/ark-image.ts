import { resolveArkVideoConfig } from "@/lib/ai/ark-video";
import {
  resolveImageGenModel,
  type ImageGenModelOption,
} from "@/lib/ai/image-gen-models";
import {
  persistGeneratedImage,
  type ImageInlineRef,
} from "@/lib/ai/openai-image";

function seedreamSize(aspectRatio: string): string {
  if (aspectRatio === "9:16") return "1440x2560";
  if (aspectRatio === "3:4") return "1728x2304";
  if (aspectRatio === "16:9") return "2560x1440";
  return "2048x2048";
}

/** Seedream 4.x / 5.0-lite 才支持 sequential_image_generation；5.0 / 5.0-pro 带了会 400。 */
function supportsSequentialImages(model: string): boolean {
  const id = model.toLowerCase();
  if (id.includes("lite")) return true;
  if (id.includes("seedream-4")) return true;
  return false;
}

function arkImageInput(ref: ImageInlineRef): string {
  const publicUrl = ref.url?.trim() || "";
  if (
    /^https?:\/\//i.test(publicUrl) &&
    !/127\.0\.0\.1|localhost|\/api\/uploads\//i.test(publicUrl)
  ) {
    return publicUrl;
  }
  return `data:${ref.mime};base64,${ref.data}`;
}

function explainArkImageError(message: string): string {
  if (/AccountOverdueError|overdue|欠费/i.test(message)) {
    return "火山引擎账号欠费，图片生成调不通。先到费用中心充值。";
  }
  if (/ModelNotOpen|not open|未开通|没有开通/i.test(message)) {
    return "这个 Seedream 模型还没在方舟开通。到模型广场开通后再选。";
  }
  if (/401|Unauthorized|API key|api_key/i.test(message)) {
    return "方舟 Key 无效，图片生成调不通。";
  }
  return message;
}

export async function generateArkImage(input: {
  model?: string;
  prompt: string;
  aspectRatio?: string;
  references?: ImageInlineRef[];
}): Promise<{ url: string; model: string }> {
  const picked: ImageGenModelOption = resolveImageGenModel(input.model);
  if (picked.provider !== "ark" || !picked.model) {
    throw new Error("这个出图模型不是方舟 Seedream");
  }
  const config = resolveArkVideoConfig();
  if (!config) {
    throw new Error("还没配方舟。先填火山方舟 API Key，才能用 Seedream 出图");
  }

  const images = (input.references || [])
    .slice(0, 10)
    .map(arkImageInput)
    .filter(Boolean);
  const body: Record<string, unknown> = {
    model: picked.model,
    prompt: input.prompt,
    size: seedreamSize(input.aspectRatio || "1:1"),
    watermark: false,
    response_format: "url",
  };
  // Seedream 5.0 / 5.0-pro 带 sequential_image_generation（含 disabled）会 400。
  if (supportsSequentialImages(picked.model || picked.id)) {
    body.sequential_image_generation = "disabled";
  }
  if (images.length > 0) body.image = images;

  const res = await fetch(`${config.baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await res.text();
  let json: {
    error?: { message?: string };
    data?: Array<{ url?: string; b64_json?: string }>;
  } = {};
  try {
    json = JSON.parse(raw) as typeof json;
  } catch {
    json = {};
  }
  if (!res.ok) {
    throw new Error(
      explainArkImageError(
        json.error?.message || raw.slice(0, 220) || `Seedream ${res.status}`,
      ),
    );
  }
  const row = json.data?.[0];
  if (row?.url) {
    const saved = await fetch(row.url, { signal: AbortSignal.timeout(60_000) });
    if (!saved.ok) throw new Error("Seedream 图下载失败");
    const mime = saved.headers.get("content-type") || "image/jpeg";
    const url = await persistGeneratedImage(
      Buffer.from(await saved.arrayBuffer()),
      mime,
    );
    return { url, model: picked.id };
  }
  if (row?.b64_json) {
    const url = await persistGeneratedImage(
      Buffer.from(row.b64_json, "base64"),
      "image/jpeg",
    );
    return { url, model: picked.id };
  }
  throw new Error("Seedream 没有返回图片");
}
