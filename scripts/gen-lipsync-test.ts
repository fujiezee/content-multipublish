import { execFile } from "child_process";
import { randomUUID } from "crypto";
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
const EPISODE_ID = "03f695fc-adbc-4e8f-843e-2e1b9e9fdfbf";
const ARTICLE_ID = "bdf44669-42c4-432b-87da-ed753b2e01e1";
const OUT = path.join(process.cwd(), "data/debug/voice-path-compare");
const NATIVE = path.join(OUT, "A-native.mp4");

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
  if (!fs.existsSync(NATIVE)) throw new Error("没有模型出声成片，先出一镜再对口型");
  const probe = path.join(OUT, "C-from-native.mp3");
  await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name,duration,sample_rate",
      "-of",
      "json",
      NATIVE,
    ],
    { timeout: 15_000 },
  ).then(({ stdout }) => {
    const info = JSON.parse(stdout) as {
      streams?: Array<{ codec_name?: string; duration?: string }>;
    };
    const audio = info.streams?.[0];
    if (!audio) throw new Error("模型出声成片没有音轨，抽不出声音对口型");
    console.log("native audio", audio);
  });
  await execFileAsync(
    "ffmpeg",
    ["-y", "-i", NATIVE, "-vn", "-ac", "1", "-ar", "48000", "-q:a", "4", probe],
    { timeout: 30_000 },
  );
  if (!fs.existsSync(probe) || fs.statSync(probe).size < 64) {
    throw new Error("从模型出声成片抽声音失败");
  }
  console.log("extracted", probe, fs.statSync(probe).size);

  const { generateArkEpisodeVideo } = await import("../src/lib/ai/ark-video");
  const { parseAngles } = await import("../src/lib/ai/character-look");
  const { shotsFromJson } = await import("../src/lib/ai/video-script");
  const { shotCanLipSync, shotHasKeyframes } = await import("../src/lib/types");
  const {
    getVideoEpisode,
    getVideoSeriesByArticle,
    listSeriesCharacters,
  } = await import("../src/lib/db");

  const episode = getVideoEpisode(EPISODE_ID);
  const series = getVideoSeriesByArticle(ARTICLE_ID);
  if (!episode || !series) throw new Error("找不到这一集");
  const cast = listSeriesCharacters(ARTICLE_ID);
  const shots = shotsFromJson(episode.shots_json);
  const name = `${randomUUID()}.mp4`;
  const staged = path.join(process.cwd(), "data/uploads", name);
  fs.copyFileSync(NATIVE, staged);
  const clipUrl = `/api/uploads/${name}`;
  const next = shots.map((shot) =>
    shot.index === 1
      ? { ...shot, clipUrl, rawClipUrl: clipUrl }
      : shot,
  );
  const first = next.find((shot) => shot.index === 1);
  if (!first || !shotHasKeyframes(first) || !shotCanLipSync(first)) {
    throw new Error("第一镜缺头尾图或成片，不能对口型");
  }

  const people = cast.map((row) => ({
    id: row.id,
    name: row.name,
    voice_id: row.voice_id,
    angles: parseAngles(row.angles_json || "[]"),
  }));
  console.log("C 用模型出声成片对口型…");
  const out = await generateArkEpisodeVideo(
    {
      seriesTitle: series.title,
      episodeNo: episode.episode_no,
      title: episode.title,
      hook: episode.hook,
      voiceover: episode.voiceover,
      onScreen: episode.on_screen,
      durationSec: episode.duration_sec,
      shots: next,
      characterName: people.map((p) => p.name).join("、"),
      characterAngles: people.flatMap((p) => p.angles).slice(0, 4),
      speakMode: "dialogue",
      cast: people.map((p) => ({
        id: p.id,
        name: p.name,
        voice_id: p.voice_id,
      })),
      stanceNotes: series.notes,
      onlyIndexes: [1],
      voicePath: "lipsync",
    },
    (e) => console.log(" ", e.message),
  );
  const shot = out.shots?.find((row) => row.index === 1);
  if (!shot?.clipUrl) throw new Error("对口型没有成片");
  const dest = path.join(OUT, "C-lipsync.mp4");
  await copyMedia(shot.clipUrl, dest);
  console.log("C", shot.clipUrl);
  console.log("C", dest);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
