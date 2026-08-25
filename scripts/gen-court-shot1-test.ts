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

const EPISODE_ID = "03f695fc-adbc-4e8f-843e-2e1b9e9fdfbf";
const ARTICLE_ID = "bdf44669-42c4-432b-87da-ed753b2e01e1";
const OUT = path.join(process.cwd(), "data/debug/court-shot1-test");

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
  fs.mkdirSync(OUT, { recursive: true });
  const { generateEpisodeScenes } = await import("../src/lib/ai/video-scenes");
  const { generateArkEpisodeVideo } = await import("../src/lib/ai/ark-video");
  const { parseAngles, parsePhotos } = await import("../src/lib/ai/character-look");
  const { shotsFromJson, shotsToJson } = await import("../src/lib/ai/video-script");
  const {
    getVideoEpisode,
    getVideoSeriesByArticle,
    listSeriesCharacters,
    updateVideoEpisodeFields,
  } = await import("../src/lib/db");

  const episode = getVideoEpisode(EPISODE_ID);
  const series = getVideoSeriesByArticle(ARTICLE_ID);
  if (!episode || !series) throw new Error("找不到这一集");
  const cast = listSeriesCharacters(ARTICLE_ID);
  if (cast.length < 2) throw new Error("角色还没绑上");

  let shots = shotsFromJson(episode.shots_json);
  shots = shots.map((shot) => {
    if (shot.index !== 1) return shot;
    return {
      ...shot,
      beat: "钩",
      look: "特写徐奉的眼睛和门生帖",
      onScreen: "这一帖，签了就是烙印",
      visual:
        "特写徐奉半身。夜，烛火。深紫阁老官袍，白须。红色门生帖已经拍在案上，他眼神锁着跪着的人，嘴角冷，不像在讲课。结束时帖仍压在案上，他微微前倾。",
      imagePrompt:
        "竖屏9:16古装插画，紫袍老臣冷脸特写，红帖拍在案上，禁止端坐全景讲解脸，无水印无logo无网址",
      voiceId: "zh_male_dayi_uranus_bigtts",
    };
  });

  const people = cast.map((row) => ({
    id: row.id,
    name: row.name,
    voice_id: row.voice_id,
    photos: parsePhotos(row.photos_json || "[]"),
    angles: parseAngles(row.angles_json || "[]"),
  }));

  if (process.env.SKIP_SCENES !== "1") {
    console.log("出第一镜头尾…");
    shots = await generateEpisodeScenes({
      shots,
      characterName: people.map((p) => p.name).join("、"),
      characters: people,
      force: true,
      onlyIndexes: [1],
      onProgress: (e) => console.log(" ", e.message),
    });
    updateVideoEpisodeFields(episode.id, { shots_json: shotsToJson(shots) });
  }

  console.log("出第一镜视频…");
  const rendered = await generateArkEpisodeVideo(
    {
      seriesTitle: series.title,
      episodeNo: episode.episode_no,
      title: episode.title,
      hook: episode.hook,
      voiceover: episode.voiceover,
      onScreen: "这一帖，签了就是烙印",
      durationSec: episode.duration_sec,
      shots,
      characterName: people.map((p) => p.name).join("、"),
      characterAngles: people.flatMap((p) => p.angles).slice(0, 4),
      speakMode: "dialogue",
      cast: people.map((p) => ({
        id: p.id,
        name: p.name,
        voice_id: p.voice_id,
      })),
      stanceNotes: series.notes,
      force: true,
      onlyIndexes: [1],
    },
    (e) => console.log(" ", e.message),
  );
  shots = rendered.shots;
  updateVideoEpisodeFields(episode.id, { shots_json: shotsToJson(shots) });

  const shot = shots.find((row) => row.index === 1);
  if (!shot?.clipUrl) throw new Error("第一镜没有成片");
  const dest = path.join(OUT, "shot-1.mp4");
  await copyMedia(shot.clipUrl, dest);
  if (shot.speechUrl) {
    await copyMedia(shot.speechUrl, path.join(OUT, "shot-1.mp3"));
  }
  fs.writeFileSync(path.join(OUT, "shot.json"), JSON.stringify(shot, null, 2));
  console.log("CLIP", shot.clipUrl);
  console.log("LOCAL", dest);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
