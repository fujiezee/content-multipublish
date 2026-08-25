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
const OUT = path.join(process.cwd(), "data/debug/podcast-listen");
const HOST = "zh_male_shenyeboke_uranus_bigtts";
const GUEST = "zh_female_xiaohe_uranus_bigtts";
const MIZAI = "zh_female_mizai_uranus_bigtts";
const ARK_MODEL = "doubao-seed-tts-2.0";
const GPT_MODEL = "gpt-4o-mini-tts";

const TURNS: Array<{
  speaker: "host" | "guest";
  voice: string;
  name: string;
  text: string;
}> = [
  {
    speaker: "host",
    voice: HOST,
    name: "问-深夜播客",
    text: "先说人最烦的那个点。你这篇里，真正卡住的是什么？",
  },
  {
    speaker: "guest",
    voice: GUEST,
    name: "答-小何",
    text: "不是功能少，是每次开口都要重新解释一遍，对方还以为你在推销。",
  },
  {
    speaker: "host",
    voice: HOST,
    name: "问-深夜播客",
    text: "那听的人怎么判断你不是在吹？",
  },
  {
    speaker: "guest",
    voice: GUEST,
    name: "答-小何",
    text: "看你讲的是不是他已经试过、已经踩过的坑。对上了，他才会信后面那句判断。",
  },
  {
    speaker: "guest",
    voice: MIZAI,
    name: "对照-咪仔",
    text: "看你讲的是不是他已经试过、已经踩过的坑。对上了，他才会信后面那句判断。",
  },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { synthesizeSpeechOrThrow } = await import("../src/lib/ai/ark-tts");
  const { podcastTone } = await import("../src/lib/ai/podcast-shared");

  let model = ARK_MODEL;
  try {
    await synthesizeSpeechOrThrow(TURNS[0].text, TURNS[0].voice, {
      acting: false,
      punch: false,
      persist: false,
      speed: 1,
      ttsModel: ARK_MODEL,
      tone: podcastTone("host", "dialogue"),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (process.env.DOUBAO_TTS_API_KEY?.trim()) {
      throw new Error(message);
    }
    console.warn(`豆包语音 2.0 本地没调通：${message}`);
    console.warn(
      "改用 GPT 配音对照。这不是小何 / 深夜播客 / 咪仔原声，只是让你先听对谈腔。",
    );
    model = GPT_MODEL;
  }

  console.log(`配音模型 ${model}`);
  console.log(`输出 ${OUT}`);

  for (let i = 0; i < TURNS.length; i += 1) {
    const row = TURNS[i];
    const dest = path.join(
      OUT,
      `${String(i + 1).padStart(2, "0")}-${model === GPT_MODEL ? "gpt对照-" : ""}${row.name}.mp3`,
    );
    process.stdout.write(`生成 ${row.name}… `);
    const clip = await synthesizeSpeechOrThrow(row.text, row.voice, {
      acting: false,
      punch: false,
      persist: false,
      speed: 1,
      ttsModel: model,
      tone: podcastTone(row.speaker, "dialogue"),
    });
    fs.writeFileSync(dest, clip.buffer);
    console.log(`${Math.round(clip.buffer.length / 1024)}KB → ${path.basename(dest)}`);
    try {
      await execFileAsync("afplay", [dest], { timeout: 60_000 });
    } catch (err) {
      console.warn(
        `afplay 没播出来：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  console.log("听完了。");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
