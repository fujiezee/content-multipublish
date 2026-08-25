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
const OUT = path.join(process.cwd(), "data/debug/voice-path-compare");

async function download(url: string, dest: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`下载失败 ${res.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function probeOnset(file: string) {
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
    ["-i", file, "-af", "silencedetect=noise=-35dB:d=0.15", "-f", "null", "-"],
    { timeout: 20_000 },
  ).catch((err: { stderr?: string }) => ({ stderr: err.stderr || "" }));
  const ends = [...String(stderr).matchAll(/silence_end: ([\d.]+)/g)].map((m) =>
    Number(m[1]),
  );
  const starts = [...String(stderr).matchAll(/silence_start: ([\d.]+)/g)].map(
    (m) => Number(m[1]),
  );
  const onset = starts[0] === 0 ? ends[0] || 0 : 0;
  return {
    duration: Number(duration.toFixed(2)),
    onset: Number(onset.toFixed(2)),
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { getVideoEpisode, getVideoSeriesByArticle } = await import(
    "../src/lib/db"
  );
  const { shotsFromJson } = await import("../src/lib/ai/video-script");
  const { synthesizeSpeechOrThrow } = await import("../src/lib/ai/ark-tts");

  const episode = getVideoEpisode("5a5122c2-ea88-406a-8359-3b7516e91d07");
  const series = getVideoSeriesByArticle("19c6912b-bda5-4d00-adaf-e37c6be65962");
  if (!episode || !series) throw new Error("找不到这一集");
  const shots = shotsFromJson(episode.shots_json).slice(0, 2);
  const rows: Array<{
    index: number;
    line: string;
    native?: { duration: number; onset: number; file: string };
    tts?: { duration: number; onset: number; file: string };
    ttsError?: string;
  }> = [];

  for (const shot of shots) {
    if (!shot.clipUrl) continue;
    const mp4 = path.join(OUT, `A-native-shot${shot.index}.mp4`);
    await download(shot.clipUrl, mp4);
    const native = await probeOnset(mp4);
    const row: (typeof rows)[number] = {
      index: shot.index,
      line: shot.voiceover,
      native: { ...native, file: mp4 },
    };
    const voice = shot.voiceId || series.voice_id;
    try {
      const clip = await synthesizeSpeechOrThrow(shot.voiceover, voice, {
        punch: false,
      });
      const dest = path.join(OUT, `B-tts-shot${shot.index}.mp3`);
      fs.writeFileSync(dest, clip.buffer);
      row.tts = { ...(await probeOnset(dest)), file: dest };
    } catch (err) {
      row.ttsError = err instanceof Error ? err.message : String(err);
    }
    rows.push(row);
    console.log(JSON.stringify(row, null, 2));
  }

  fs.writeFileSync(path.join(OUT, "audio-report.json"), JSON.stringify(rows, null, 2));
  const cards = rows
    .map((row) => {
      const nativeSrc = row.native
        ? path.basename(row.native.file)
        : "";
      const ttsSrc = row.tts ? path.basename(row.tts.file) : "";
      return `<section>
  <h2>第 ${row.index} 镜</h2>
  <p>${row.line}</p>
  <div class="row">
    <div class="col">
      <h3>A 模型出声（已有成片）</h3>
      ${nativeSrc ? `<video src="${nativeSrc}" controls playsinline></video>` : "<p>没有成片</p>"}
      <p>${row.native ? `时长 ${row.native.duration}s · 开口约 ${row.native.onset}s` : ""}</p>
    </div>
    <div class="col">
      <h3>B TTS 先出（只听声音）</h3>
      ${ttsSrc ? `<audio src="${ttsSrc}" controls></audio>` : `<p>${row.ttsError || "没有配音"}</p>`}
      <p>${row.tts ? `时长 ${row.tts.duration}s · 开口约 ${row.tts.onset}s` : ""}</p>
    </div>
  </div>
</section>`;
    })
    .join("\n");
  fs.writeFileSync(
    path.join(OUT, "compare.html"),
    `<!doctype html>
<meta charset="utf-8">
<title>口播出声对比</title>
<style>
  body{font:16px/1.5 sans-serif;margin:24px;background:#111;color:#eee}
  h1,h2,h3{font-weight:600}
  .row{display:flex;gap:16px;flex-wrap:wrap}
  .col{flex:1;min-width:280px}
  video,audio{width:100%;background:#000}
  p{color:#bbb}
  section{margin:0 0 32px}
</style>
<h1>${episode.title} · 模型出声 vs TTS</h1>
<p>视频账号欠费，对口型成片没能新出。左边是已经出过的模型成片，右边是同一句刚合成的 TTS。</p>
${cards}
`,
  );
  console.log("对比页", path.join(OUT, "compare.html"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
