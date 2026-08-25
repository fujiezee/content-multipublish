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

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { generateImageWithChat } = await import("../src/lib/ai/openai-image");
  const prompt = [
    "竖屏 9:16 暗黑厚涂漫剧静帧，黑金风。",
    "紫袍白须老臣半身，夜，朱红门生帖拍在案上，眼神冷。",
    "底是近黑的深灰，一束硬光打在脸和手上，阴影重，饱和度低。",
    "颜色只有墨黑、暗紫、暗金，红帖是唯一亮色。",
    "精致半写实，真人比例，五官清楚。皮肤是画的，没有毛孔，没有照片噪点，没有相机实拍。",
    "不是二次元，不是赛璐璐，不是白天插画，不是真人照片。",
    "无水印、无文字、无 logo、无网址、无字幕。只出一张图。",
  ].join("\n");
  console.log("出暗黑厚涂…");
  const { url } = await generateImageWithChat(prompt, {
    aspectRatio: "9:16",
    model: "seedream-5.0",
  });
  const dest = path.join(OUT, "look.jpg");
  await copyMedia(url, dest);
  console.log(dest);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
