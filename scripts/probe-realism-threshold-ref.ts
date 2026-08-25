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

const OUT = path.join(process.cwd(), "data/debug/realism-threshold-ref");
const SCENE =
  "紫袍白须老臣半身，夜，烛火，朱红门生帖拍在案上。竖屏 9:16。表情冷，不是讲课脸。必须和参考图是同一个人。";
const START_BEAT = "开头：帖刚拍上案，眼神锁着对面跪着的人。";
const END_BEAT = "结尾：帖仍压在案上，身体再前倾一点。";
const EXISTING_START =
  "https://api.vigma.app/files/uploads/1786845028685-dwgeo-cb0d1175-31df-47a5-bbe2-86db3f4cfad0.jpg";
const EXISTING_END =
  "https://api.vigma.app/files/uploads/1786845011702-dwgeo-8f4e936a-d378-4b80-8d6b-98476d3b7225.jpg";
const XUFENG_FRONT =
  "https://api.vigma.app/files/uploads/1786839743250-dwgeo-d4b8a7d5-abdd-47b4-b5d7-086403a8f461.jpg";

const STYLES = [
  {
    id: "r1-morning",
    label: "锁脸+早上半写实",
    style: [
      "精致半写实商业插画，真人比例，五官清楚，像个活人。",
      "柔和数字绘画光影，不是二次元大眼睛，不是赛璐璐平涂，不是卡通变形。",
      "皮肤是画的：没有毛孔、没有照片噪点、没有相机实拍。",
    ].join(""),
  },
  {
    id: "r2-volume",
    label: "锁脸+当前偏写实",
    style: [
      "偏写实的精致半写实商业插画，真人比例，骨骼清楚，五官准，像个活人。",
      "数字绘画光影要扎实：脸和衣服有体积，布料有褶皱和重量，空间能站住。",
      "皮肤是画出来的：有体积、有冷暖，但没有毛孔、没有照片噪点、没有相机实拍。",
    ].join(""),
  },
  {
    id: "r5-cinema",
    label: "锁脸+电影静帧",
    style: [
      "电影静帧，现场光，浅景深，构图完整，脸和手清楚。",
      "像拍戏：皮肤有体积，布料有褶皱和重量，空间能站住。",
    ].join(""),
  },
];

type Row = {
  id: string;
  label: string;
  startUrl?: string;
  endUrl?: string;
  video: "pending" | "pass" | "real-person" | "fail";
  videoError?: string;
};

function writeState(rows: Row[]) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, "result.json"),
    JSON.stringify({ at: new Date().toISOString(), rows }, null, 2),
  );
}

async function copyMedia(url: string, dest: string) {
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

  const ref = await loadImageRef(XUFENG_FRONT);
  if (!ref) throw new Error("读不了徐奉角色图");

  const rows: Row[] = [
    { id: "r0-existing", label: "现有第一镜头尾（已知真人脸）", video: "pending" },
    ...STYLES.map((s) => ({ id: s.id, label: s.label, video: "pending" as const })),
  ];
  rows[0].startUrl = EXISTING_START;
  rows[0].endUrl = EXISTING_END;
  writeState(rows);

  for (let i = 0; i < STYLES.length; i += 1) {
    const level = STYLES[i];
    const dir = path.join(OUT, level.id);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`\n=== 出图 ${level.id} ${level.label} ===`);
    const make = async (beat: string, name: string) => {
      const { url } = await generateImageWithChat(
        [
          "根据参考图转绘同一个人。",
          beat,
          SCENE,
          level.style,
          "无水印、无文字、无 logo。只出一张图。",
        ].join("\n"),
        { aspectRatio: "9:16", model: "seedream-5.0", references: [ref] },
      );
      const published = await publishLocalCoverPath(url);
      const https =
        published && /^https:\/\//i.test(published) ? published : url;
      if (!/^https:\/\//i.test(https)) throw new Error("没有公网地址");
      await copyMedia(https, path.join(dir, `${name}.jpg`));
      return https;
    };
    const [start, end] = await Promise.all([
      make(START_BEAT, "start"),
      make(END_BEAT, "end"),
    ]);
    rows[i + 1].startUrl = start;
    rows[i + 1].endUrl = end;
    writeState(rows);
    console.log("  头尾帧已出");
  }

  for (const row of rows) {
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
                  "无对白。不要水印。",
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
      await copyMedia(clip, path.join(OUT, `${row.id}.mp4`));
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

  console.log("\n=== 锁脸阈值 ===");
  for (const row of rows) {
    console.log(`${row.id}\t${row.video}\t${row.label}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
