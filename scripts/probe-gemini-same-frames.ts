import fs from "fs";
import path from "path";

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] == null) process.env[key] = val;
  }
}

loadEnv();

const OUT = path.join(process.cwd(), "data/debug/dark-manhua");
const START = path.join(OUT, "gemini.jpg");

async function copyMedia(url: string, dest: string) {
  if (url.startsWith("/api/uploads/")) {
    const name = decodeURIComponent(url.split("/").pop() || "");
    fs.copyFileSync(path.join(process.cwd(), "data/uploads", name), dest);
    return;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`下载失败 ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function isRealPerson(message: string): boolean {
  return /real person|真实人物|真人(人脸|照片)?|InputImageSensitiveContentDetected\.PrivacyInformation/i.test(
    message,
  );
}

async function main() {
  if (!fs.existsSync(START)) throw new Error("没有 gemini.jpg");
  const { persistGeneratedImage } = await import("../src/lib/ai/openai-image");
  const { publishLocalCoverPath } = await import(
    "../src/lib/storage/public-media"
  );
  const {
    resolveArkVideoConfig,
    ARK_VIDEO_PRESETS,
    DEFAULT_ARK_VIDEO_PRESET,
  } = await import("../src/lib/ai/ark-video");

  const local = await persistGeneratedImage(
    fs.readFileSync(START),
    "image/jpeg",
  );
  const published = await publishLocalCoverPath(local);
  const still =
    published && /^https:\/\//i.test(published) ? published : local;
  if (!/^https:\/\//i.test(still)) throw new Error("没有公网地址");

  const config = resolveArkVideoConfig();
  if (!config) throw new Error("还没配方舟");
  const preset =
    ARK_VIDEO_PRESETS.find((row) => row.id === DEFAULT_ARK_VIDEO_PRESET) ||
    ARK_VIDEO_PRESETS[0];

  console.log("出片（头尾同一张，不改画风）…");
  const createRes = await fetch(`${config.baseUrl}/contents/generations/tasks`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: preset.model,
      content: [
        {
          type: "text",
          text: [
            "图片1是这一镜开头，必须当作第一帧。图片2是这一镜结尾，必须当作最后一帧。两张是同一个人、同一张脸、同一套衣服、同一场。",
            "画风必须跟参考图完全一致：暗黑厚涂，黑金。不要改成实拍，不要改成电影写实，不要改成二次元，不要换脸。",
            "只做很小的动作：烛火微晃，人几乎不动，眼神还锁着，可以极轻地点一下头。不要走位，不要换构图。",
            "无对白。不要水印。",
          ].join("\n"),
        },
        {
          type: "image_url",
          image_url: { url: still },
          role: "first_frame",
        },
        {
          type: "image_url",
          image_url: { url: still },
          role: "last_frame",
        },
      ],
      resolution: preset.resolution,
      duration: 5,
      watermark: false,
      generate_audio: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const created = (await createRes.json()) as {
    id?: string;
    error?: { message?: string };
    message?: string;
  };
  const createMsg = created.error?.message || created.message || "";
  if (!createRes.ok || !created.id) {
    const kind = isRealPerson(createMsg) ? "real-person" : "fail";
    console.log("创建失败", kind, createMsg.slice(0, 200));
    return;
  }

  const started = Date.now();
  while (Date.now() - started < 180_000) {
    const pollRes = await fetch(
      `${config.baseUrl}/contents/generations/tasks/${created.id}`,
      {
        headers: { authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    const json = (await pollRes.json()) as {
      status?: string;
      content?: { video_url?: string };
      error?: { message?: string };
    };
    const status = (json.status || "").toLowerCase();
    if (status === "succeeded") {
      const clip = json.content?.video_url?.trim() || "";
      if (!clip) throw new Error("没有视频地址");
      const dest = path.join(OUT, "gemini-same-clip.mp4");
      await copyMedia(clip, dest);
      console.log("过了", dest);
      return;
    }
    if (status === "failed" || status === "cancelled") {
      const msg = json.error?.message || "任务失败";
      const kind = isRealPerson(msg) ? "real-person" : "fail";
      console.log("任务失败", kind, msg.slice(0, 200));
      return;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("出片超时");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
