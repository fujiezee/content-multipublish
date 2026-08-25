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
const EPISODE_ID = "5a5122c2-ea88-406a-8359-3b7516e91d07";
const ARTICLE_ID = "19c6912b-bda5-4d00-adaf-e37c6be65962";
const OUT = path.join(process.cwd(), "data/debug/voice-path-compare");

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

async function probeClip(file: string) {
  const { stdout: durOut } = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ],
    { timeout: 15_000 },
  );
  const duration = Number(durOut.trim()) || 0;
  const { stderr } = await execFileAsync(
    "ffmpeg",
    [
      "-i",
      file,
      "-af",
      "silencedetect=noise=-35dB:d=0.15",
      "-f",
      "null",
      "-",
    ],
    { timeout: 20_000 },
  ).catch((err: { stderr?: string }) => ({ stderr: err.stderr || "" }));
  const starts = [...String(stderr).matchAll(/silence_start: ([\d.]+)/g)].map(
    (m) => Number(m[1]),
  );
  const ends = [...String(stderr).matchAll(/silence_end: ([\d.]+)/g)].map((m) =>
    Number(m[1]),
  );
  const onset = ends[0] != null && ends[0] < 2.5 ? ends[0] : starts[0] === 0 ? ends[0] || 0 : 0;
  return { duration, onset: Number(onset.toFixed(2)), silenceStarts: starts, silenceEnds: ends };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { generateArkEpisodeVideo } = await import("../src/lib/ai/ark-video");
  const { parseAngles } = await import("../src/lib/ai/character-look");
  const { shotsFromJson } = await import("../src/lib/ai/video-script");
  const {
    getVideoEpisode,
    getVideoSeriesByArticle,
    listSeriesCharacters,
  } = await import("../src/lib/db");

  const episode = getVideoEpisode(EPISODE_ID);
  const series = getVideoSeriesByArticle(ARTICLE_ID);
  if (!episode || !series) throw new Error("找不到这一集");
  const cast = listSeriesCharacters(ARTICLE_ID);
  const shots = shotsFromJson(episode.shots_json).map((shot) => ({
    ...shot,
    framesOk: true,
  }));
  const people = cast.map((row) => ({
    id: row.id,
    name: row.name,
    voice_id: row.voice_id,
    angles: parseAngles(row.angles_json || "[]"),
  }));
  const base = {
    seriesTitle: series.title,
    episodeNo: episode.episode_no,
    title: episode.title,
    hook: episode.hook,
    voiceover: episode.voiceover,
    onScreen: episode.on_screen,
    durationSec: episode.duration_sec,
    shots,
    characterName: people.map((p) => p.name).join("、"),
    characterAngles: people.flatMap((p) => p.angles).slice(0, 4),
    speakMode: "dialogue" as const,
    voiceId: series.voice_id,
    hookStyle: series.hook_style || "talk",
    lookStyle: series.look_style || "dark",
    cast: people.map((p) => ({
      id: p.id,
      name: p.name,
      voice_id: p.voice_id,
    })),
    stanceNotes: series.notes,
    force: true,
    onlyIndexes: [1],
  };

  console.log("口播对比", episode.title);
  console.log("对白", shots[0]?.voiceover);

  console.log("A 模型直接出声…");
  const native = await generateArkEpisodeVideo(
    { ...base, voicePath: "native" },
    (e) => console.log(" ", e.message),
  );
  const nativeShot = native.shots.find((row) => row.index === 1);
  if (!nativeShot?.clipUrl) throw new Error("模型出声没有成片");
  const nativePath = path.join(OUT, "A-native.mp4");
  await copyMedia(nativeShot.clipUrl, nativePath);
  console.log("A", nativePath);

  console.log("B 先 TTS 再对口型…");
  const tts = await generateArkEpisodeVideo(
    { ...base, voicePath: "tts" },
    (e) => console.log(" ", e.message),
  );
  const ttsShot = tts.shots.find((row) => row.index === 1);
  if (!ttsShot?.clipUrl) throw new Error("配音对口型没有成片");
  const ttsPath = path.join(OUT, "B-tts.mp4");
  await copyMedia(ttsShot.clipUrl, ttsPath);
  console.log("B", ttsPath);

  const a = await probeClip(nativePath);
  const b = await probeClip(ttsPath);
  const report = {
    title: episode.title,
    line: shots[0]?.voiceover,
    A_native: a,
    B_tts: b,
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(OUT, "compare.html"),
    `<!doctype html>
<meta charset="utf-8">
<title>口播出声对比</title>
<style>
  body{font:16px/1.5 sans-serif;margin:24px;background:#111;color:#eee}
  h1{font-size:18px}
  .row{display:flex;gap:16px;flex-wrap:wrap}
  .col{flex:1;min-width:280px}
  video{width:100%;background:#000}
  p{color:#bbb}
</style>
<h1>${episode.title} · 第一镜</h1>
<p>${shots[0]?.voiceover || ""}</p>
<div class="row">
  <div class="col">
    <h2>A 模型出声</h2>
    <video src="A-native.mp4" controls playsinline></video>
    <p>时长 ${a.duration.toFixed(2)}s · 开口约 ${a.onset}s</p>
  </div>
  <div class="col">
    <h2>B TTS 先出再对口型</h2>
    <video src="B-tts.mp4" controls playsinline></video>
    <p>时长 ${b.duration.toFixed(2)}s · 开口约 ${b.onset}s</p>
  </div>
</div>
`,
  );
  console.log(JSON.stringify(report, null, 2));
  console.log("对比页", path.join(OUT, "compare.html"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
