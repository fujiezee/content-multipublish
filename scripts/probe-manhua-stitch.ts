/**
 * 本地试 2–3 镜漫剧：写稿字段、真实成片拼接、合成卡顿。
 * 只出测量和结论，不改生产逻辑。
 */
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import {
  looksLikeReactionShot,
  speechToneLine,
  speechToneSpeed,
} from "../src/lib/ai/emotion-beat";
import { parseSeries } from "../src/lib/ai/video-script";
import { sceneCutsAway } from "../src/lib/ai/manhua-look";

const execFileAsync = promisify(execFile);
const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const FFPROBE = "/opt/homebrew/bin/ffprobe";
const OUT = path.join(process.cwd(), "data/debug/manhua-stitch");
const UPLOADS = path.join(process.cwd(), "data/uploads");
const STITCH_W = 720;
const STITCH_H = 1280;
const STITCH_FPS = 24;

const REAL_CLIPS = [
  "8cf4d77b-5b23-4858-95fb-8b8af7e4108b.mp4",
  "7f4f631f-8be3-43ae-92dd-be57e211d249.mp4",
  "0e0cf336-78eb-4105-be0a-824fd65dcfcf.mp4",
].map((name) => path.join(UPLOADS, name));

const SCRIPT_JSON = {
  title: "折子被扔",
  logline: "朝堂上折子被扔，司马生逼老臣改写法",
  audience: "替被当众揭穿的老臣着急，又想看司马生压回去",
  notes: "一集只演扔折子这一拍",
  episodes: [
    {
      episode_no: 1,
      title: "连第二行都没看",
      hook: "你的折子，圣上连第二行都没看，就扔了。",
      voiceover:
        "【对话】司马生：你的折子，圣上连第二行都没看，就扔了。老臣：……司马生：圣上问的是粮草几时到，你倒先讲起二十年前的故事。",
      on_screen: "连第二行都没看",
      recap: "观众替老臣挨这一下，司马生把写法压死，收在被揭穿的耻。",
      next_hook: "那要如何写？",
      duration_sec: 16,
      shots: [
        {
          seconds: 6,
          beat: "钩",
          look: "特写被扔的折子",
          speaker: "司马生",
          visual:
            "开头殿上司马生站着，折子从御案甩落。结束时折子落地，司马生指着地上。同装。",
          onScreen: "连第二行都没看",
          voiceover: "你的折子，圣上连第二行都没看，就扔了。",
        },
        {
          seconds: 4,
          beat: "停",
          look: "挨打的人",
          speaker: "老臣",
          visual:
            "同场，特写老臣愣住，手还抬着，嘴张开又咽回去。结束时目光落到地上的折子。同装。",
          onScreen: "一句都说不出",
          voiceover: "……",
        },
        {
          seconds: 6,
          beat: "顶",
          look: "说话的人",
          speaker: "司马生",
          visual:
            "同场，司马生走近一步压他，老臣坐着不敢起。结束时司马生仍站着逼问。同装。",
          onScreen: "答案藏太深",
          voiceover: "圣上问的是粮草几时到，你倒先讲起二十年前的故事。",
        },
      ],
    },
  ],
};

type StitchKind =
  | "old60"
  | "current"
  | "hard"
  | "hardNorm"
  | "fade8"
  | "xfade25"
  | "trimHard"
  | "trimFade8";

function kindOpts(kind: StitchKind) {
  return {
    fade:
      kind === "old60"
        ? 0.06
        : kind === "fade8" || kind === "current" || kind === "trimFade8"
          ? 0.008
          : 0,
    loudnorm: kind === "current" || kind === "hardNorm",
    xfade: kind === "xfade25" ? 0.025 : 0,
    trimStart: true,
    deadAir: kind === "trimHard" || kind === "trimFade8",
  };
}

async function probeDur(file: string): Promise<number> {
  const { stdout } = await execFileAsync(FFPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  return Number(String(stdout).trim()) || 0;
}

async function meanVolume(file: string, ss: number, t: number): Promise<number> {
  const start = Math.max(0, ss);
  const { stderr } = await execFileAsync(FFMPEG, [
    "-hide_banner",
    "-ss",
    start.toFixed(3),
    "-t",
    t.toFixed(3),
    "-i",
    file,
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const m = String(stderr).match(/mean_volume:\s*(-?[\d.]+)/);
  return m ? Number(m[1]) : -99;
}

async function maxVolume(file: string, ss: number, t: number): Promise<number> {
  const start = Math.max(0, ss);
  const { stderr } = await execFileAsync(FFMPEG, [
    "-hide_banner",
    "-ss",
    start.toFixed(3),
    "-t",
    t.toFixed(3),
    "-i",
    file,
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const m = String(stderr).match(/max_volume:\s*(-?[\d.]+)/);
  return m ? Number(m[1]) : -99;
}

async function normalizeOne(
  src: string,
  dest: string,
  opts: { fade: number; loudnorm: boolean; trimStart: boolean; isFirst: boolean; isLast: boolean },
) {
  const start = opts.trimStart && !opts.isFirst ? 2 / STITCH_FPS : 0;
  const vf = [
    start > 0 ? `trim=start=${start.toFixed(3)},setpts=PTS-STARTPTS` : "",
    `scale=${STITCH_W}:${STITCH_H}:force_original_aspect_ratio=decrease`,
    `pad=${STITCH_W}:${STITCH_H}:(ow-iw)/2:(oh-ih)/2`,
    `fps=${STITCH_FPS}`,
    "format=yuv420p",
    "setsar=1",
  ]
    .filter(Boolean)
    .join(",");
  const af: string[] = [
    start > 0 ? `atrim=start=${start.toFixed(3)},asetpts=PTS-STARTPTS` : "",
    "aresample=48000",
    "aformat=sample_fmts=fltp:channel_layouts=stereo",
    opts.loudnorm ? "loudnorm=I=-16:TP=-1.5:LRA=11" : "",
  ].filter(Boolean);
  if (opts.fade > 0 && !opts.isFirst) af.push(`afade=t=in:st=0:d=${opts.fade}`);
  if (opts.fade > 0 && !opts.isLast) {
    const dur = await probeDur(src);
    const outAt = Math.max(0, dur - start - opts.fade);
    af.push(`afade=t=out:st=${outAt.toFixed(3)}:d=${opts.fade}`);
  }
  await execFileAsync(
    FFMPEG,
    [
      "-y",
      "-i",
      src,
      "-vf",
      vf,
      "-r",
      String(STITCH_FPS),
      "-af",
      af.join(","),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      dest,
    ],
    { timeout: 120_000 },
  );
}

async function concatHard(parts: string[], dest: string) {
  const inputs = parts.flatMap((file) => ["-i", file]);
  const vchain = parts.map((_, i) => `[${i}:v]`).join("");
  const achain = parts.map((_, i) => `[${i}:a]`).join("");
  await execFileAsync(
    FFMPEG,
    [
      "-y",
      ...inputs,
      "-filter_complex",
      `${vchain}concat=n=${parts.length}:v=1:a=0[v];${achain}concat=n=${parts.length}:v=0:a=1[a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      dest,
    ],
    { timeout: 180_000 },
  );
}

async function concatXfade(parts: string[], dest: string, d: number) {
  const inputs = parts.flatMap((file) => ["-i", file]);
  const vchain = parts.map((_, i) => `[${i}:v]`).join("");
  let a = "";
  for (let i = 0; i < parts.length - 1; i += 1) {
    const left = i === 0 ? "[0:a]" : `[a${i}]`;
    const right = `[${i + 1}:a]`;
    const out = i === parts.length - 2 ? "[a]" : `[a${i + 1}]`;
    a += `${left}${right}acrossfade=d=${d}:c1=tri:c2=tri${out};`;
  }
  await execFileAsync(
    FFMPEG,
    [
      "-y",
      ...inputs,
      "-filter_complex",
      `${vchain}concat=n=${parts.length}:v=1:a=0[v];${a}`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      dest,
    ],
    { timeout: 180_000 },
  );
}

async function detectDeadAir(file: string): Promise<{ head: number; tail: number }> {
  const wav = path.join(os.tmpdir(), `dw-air-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
  await execFileAsync(FFMPEG, [
    "-y",
    "-i",
    file,
    "-ac",
    "1",
    "-ar",
    "8000",
    "-f",
    "wav",
    wav,
  ]);
  const buf = fs.readFileSync(wav);
  fs.unlinkSync(wav);
  const pcm = buf.subarray(44);
  const samples: number[] = [];
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    samples.push(pcm.readInt16LE(i));
  }
  const win = 400; // 50ms @ 8k
  const rms: number[] = [];
  for (let i = 0; i + win < samples.length; i += win) {
    let s = 0;
    for (let j = 0; j < win; j += 1) s += samples[i + j] * samples[i + j];
    rms.push(Math.sqrt(s / win));
  }
  const midSlice = rms.slice(
    Math.floor(rms.length / 4),
    Math.max(Math.floor(rms.length / 4) + 1, Math.floor((rms.length * 3) / 4)),
  );
  const mid = [...midSlice].sort((a, b) => a - b)[Math.floor(midSlice.length / 2)] || 0;
  const thresh = Math.max(320, mid * 0.22);
  let start = 0;
  for (let i = 0; i < rms.length - 1; i += 1) {
    if (rms[i] > thresh && rms[i + 1] > thresh) {
      start = i;
      break;
    }
  }
  let end = rms.length - 1;
  for (let i = rms.length - 1; i > 0; i -= 1) {
    if (rms[i] > thresh && rms[i - 1] > thresh) {
      end = i;
      break;
    }
  }
  let head = Math.min(0.9, (start * 50) / 1000);
  let tail = Math.min(0.35, ((rms.length - 1 - end) * 50) / 1000);
  if (head < 0.12) head = 0;
  if (tail < 0.12) tail = 0;
  return { head, tail };
}

async function trimDeadAir(src: string, dest: string) {
  const { head, tail } = await detectDeadAir(src);
  const dur = await probeDur(src);
  const keep = Math.max(2, dur - head - tail);
  await execFileAsync(FFMPEG, [
    "-y",
    "-ss",
    head.toFixed(3),
    "-t",
    keep.toFixed(3),
    "-i",
    src,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    dest,
  ]);
  return { head, tail, keep };
}

async function stitch(
  kind: StitchKind,
  clips: string[],
  dest: string,
): Promise<number[]> {
  const opts = kindOpts(kind);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw-probe-"));
  try {
    const parts: string[] = [];
    for (const [i, clip] of clips.entries()) {
      let src = clip;
      if (opts.deadAir) {
        const trimmed = path.join(dir, `${i}-air.mp4`);
        const cut = await trimDeadAir(clip, trimmed);
        console.log(
          `  [${kind}] 镜${i + 1} 去空声 头${cut.head.toFixed(2)}s 尾${cut.tail.toFixed(2)}s`,
        );
        src = trimmed;
      }
      const norm = path.join(dir, `${i}.mp4`);
      await normalizeOne(src, norm, {
        fade: opts.xfade ? 0 : opts.fade,
        loudnorm: opts.loudnorm,
        trimStart: opts.trimStart,
        isFirst: i === 0,
        isLast: i === clips.length - 1,
      });
      parts.push(norm);
    }
    const cuts: number[] = [];
    let acc = 0;
    for (let i = 0; i < parts.length - 1; i += 1) {
      acc += await probeDur(parts[i]);
      cuts.push(acc);
    }
    if (opts.xfade) await concatXfade(parts, dest, opts.xfade);
    else await concatHard(parts, dest);
    return cuts;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function makeSynthClips(dir: string): Promise<string[]> {
  const specs = [
    { name: "s1.mp4", voice: 0.35, bgm: 0.04, f: 220 },
    { name: "s2.mp4", voice: 0.35, bgm: 0.38, f: 330 },
    { name: "s3.mp4", voice: 0.35, bgm: 0.12, f: 180 },
  ];
  const out: string[] = [];
  for (const spec of specs) {
    const dest = path.join(dir, spec.name);
    await execFileAsync(FFMPEG, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x2a2118:s=${STITCH_W}x${STITCH_H}:d=5:r=${STITCH_FPS}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=180:sample_rate=48000:duration=5`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${spec.f}:sample_rate=48000:duration=5`,
      "-filter_complex",
      `[1:a]volume=${spec.voice}[v];[2:a]volume=${spec.bgm}[b];[v][b]amix=inputs=2:duration=first:normalize=0,aformat=channel_layouts=stereo[a]`,
      "-map",
      "0:v",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      dest,
    ]);
    out.push(dest);
  }
  return out;
}

async function edgeReport(file: string, label: string) {
  const dur = await probeDur(file);
  const head = await meanVolume(file, 0, 0.25);
  const tail = await meanVolume(file, Math.max(0, dur - 0.25), 0.25);
  const mid = await meanVolume(file, Math.max(0, dur / 2 - 0.15), 0.3);
  console.log(
    `  ${label}  ${dur.toFixed(2)}s  头${head.toFixed(1)}dB  中${mid.toFixed(1)}dB  尾${tail.toFixed(1)}dB`,
  );
  return { dur, head, mid, tail };
}

async function cutReport(file: string, cuts: number[], label: string) {
  const rows: Array<{ dip: number; click: number }> = [];
  for (const [i, t] of cuts.entries()) {
    const before = await meanVolume(file, t - 0.18, 0.15);
    const after = await meanVolume(file, t + 0.03, 0.15);
    const click = await maxVolume(file, t - 0.02, 0.04);
    const dip = Math.abs(after - before);
    rows.push({ dip, click });
    console.log(
      `  ${label} 切${i + 1}@${t.toFixed(2)}s  前${before.toFixed(1)} 后${after.toFixed(1)} 落差${dip.toFixed(1)}dB  切口峰值${click.toFixed(1)}dB`,
    );
  }
  return rows;
}

async function measureSet(label: string, clips: string[], kinds: StitchKind[]) {
  console.log(`\n== ${label} ==`);
  const durs: number[] = [];
  for (const [i, clip] of clips.entries()) {
    durs.push((await edgeReport(clip, `原镜${i + 1}`)).dur);
  }
  const cutsFrom = (normalized: number[]) => {
    const cuts: number[] = [];
    let t = 0;
    for (let i = 0; i < normalized.length - 1; i += 1) {
      t += normalized[i];
      cuts.push(t);
    }
    return cuts;
  };

  for (const kind of kinds) {
    const dest = path.join(OUT, `${label}-${kind}.mp4`);
    const started = Date.now();
    const cuts = await stitch(kind, clips, dest);
    const took = ((Date.now() - started) / 1000).toFixed(1);
    const outDur = await probeDur(dest);
    const trim = 2 / STITCH_FPS;
    const expected = durs.reduce((a, b, i) => a + (i === 0 ? b : Math.max(0, b - trim)), 0);
    const fallback = cutsFrom(durs.map((d, i) => (i === 0 ? d : Math.max(0, d - trim))));
    console.log(`  [${kind}] 出片${outDur.toFixed(2)}s 预期${expected.toFixed(2)}s 偏${(outDur - expected).toFixed(2)}s 耗时${took}s`);
    await cutReport(dest, cuts.length ? cuts : fallback, kind);
  }
}

function scriptChecks() {
  console.log("== 三镜漫剧稿 ==");
  const series = parseSeries(JSON.stringify(SCRIPT_JSON), "drama", 15, "dialogue");
  const ep = series.episodes[0];
  const shots = ep.shots;
  console.log(`  准稿：${ep.voiceover}`);
  console.log(`  分镜 ${shots.length}：`);
  for (const shot of shots) {
    const react = looksLikeReactionShot(shot) ? "反应镜" : "对白镜";
    const cut = sceneCutsAway(shot) ? "换场" : "同场";
    console.log(
      `    ${shot.index} ${shot.speaker} beat=${shot.beat || "?"} look=${shot.look || "?"} ${react}/${cut}`,
    );
    console.log(`      对白：${shot.voiceover}`);
    console.log(`      口气：${speechToneLine({ beat: shot.beat, voiceover: shot.voiceover })} 语速${speechToneSpeed(shot.beat)}`);
    console.log(`      画面：${shot.visual}`);
    console.log(`      花字：${shot.onScreen}`);
  }
  const problems: string[] = [];
  if (!shots.some((s) => looksLikeReactionShot(s))) problems.push("没有反应镜");
  if (shots.every((s) => (s.look || "").includes("说话"))) problems.push("镜头全看说话的人");
  if (shots.some((s) => sceneCutsAway(s))) problems.push("三镜里不该换场");
  if (shots[0]?.beat !== "钩") problems.push("开场不是钩");
  if (!/扔|折子/.test(shots[0]?.visual || "")) problems.push("开场画面没有扎人的物");
  if (shots[1]?.onScreen && shots[1].voiceover.includes(shots[1].onScreen)) {
    problems.push("花字复述对白");
  }
  if (problems.length) {
    console.log(`  稿上的洞：${problems.join("；")}`);
  } else {
    console.log("  稿：钩→反应→顶，同场，花字不复述，过。");
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  scriptChecks();

  const missing = REAL_CLIPS.filter((f) => !fs.existsSync(f));
  if (missing.length) {
    console.log("缺真实成片：", missing);
  } else {
    await measureSet("real", REAL_CLIPS, [
      "current",
      "hard",
      "trimHard",
      "trimFade8",
    ]);
  }
  console.log(`\n成片在 ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
