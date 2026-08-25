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
const REF = path.join(OUT, "gemini-realer.jpg");

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
  if (!fs.existsSync(REF)) throw new Error("没有 gemini-realer.jpg");
  const { generateImageWithChat } = await import("../src/lib/ai/openai-image");
  const ref = {
    mime: "image/jpeg",
    data: fs.readFileSync(REF).toString("base64"),
  };

  const prompt = [
    "根据参考图重画同一构图、同一人、同一衣服、同一红帖、同一烛火。",
    "画风改成暗黑厚涂的电影静帧：现场光，浅景深，像拍戏。",
    "再往真人靠一档：头骨准，眼窝鼻梁下颌清楚，脸和手有体积，布料有褶皱和重量。",
    "底近黑，硬光打脸，墨黑暗紫暗金，红帖是唯一亮色。",
    "像坐在对面的活人，但仍然是画，不是相机实拍，不要毛孔特写，不要照片噪点。",
    "不是二次元，不是赛璐璐，不是卡通。",
    "竖屏 9:16。无水印、无文字、无 logo。只出一张图。",
  ].join("\n");

  console.log("出 Gemini 暗黑电影静帧…");
  const { url } = await generateImageWithChat(prompt, {
    aspectRatio: "9:16",
    model: "gemini-flash",
    references: [ref],
  });
  const dest = path.join(OUT, "gemini-cinema.jpg");
  await copyMedia(url, dest);
  console.log(dest);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
