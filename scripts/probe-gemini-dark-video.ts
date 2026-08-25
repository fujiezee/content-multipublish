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
  const { persistGeneratedImage, generateImageWithChat } = await import(
    "../src/lib/ai/openai-image"
  );
  const { publishLocalCoverPath } = await import(
    "../src/lib/storage/public-media"
  );
  const { MANHUA_VIDEO_STYLE } = await import("../src/lib/ai/manhua-look");
  const {
    resolveArkVideoConfig,
    ARK_VIDEO_PRESETS,
    DEFAULT_ARK_VIDEO_PRESET,
  } = await import("../src/lib/ai/ark-video");

  const toHttps = async (url: string) => {
    const published = await publishLocalCoverPath(url);
    const https =
      published && /^https:\/\//i.test(published) ? published : url;
    if (!/^https:\/\//i.test(https)) throw new Error("没有公网地址");
    return https;
  };

  const startLocal = await persistGeneratedImage(
    fs.readFileSync(START),
    "image/jpeg",
  );
  const start = await toHttps(startLocal);
  console.log("头帧已上云");

  console.log("出尾帧…");
  const { url: endRaw } = await generateImageWithChat(
    [
      "根据参考图重画同一人、同一衣服、同一场、同一画风。",
      "这是这一镜的结束帧：红帖仍压在案上，身体再前倾一点，眼神更锁。",
      "暗黑厚涂，黑金，竖屏 9:16。仍然是画，不是相机实拍。",
      "无水印、无文字、无 logo。只出一张图。",
    ].join("\n"),
    {
      aspectRatio: "9:16",
      model: "gemini-flash",
      references: [
        {
          mime: "image/jpeg",
          data: fs.readFileSync(START).toString("base64"),
        },
      ],
    },
  );
  const end = await toHttps(endRaw);
  await copyMedia(end, path.join(OUT, "gemini-end.jpg"));
  console.log("尾帧已出");

  const config = resolveArkVideoConfig();
  if (!config) throw new Error("还没配方舟");
  const preset =
    ARK_VIDEO_PRESETS.find((row) => row.id === DEFAULT_ARK_VIDEO_PRESET) ||
    ARK_VIDEO_PRESETS[0];

  console.log("出片…");
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
            "图片1是这一镜开头，必须当作第一帧。图片2是这一镜结尾，必须当作最后一帧。只在两帧之间往前演。",
            MANHUA_VIDEO_STYLE,
            "无对白。不要水印。",
          ].join("\n"),
        },
        {
          type: "image_url",
          image_url: { url: start },
          role: "first_frame",
        },
        {
          type: "image_url",
          image_url: { url: end },
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
  const resultPath = path.join(OUT, "gemini-video.json");
  if (!createRes.ok || !created.id) {
    const kind = isRealPerson(createMsg) ? "real-person" : "fail";
    fs.writeFileSync(
      resultPath,
      JSON.stringify({ video: kind, error: createMsg.slice(0, 240) }, null, 2),
    );
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
      await copyMedia(clip, path.join(OUT, "gemini-clip.mp4"));
      fs.writeFileSync(resultPath, JSON.stringify({ video: "pass" }, null, 2));
      console.log("过了");
      return;
    }
    if (status === "failed" || status === "cancelled") {
      const msg = json.error?.message || "任务失败";
      const kind = isRealPerson(msg) ? "real-person" : "fail";
      fs.writeFileSync(
        resultPath,
        JSON.stringify({ video: kind, error: msg.slice(0, 240) }, null, 2),
      );
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
