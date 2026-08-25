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

const OUT = path.join(process.cwd(), "public/home");

const COVERS: Array<{ file: string; title: string; story: string; banner: string }> = [
  {
    file: "cover-geo.jpg",
    title: "别人问起你时，答案里有你",
    story: `第一格 · 开场：老板问豆包「有没有靠谱的 xx」，屏幕上全是别人的名字，自己的品牌没有。
第二格 · 转折：同事摊手「我们从没发出去过能被引用的内容」。
第三格 · 结局：发出文章和短视频后，再问同一句，答案里出现你们。`,
    banner: "发出去，答案里才有你",
  },
  {
    file: "cover-article.jpg",
    title: "网上能搜到你",
    story: `第一格 · 开场：搜品牌名，首页没有自己的文章。
第二格 · 转折：把资料写成一篇能发的稿，配上图。
第三格 · 结局：再搜，出处里有你们。`,
    banner: "先有稿，才有人搜到你",
  },
  {
    file: "cover-mention.jpg",
    title: "发完看提没提你",
    story: `第一格 · 开场：稿发出去了，不知道 AI 提没提。
第二格 · 转折：去问豆包、DeepSeek 同一句。
第三格 · 结局：答案里有没有你，一眼能看出来。`,
    banner: "发完要去问一句",
  },
];

function comicPrompt(cover: (typeof COVERS)[number]) {
  return `Create a SCROLL-STOPPING Xiaohongshu-style knowledge COMIC STRIP (小红书条漫 / 好玩信息图).
Hand-drawn doodle on cream/beige spiral notebook paper, pen outlines, marker highlights.
NOT a corporate slide, NOT a photoreal photo, NOT a tech circuit banner, NOT neon, NOT 3D glass UI.

Format: vertical portrait 3:4, mobile feed.

STORY:
- Cute doodle characters, exaggerated expressions, colloquial Chinese speech bubbles
- 3 visual beats, top to bottom
- Big punchy title at top (largest text): ${cover.title}
- Small category pill: 点物GEO
${cover.story}
- Bottom accent banner: ${cover.banner}

Visual style:
- Cream notebook, warm sketchbook, slightly messy
- Accent color #c9a227 gold
- All visible text: Simplified Chinese, short phrases only
- Watermark bottom corner (small): 点物GEO dianwu.ai
- No English paragraphs, no URLs except the watermark, no photoreal faces`;
}

async function copyMedia(url: string, dest: string) {
  if (url.startsWith("/api/uploads/")) {
    const name = decodeURIComponent(url.split("/").pop() || "");
    fs.copyFileSync(path.join(process.cwd(), "data/uploads", name), dest);
    return;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`下载失败 ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { generateGeminiStill } = await import("../src/lib/ai/openai-image");
  const errors: string[] = [];
  for (const cover of COVERS) {
    const dest = path.join(OUT, cover.file);
    console.log(`出条漫 ${cover.title}…`);
    try {
      const { url } = await generateGeminiStill(comicPrompt(cover), {
        aspectRatio: "3:4",
      });
      await copyMedia(url, dest);
      console.log(`  ${dest}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${cover.file}: ${msg}`);
      console.error(`  失败 ${cover.file}: ${msg}`);
    }
  }
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`完成 ${OUT}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
