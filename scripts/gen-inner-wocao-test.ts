import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

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

const execFileAsync = promisify(execFile);
const ARTICLE_ID = "bdf44669-42c4-432b-87da-ed753b2e01e1";
const OUT = path.join(process.cwd(), "data/debug/voice-path-compare");
const NATIVE = path.join(OUT, "A-native.mp4");
const FRAMES = path.join(OUT, "E-inner.json");

async function copyMedia(url: string, dest: string) {
  if (!url) throw new Error("没有成片地址");
  if (url.startsWith("/api/uploads/")) {
    const name = decodeURIComponent(url.split("/").pop() || "");
    const src = path.join(process.cwd(), "data/uploads", name);
    if (!fs.existsSync(src)) throw new Error(`本地没有 ${name}`);
    fs.copyFileSync(src, dest);
    return;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`下载失败 ${res.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  if (!fs.existsSync(NATIVE)) throw new Error("没有刚才的对白成片");
  if (!fs.existsSync(FRAMES)) throw new Error("没有沈砚内心头尾");
  fs.mkdirSync(OUT, { recursive: true });

  const { generateArkEpisodeVideo } = await import("../src/lib/ai/ark-video");
  const { parseAngles } = await import("../src/lib/ai/character-look");
  const { getVideoSeriesByArticle, listSeriesCharacters } = await import(
    "../src/lib/db"
  );

  const series = getVideoSeriesByArticle(ARTICLE_ID);
  if (!series) throw new Error("找不到这一集");
  const cast = listSeriesCharacters(ARTICLE_ID);
  const saved = JSON.parse(fs.readFileSync(FRAMES, "utf8")) as {
    startUrl?: string;
    endUrl?: string;
    sceneUrl?: string;
    speakerId?: string;
    voiceId?: string;
  };
  const shen = cast.find((row) => row.name.includes("沈"));
  if (!shen || !saved.startUrl || !saved.endUrl) {
    throw new Error("沈砚头尾图不齐");
  }

  const innerShot = {
    index: 1,
    seconds: 4,
    visual:
      "切反应。特写沈砚跪在案前。夜，烛火。青衫，闭嘴，眼睛猛地一凛，门生帖还压在案上。不要张嘴。",
    onScreen: "卧槽",
    voiceover: "卧槽",
    imagePrompt:
      "竖屏9:16古装插画，青衫探花跪着特写，闭嘴，眼神一凛，红帖在案上，无水印无logo无网址",
    speaker: "沈砚",
    speakerId: shen.id,
    voiceId: shen.voice_id || saved.voiceId,
    delivery: "inner" as const,
    innerLevel: "high" as const,
    beat: "停" as const,
    look: "特写沈砚闭嘴的眼睛",
    startUrl: saved.startUrl,
    endUrl: saved.endUrl,
    sceneUrl: saved.sceneUrl || saved.startUrl,
  };

  const people = cast.map((row) => ({
    id: row.id,
    name: row.name,
    voice_id: row.voice_id,
    angles: parseAngles(row.angles_json || "[]"),
  }));

  console.log("出沈砚炸级内心（模型出声）…");
  const rendered = await generateArkEpisodeVideo(
    {
      seriesTitle: series.title,
      episodeNo: 1,
      title: series.title,
      hook: "徐奉把帖拍在案上",
      voiceover: "沈砚（内心·炸）：卧槽",
      onScreen: "卧槽",
      durationSec: 4,
      shots: [innerShot],
      characterName: shen.name,
      characterAngles: people
        .filter((p) => p.id === shen.id)
        .flatMap((p) => p.angles)
        .slice(0, 4),
      speakMode: "dialogue",
      cast: people.map((p) => ({
        id: p.id,
        name: p.name,
        voice_id: p.voice_id,
      })),
      stanceNotes: series.notes,
      onlyIndexes: [1],
      voicePath: "native",
      innerVoice: "high",
    },
    (e) => console.log(" ", e.message),
  );
  const inner = rendered.shots?.find((row) => row.index === 1);
  if (!inner?.clipUrl) throw new Error("内心独白没有成片");
  const innerPath = path.join(OUT, "F-inner-native.mp4");
  await copyMedia(inner.clipUrl, innerPath);
  fs.writeFileSync(path.join(OUT, "F-inner.json"), JSON.stringify(inner, null, 2));

  const stitched = path.join(OUT, "F-line-then-inner.mp4");
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-i",
      NATIVE,
      "-i",
      innerPath,
      "-filter_complex",
      "[0:v]fps=24,scale=496:864,setsar=1,format=yuv420p[v0];[1:v]fps=24,scale=496:864,setsar=1,format=yuv420p[v1];[0:a]aformat=sample_rates=48000:channel_layouts=stereo[a0];[1:a]aformat=sample_rates=48000:channel_layouts=stereo[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]",
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      stitched,
    ],
    { timeout: 60_000 },
  );
  console.log("INNER", inner.clipUrl);
  console.log("STITCH", stitched);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
