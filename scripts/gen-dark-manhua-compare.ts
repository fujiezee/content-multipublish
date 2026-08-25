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
const PROMPT = [
  "竖屏 9:16 暗黑厚涂漫剧静帧，黑金风。",
  "紫袍白须老臣半身，夜，朱红门生帖拍在案上，眼神冷，像个活人。",
  "真人比例，骨骼清楚，五官准。底是近黑的深灰，一束硬光打在脸和手上，阴影重。",
  "颜色只有墨黑、暗紫、暗金，红帖是唯一亮色。",
  "精致半写实商业插画。皮肤是画的：没有毛孔、没有照片噪点、没有相机实拍。",
  "不是二次元大眼睛，不是赛璐璐平涂，不是卡通变形，不是白天插画。",
  "无水印、无文字、无 logo、无网址、无字幕。只出一张图。",
].join("\n");

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

  const run = async (model: string, name: string) => {
    console.log(`出 ${name}…`);
    const { url } = await generateImageWithChat(PROMPT, {
      aspectRatio: "9:16",
      model,
    });
    const dest = path.join(OUT, name);
    await copyMedia(url, dest);
    console.log(`  ${dest}`);
  };

  await Promise.all([
    run("seedream-5.0", "doubao-5.jpg"),
    run("gemini-flash", "gemini.jpg"),
  ]);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
