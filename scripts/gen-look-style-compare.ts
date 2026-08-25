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

const OUT = path.join(process.cwd(), "data/debug/look-compare");

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
  const { LOOK_STYLES } = await import("../src/lib/ai/look-styles");
  const { manhuaScenePrompt } = await import("../src/lib/ai/manhua-look");
  const { generateImageWithChat } = await import("../src/lib/ai/openai-image");

  await Promise.all(
    LOOK_STYLES.map(async (look) => {
      const prompt = manhuaScenePrompt({
        who: "「徐奉」",
        visual:
          "紫袍白须老臣半身，夜，朱红门生帖拍在案上，右手按住红帖，眼神冷。",
        lookStyle: look.id,
      });
      console.log(`出 ${look.label}…`);
      const { url } = await generateImageWithChat(prompt, {
        aspectRatio: "9:16",
        model: "gemini-flash",
      });
      const dest = path.join(OUT, `${look.id}.jpg`);
      await copyMedia(url, dest);
      console.log(`  ${look.label} ${dest}`);
    }),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
