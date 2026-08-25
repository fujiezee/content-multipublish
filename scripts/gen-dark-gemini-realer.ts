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
  "竖屏 9:16 暗黑厚涂漫剧静帧，黑金风，往真人靠。",
  "紫袍白须老臣半身，夜，朱红门生帖拍在案上，眼神冷。",
  "真人比例，头骨准，眼窝鼻梁下颌清楚，脸和手有体积，像坐在对面的活人。",
  "底近黑，一束硬光打脸和手，阴影重。墨黑、暗紫、暗金，红帖是唯一亮色。",
  "偏写实的半写实：光影扎实，布料有褶皱和重量，不是卡通，不是二次元，不是赛璐璐。",
  "仍然是画，不是相机实拍，不要毛孔特写，不要照片噪点。",
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
  console.log("出 Gemini 更靠真人…");
  const { url } = await generateImageWithChat(PROMPT, {
    aspectRatio: "9:16",
    model: "gemini-flash",
  });
  const dest = path.join(OUT, "gemini-realer.jpg");
  await copyMedia(url, dest);
  console.log(dest);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
