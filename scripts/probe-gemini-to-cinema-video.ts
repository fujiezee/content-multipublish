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
const SRC = path.join(OUT, "gemini.jpg");

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
  if (!fs.existsSync(SRC)) throw new Error("没有 gemini.jpg");
  const { generateImageWithChat, persistGeneratedImage } = await import(
    "../src/lib/ai/openai-image"
  );
  const { publishLocalCoverPath } = await import(
    "../src/lib/storage/public-media"
  );
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

  console.log("把图转成偏真实的电影静帧…");
  const { url: made } = await generateImageWithChat(
    [
      "根据参考图重画同一构图、同一人、同一衣服、同一红帖、同一站位。",
      "画风改成电影静帧，现场光，浅景深，像拍戏，往真人靠。",
      "头骨准，脸和手有体积，布料有褶皱和重量，像坐在对面的活人。",
      "仍是暗黑厚涂黑金：底近黑，硬光打脸，红帖是亮色。",
      "仍然是画，不是相机证件照，不要毛孔特写，不要照片噪点。",
      "竖屏 9:16。无水印、无文字、无 logo。只出一张图。",
    ].join("\n"),
    {
      aspectRatio: "9:16",
      model: "gemini-flash",
      references: [
        {
          mime: "image/jpeg",
          data: fs.readFileSync(SRC).toString("base64"),
        },
      ],
    },
  );
  const stillLocal = /^https?:\/\//i.test(made)
    ? await persistGeneratedImage(
        Buffer.from(
          await (await fetch(made, { signal: AbortSignal.timeout(60_000) })).arrayBuffer(),
        ),
        "image/jpeg",
      )
    : made;
  const still = await toHttps(stillLocal);
  await copyMedia(still, path.join(OUT, "gemini-as-cinema.jpg"));
  console.log("静帧已出");

  const config = resolveArkVideoConfig();
  if (!config) throw new Error("还没配方舟");
  const preset =
    ARK_VIDEO_PRESETS.find((row) => row.id === DEFAULT_ARK_VIDEO_PRESET) ||
    ARK_VIDEO_PRESETS[0];

  console.log("出片（头尾同一张电影静帧）…");
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
            "图片1是这一镜开头，必须当作第一帧。图片2是这一镜结尾，必须当作最后一帧。两张是同一个人、同一张脸。",
            "画风跟参考图走：电影静帧，暗黑，不要换脸，不要改成二次元。",
            "只做很小的动作：烛火微晃，人几乎不动。不要走位，不要换构图。",
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
  const resultPath = path.join(OUT, "gemini-as-cinema-video.json");
  if (!createRes.ok || !created.id) {
    const kind = isRealPerson(createMsg) ? "real-person" : "fail";
    fs.writeFileSync(
      resultPath,
      JSON.stringify({ video: kind, error: createMsg.slice(0, 240) }, null, 2),
    );
    console.log("创建失败", kind, createMsg.slice(0, 220));
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
      await copyMedia(clip, path.join(OUT, "gemini-as-cinema-clip.mp4"));
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
      console.log("任务失败", kind, msg.slice(0, 220));
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
