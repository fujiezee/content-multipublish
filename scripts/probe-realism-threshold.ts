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

const OUT = path.join(process.cwd(), "data/debug/realism-threshold");
const SCENE =
  "紫袍白须老臣半身，夜，烛火，朱红门生帖拍在案上。竖屏 9:16。表情冷，不是讲课脸。";
const START_BEAT = "开头：帖刚拍上案，眼神锁着对面跪着的人。";
const END_BEAT = "结尾：帖仍压在案上，身体再前倾一点。";

type Level = {
  id: string;
  label: string;
  style: string;
};

const LEVELS: Level[] = [
  {
    id: "l1-morning",
    label: "早上过审：精致半写实",
    style: [
      "精致半写实商业插画，真人比例，五官清楚，像个活人。",
      "柔和数字绘画光影，不是二次元大眼睛，不是赛璐璐平涂，不是卡通变形。",
      "皮肤是画的：没有毛孔、没有照片噪点、没有相机实拍。",
    ].join(""),
  },
  {
    id: "l2-volume",
    label: "当前：偏写实+体积",
    style: [
      "偏写实的精致半写实商业插画，真人比例，骨骼清楚，五官准，像个活人。",
      "数字绘画光影要扎实：脸和衣服有体积，布料有褶皱和重量，空间能站住。",
      "不是二次元大眼睛，不是赛璐璐平涂，不是卡通变形。",
      "皮肤是画出来的：有体积、有冷暖，但没有毛孔、没有照片噪点、没有相机实拍。",
    ].join(""),
  },
  {
    id: "l3-structure",
    label: "再写实：头骨+定向光",
    style: [
      "偏写实商业插画，接近写实但明显是数字绘画。",
      "真人比例，头骨结构准，眼窝鼻梁下颌清楚。",
      "光影有方向：受光面和阴影面分开，衣服有厚度和褶皱。",
      "皮肤是画的，有冷暖过渡，没有毛孔，没有照片噪点，没有相机实拍。",
      "禁止二次元、赛璐璐、卡通变形。",
    ].join(""),
  },
  {
    id: "l4-depth",
    label: "更写实：浅景深+高完成度",
    style: [
      "高完成度半写实数字绘画，浅景深，人物有体积。",
      "皮肤有体积和冷暖，布料有重量，空间能站住。",
      "仍然是绘画，不是照片，没有毛孔，没有相机噪点，没有实拍。",
      "禁止二次元、赛璐璐。",
    ].join(""),
  },
  {
    id: "l5-cinema",
    label: "电影静帧（已知会拦）",
    style: [
      "电影静帧，现场光，浅景深，构图完整，脸和手清楚。",
      "像拍戏：皮肤有体积，布料有褶皱和重量，空间能站住。禁止卡通平涂、二次元、赛璐璐、大眼睛变形、塑料脸、动画片。",
    ].join(""),
  },
];

type LevelResult = {
  id: string;
  label: string;
  startUrl?: string;
  endUrl?: string;
  startFile?: string;
  endFile?: string;
  imageError?: string;
  video: "pending" | "pass" | "real-person" | "fail";
  videoError?: string;
  clipFile?: string;
};

function writeState(rows: LevelResult[]) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, "result.json"),
    JSON.stringify({ at: new Date().toISOString(), rows }, null, 2),
  );
}

async function copyMedia(url: string, dest: string) {
  if (url.startsWith("/api/uploads/")) {
    const name = decodeURIComponent(url.split("/").pop() || "");
    const src = path.join(process.cwd(), "data/uploads", name);
    if (!fs.existsSync(src)) throw new Error(`本地没有 ${name}`);
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
  const { generateImageWithChat } = await import("../src/lib/ai/openai-image");
  const { publishLocalCoverPath } = await import(
    "../src/lib/storage/public-media"
  );
  const {
    resolveArkVideoConfig,
    ARK_VIDEO_PRESETS,
    DEFAULT_ARK_VIDEO_PRESET,
  } = await import("../src/lib/ai/ark-video");

  const config = resolveArkVideoConfig();
  if (!config) throw new Error("还没配方舟");
  const preset =
    ARK_VIDEO_PRESETS.find((row) => row.id === DEFAULT_ARK_VIDEO_PRESET) ||
    ARK_VIDEO_PRESETS[0];

  const rows: LevelResult[] = LEVELS.map((level) => ({
    id: level.id,
    label: level.label,
    video: "pending",
  }));
  writeState(rows);

  for (let i = 0; i < LEVELS.length; i += 1) {
    const level = LEVELS[i];
    const dir = path.join(OUT, level.id);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`\n=== 出图 ${level.id} ${level.label} ===`);
    try {
      const make = async (beat: string, name: string) => {
        const { url } = await generateImageWithChat(
          [
            beat,
            SCENE,
            level.style,
            "无水印、无文字、无 logo、无网址、无字幕。只出一张图。",
          ].join("\n"),
          { aspectRatio: "9:16", model: "seedream-5.0" },
        );
        const published = await publishLocalCoverPath(url);
        const https =
          published &&
          /^https:\/\//i.test(published) &&
          !/127\.0\.0\.1|localhost/i.test(published)
            ? published
            : /^https:\/\//i.test(url)
              ? url
              : "";
        if (!https) throw new Error("出图没有公网地址");
        const file = path.join(dir, `${name}.jpg`);
        await copyMedia(https, file);
        return { https, file };
      };
      const [start, end] = await Promise.all([
        make(START_BEAT, "start"),
        make(END_BEAT, "end"),
      ]);
      rows[i].startUrl = start.https;
      rows[i].endUrl = end.https;
      rows[i].startFile = start.file;
      rows[i].endFile = end.file;
      writeState(rows);
      console.log("  头尾帧已出");
    } catch (err) {
      rows[i].imageError = err instanceof Error ? err.message : String(err);
      rows[i].video = "fail";
      writeState(rows);
      console.log("  出图失败", rows[i].imageError);
    }
  }

  for (let i = 0; i < LEVELS.length; i += 1) {
    const row = rows[i];
    if (!row.startUrl || !row.endUrl) continue;
    console.log(`\n=== 出片 ${row.id} ${row.label} ===`);
    try {
      const createRes = await fetch(
        `${config.baseUrl}/contents/generations/tasks`,
        {
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
                  "竖屏半写实插画短剧，画风跟参考图走，不要改成实拍，也不要改成二次元。",
                  "无对白。不要水印，不要 logo，不要屏幕字幕。",
                ].join("\n"),
              },
              {
                type: "image_url",
                image_url: { url: row.startUrl },
                role: "first_frame",
              },
              {
                type: "image_url",
                image_url: { url: row.endUrl },
                role: "last_frame",
              },
            ],
            resolution: preset.resolution,
            duration: 5,
            watermark: false,
            generate_audio: false,
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      const created = (await createRes.json()) as {
        id?: string;
        error?: { message?: string };
        message?: string;
      };
      const createMsg = created.error?.message || created.message || "";
      if (!createRes.ok || !created.id) {
        row.video = isRealPerson(createMsg) ? "real-person" : "fail";
        row.videoError = createMsg.slice(0, 240);
        writeState(rows);
        console.log("  创建失败", row.video, row.videoError);
        continue;
      }
      const started = Date.now();
      let clip = "";
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
          clip = json.content?.video_url?.trim() || "";
          break;
        }
        if (status === "failed" || status === "cancelled") {
          const msg = json.error?.message || "任务失败";
          row.video = isRealPerson(msg) ? "real-person" : "fail";
          row.videoError = msg.slice(0, 240);
          writeState(rows);
          console.log("  任务失败", row.video, row.videoError);
          clip = "";
          break;
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
      if (row.video !== "pending") continue;
      if (!clip) {
        row.video = "fail";
        row.videoError = "出片超时";
        writeState(rows);
        console.log("  超时");
        continue;
      }
      const clipFile = path.join(OUT, row.id, "clip.mp4");
      await copyMedia(clip, clipFile);
      row.clipFile = clipFile;
      row.video = "pass";
      writeState(rows);
      console.log("  过了");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      row.video = isRealPerson(msg) ? "real-person" : "fail";
      row.videoError = msg.slice(0, 240);
      writeState(rows);
      console.log("  异常", row.video, row.videoError);
    }
  }

  console.log("\n=== 阈值结果 ===");
  for (const row of rows) {
    console.log(`${row.id}\t${row.video}\t${row.label}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
