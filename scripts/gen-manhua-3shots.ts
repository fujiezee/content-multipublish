import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] == null) process.env[key] = val;
  }
}

loadEnv();

const OUT = path.join(process.cwd(), "data/debug/manhua-3shot");

async function copyMedia(url: string, dest: string) {
  if (!url) throw new Error("没有成片地址");
  if (url.startsWith("/api/uploads/")) {
    const name = decodeURIComponent(url.split("/").pop() || "");
    const src = path.join(process.cwd(), "data/uploads", name);
    if (!fs.existsSync(src)) throw new Error(`本地没有 ${name}`);
    fs.copyFileSync(src, dest);
    return;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`下载失败 ${res.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { generateEpisodeScenes } = await import("../src/lib/ai/video-scenes");
  const { generateArkEpisodeVideo } = await import("../src/lib/ai/ark-video");
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(path.join(process.cwd(), "data/content.db"), {
    readonly: true,
  });
  const people = ["司马生", "老臣"].map((name) => {
    const row = db
      .prepare(
        `SELECT id, name, voice_id, angles_json FROM studio_characters WHERE name = ?`,
      )
      .get(name) as {
      id: string;
      name: string;
      voice_id: string;
      angles_json: string;
    };
    const angles = JSON.parse(row.angles_json || "[]") as Array<{
      id: string;
      label: string;
      url: string;
    }>;
    if (!row) throw new Error(`角色库没有「${name}」`);
    return {
      id: row.id,
      name: row.name,
      voice_id: row.voice_id,
      angles,
    };
  });
  db.close();

  let shots = [
    {
      index: 1,
      seconds: 6,
      beat: "钩",
      look: "特写被扔的折子",
      speaker: "司马生",
      speakerId: people[0].id,
      voiceId: people[0].voice_id,
      visual:
        "开头殿上司马生站着，折子从御案甩落。结束时折子落地，司马生指着地上。同装古装。",
      onScreen: "连第二行都没看",
      voiceover: "你的折子，圣上连第二行都没看，就扔了。",
      imagePrompt: "竖屏9:16半写实插画，殿上，折子落地特写，无水印",
    },
    {
      index: 2,
      seconds: 4,
      beat: "停",
      look: "挨打的人",
      speaker: "老臣",
      speakerId: people[1].id,
      voiceId: people[1].voice_id,
      visual:
        "同场，特写老臣愣住，手还抬着，嘴张开又咽回去。结束时目光落到地上的折子。同装。",
      onScreen: "一句都说不出",
      voiceover: "这……",
      imagePrompt: "竖屏9:16半写实插画，老臣愣住特写，无水印",
    },
    {
      index: 3,
      seconds: 6,
      beat: "顶",
      look: "说话的人",
      speaker: "司马生",
      speakerId: people[0].id,
      voiceId: people[0].voice_id,
      visual:
        "同场，司马生走近一步压他，老臣坐着不敢起。结束时司马生仍站着逼问。同装。",
      onScreen: "答案藏太深",
      voiceover: "圣上问的是粮草几时到，你倒先讲起二十年前的故事。",
      imagePrompt: "竖屏9:16半写实插画，司马生逼近，无水印",
    },
  ];

  console.log("出头尾关键帧…");
  shots = await generateEpisodeScenes({
    shots,
    characterName: "司马生、老臣",
    characters: people.map((p) => ({ name: p.name, angles: p.angles })),
    force: true,
    onProgress: (e) => console.log(" ", e.message),
  });
  fs.writeFileSync(path.join(OUT, "shots.json"), JSON.stringify(shots, null, 2));

  console.log("出三镜视频…");
  const rendered = await generateArkEpisodeVideo(
    {
      seriesTitle: "折子被扔",
      episodeNo: 1,
      title: "连第二行都没看",
      hook: "你的折子，圣上连第二行都没看，就扔了。",
      voiceover:
        "【对话】司马生：你的折子，圣上连第二行都没看，就扔了。老臣：这……司马生：圣上问的是粮草几时到，你倒先讲起二十年前的故事。",
      onScreen: "连第二行都没看",
      durationSec: 16,
      shots,
      characterName: "司马生、老臣",
      characterAngles: people.flatMap((p) => p.angles).slice(0, 4),
      speakMode: "dialogue",
      cast: people.map((p) => ({
        id: p.id,
        name: p.name,
        voice_id: p.voice_id,
      })),
      force: true,
    },
    (e) => console.log(" ", e.message),
  );
  shots = rendered.shots;
  fs.writeFileSync(path.join(OUT, "shots.json"), JSON.stringify(shots, null, 2));

  for (const shot of shots) {
    const dest = path.join(OUT, `shot-${shot.index}.mp4`);
    if (!shot.clipUrl) throw new Error(`第 ${shot.index} 镜没有成片`);
    await copyMedia(shot.clipUrl, dest);
    console.log("保存", dest);
  }

  console.log("合成三镜…");
  const composed = await generateArkEpisodeVideo(
    {
      seriesTitle: "折子被扔",
      episodeNo: 1,
      title: "连第二行都没看",
      hook: "你的折子，圣上连第二行都没看，就扔了。",
      voiceover:
        "【对话】司马生：你的折子，圣上连第二行都没看，就扔了。老臣：这……司马生：圣上问的是粮草几时到，你倒先讲起二十年前的故事。",
      onScreen: "连第二行都没看",
      durationSec: 16,
      shots,
      characterName: "司马生、老臣",
      speakMode: "dialogue",
      cast: people.map((p) => ({
        id: p.id,
        name: p.name,
        voice_id: p.voice_id,
      })),
      composeOnly: true,
    },
    (e) => console.log(" ", e.message),
  );
  if (!composed.url) throw new Error("合成没有成片地址");
  const composedPath = path.join(OUT, "composed.mp4");
  await copyMedia(composed.url, composedPath);
  console.log("保存", composedPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
