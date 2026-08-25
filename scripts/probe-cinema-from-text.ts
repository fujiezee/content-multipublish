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

const OUT = path.join(process.cwd(), "data/debug/cinema-from-text");
const LOOK =
  "男，六十上下，清瘦，白须白眉，深眼窝，神色冷。头戴黑色展脚幞头，深紫缎面官袍，暗纹云纹，腰系玉带。阁老气度，不是慈祥长者。";

async function copyMedia(url: string, dest: string) {
  if (url.startsWith("/api/uploads/")) {
    const name = decodeURIComponent(url.split("/").pop() || "");
    const src = path.join(process.cwd(), "data/uploads", name);
    fs.copyFileSync(src, dest);
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
  fs.mkdirSync(OUT, { recursive: true });
  const { generateImageWithChat, loadImageRef } = await import(
    "../src/lib/ai/openai-image"
  );
  const { manhuaCharacterPrompt, manhuaScenePrompt } = await import(
    "../src/lib/ai/manhua-look"
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

  console.log("出徐奉正面（按文字，不锁旧图）…");
  const { url: frontRaw } = await generateImageWithChat(
    manhuaCharacterPrompt({
      who: "徐奉",
      look: LOOK,
      view: "正面半身到腰，面向镜头，表情自然，可以有一个小手势，不要僵硬站桩",
      phase: "from-text",
    }),
    { aspectRatio: "3:4", model: "seedream-5.0" },
  );
  const front = await toHttps(frontRaw);
  await copyMedia(front, path.join(OUT, "xufeng-front.jpg"));
  const frontRef = await loadImageRef(front);
  if (!frontRef) throw new Error("读不了新角色图");
  console.log("  正面已出");

  const visual =
    "特写徐奉半身。夜，烛火。深紫阁老官袍，白须。红色门生帖已经拍在案上，他眼神锁着跪着的人，嘴角冷。结束时帖仍压在案上，他微微前倾。";

  const makeScene = async (phase: "start" | "end", name: string) => {
    const prompt = manhuaScenePrompt({
      who: "「徐奉」",
      visual,
      imagePrompt: "竖屏9:16电影静帧，紫袍老臣冷脸，红帖拍在案上",
      voiceover: "这一帖，签了就是烙印",
      phase,
      beat: "钩",
      look: "特写徐奉的眼睛和门生帖",
    });
    const { url } = await generateImageWithChat(prompt, {
      aspectRatio: "9:16",
      model: "seedream-5.0",
      references: [frontRef],
    });
    const https = await toHttps(url);
    await copyMedia(https, path.join(OUT, `${name}.jpg`));
    return https;
  };

  console.log("出头尾帧（锁新脸）…");
  const [start, end] = await Promise.all([
    makeScene("start", "start"),
    makeScene("end", "end"),
  ]);
  console.log("  头尾帧已出");

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
            "竖屏电影静帧短剧，画风跟参考图走，不要改成实拍照片，也不要改成二次元。",
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
  if (!createRes.ok || !created.id) {
    const kind = isRealPerson(createMsg) ? "real-person" : "fail";
    fs.writeFileSync(
      path.join(OUT, "result.json"),
      JSON.stringify({ video: kind, error: createMsg.slice(0, 240), start, end }, null, 2),
    );
    console.log("创建失败", kind, createMsg.slice(0, 180));
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
      await copyMedia(clip, path.join(OUT, "clip.mp4"));
      fs.writeFileSync(
        path.join(OUT, "result.json"),
        JSON.stringify({ video: "pass", start, end }, null, 2),
      );
      console.log("过了");
      return;
    }
    if (status === "failed" || status === "cancelled") {
      const msg = json.error?.message || "任务失败";
      const kind = isRealPerson(msg) ? "real-person" : "fail";
      fs.writeFileSync(
        path.join(OUT, "result.json"),
        JSON.stringify({ video: kind, error: msg.slice(0, 240), start, end }, null, 2),
      );
      console.log("任务失败", kind, msg.slice(0, 180));
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
