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

const OUT = path.join(process.cwd(), "data/debug/look-catalog");

const SCENE =
  "同一场：紫袍白须老臣半身，夜，朱红门生帖拍在案上，右手按住红帖，眼神冷。竖屏 9:16。";

const SAFETY =
  "皮肤是画的：没有毛孔、没有照片噪点、没有相机实拍。无水印、无文字、无 logo、无网址、无字幕。只出一张图。";

type Row = {
  id: string;
  group: string;
  label: string;
  still: string;
};

const CATALOG: Row[] = [
  {
    id: "cel",
    group: "流量王炸",
    label: "赛璐璐日漫",
    still:
      "赛璐璐日漫，2D 清晰描线，平涂色块，少量赛璐璐高光。热血少年漫剧，像火影、海贼王的电视动画帧，不是厚涂，不是写实。",
  },
  {
    id: "cyber",
    group: "流量王炸",
    label: "赛博朋克",
    still:
      "赛博朋克，霓虹品红与青，高对比硬光，雨湿街道反光，义体和全息边光。科幻悬疑漫剧，像攻壳、边缘行者，不是白天古装。",
  },
  {
    id: "chibi",
    group: "流量王炸",
    label: "Q版超变形",
    still:
      "Q版超变形，大头小身，2到3头身，五官简化，表情夸张。搞笑日常漫剧，可爱变形，不是真人比例。",
  },
  {
    id: "arcane",
    group: "流量王炸",
    label: "美漫厚涂",
    still:
      "美漫厚涂，硬朗描边，3D体积光影，暗金与深紫，哥特细节。暗黑热血漫剧，像双城之战，不是二次元大眼睛，不是照片。",
  },
  {
    id: "spider",
    group: "流量王炸",
    label: "波普美漫",
    still:
      "波普美漫，粗墨线，半调网点，高饱和撞色拼贴，偏移套印。潮酷少年漫剧，像蜘蛛侠平行宇宙，不是写实。",
  },
  {
    id: "magical",
    group: "流量王炸",
    label: "魔法少女",
    still:
      "魔法少女，梦幻粉紫，星光闪光特效，缎带与水晶。少女变身漫剧，像美少女战士，明亮可爱，不是暗黑。",
  },
  {
    id: "vhs",
    group: "流量王炸",
    label: "90年代复古",
    still:
      "90年代复古，暖黄偏色，轻微VHS扫描线和柔焦，旧动画录像带质感。怀旧青春漫剧，不是高清写实。",
  },
  {
    id: "meme",
    group: "流量王炸",
    label: "沙雕表情包",
    still:
      "沙雕表情包，火柴人夸张变形，头顶冒烟，简笔加巨大表情。搞笑吐槽漫剧，像网络梗图，不是精致插画。",
  },
  {
    id: "ghibli",
    group: "治愈美学",
    label: "吉卜力",
    still:
      "吉卜力手绘，自然水彩晕染，温柔空气感，手绘背景。治愈日常漫剧，像龙猫、千与千寻，不是赛璐璐平涂，不是照片。",
  },
  {
    id: "shinkai",
    group: "治愈美学",
    label: "新海诚",
    still:
      "新海诚电影风，光影通透，丁达尔光柱，壁纸级天空和反射。青春恋爱漫剧，像你的名字，仍然是画，不是实拍。",
  },
  {
    id: "ln",
    group: "治愈美学",
    label: "轻小说插画",
    still:
      "轻小说插画，人物俊美，色彩柔和，背景虚化，精致二次元商业插画。校园恋爱漫剧，像刀剑神域封面，不是照片。",
  },
  {
    id: "felt",
    group: "治愈美学",
    label: "羊毛毡定格",
    still:
      "羊毛毡定格，手工毛绒纤维质感，柔软针扎痕迹，微缩场景。萌宠亲子漫剧，明显是毡出来的，不是真人。",
  },
  {
    id: "paper",
    group: "治愈美学",
    label: "立体纸雕",
    still:
      "立体纸雕，层层彩纸镂空，边缘清晰，光从层缝穿透。童话回忆漫剧，像小王子纸剧场，不是厚涂。",
  },
  {
    id: "watercolor",
    group: "治愈美学",
    label: "水彩",
    still:
      "水彩画，透明晕染，轻盈湿笔，自然留白。文艺诗意漫剧，纸上水彩，不是数码厚涂，不是照片。",
  },
  {
    id: "shangmei",
    group: "东方意境",
    label: "上美水墨",
    still:
      "上海美影水墨动画，水墨晕染，留白写意，略带戏曲造型。国风武侠漫剧，像大闹天宫、山水情，不是工笔，不是写实。",
  },
  {
    id: "gongbi",
    group: "东方意境",
    label: "工笔重彩",
    still:
      "国风工笔重彩，精细游丝描，朱砂、石青、金箔薄色。古风神话漫剧，像故宫藏画，平面装饰，不是油画。",
  },
  {
    id: "xieyi",
    group: "东方意境",
    label: "水墨写意",
    still:
      "中式水墨写意，大面积留白，焦墨枯笔，一点朱砂。文人哲理漫剧，传统山水人物，抽象写意，不是工笔细描。",
  },
  {
    id: "cyber-guo",
    group: "东方意境",
    label: "赛博国风",
    still:
      "赛博朋克国风，汉服轮廓加霓虹全息，机械义肢边光。国潮科幻漫剧，古装和未来叠在一起，不是纯古风，不是实拍。",
  },
  {
    id: "fantasy",
    group: "电影叙事",
    label: "厚涂幻想",
    still:
      "厚涂幻想，笔触厚重，光影对比强，色彩饱和。奇幻史诗漫剧，像原神CG，体积扎实但是画的，不是相机实拍。",
  },
  {
    id: "gothic",
    group: "电影叙事",
    label: "暗黑哥特",
    still:
      "暗黑哥特，深暗色调，尖拱与玫瑰窗，一束血色或冷光。黑暗童话漫剧，像黑执事，不是大白天，不是照片。",
  },
  {
    id: "steampunk",
    group: "电影叙事",
    label: "蒸汽朋克",
    still:
      "蒸汽朋克，黄铜齿轮，蒸汽管道，维多利亚皮革与护目镜。冒险机械漫剧，像蒸汽男孩，暖铜光，不是赛博霓虹。",
  },
  {
    id: "pixar",
    group: "电影叙事",
    label: "皮克斯迪士尼",
    still:
      "皮克斯迪士尼3D卡通，圆润造型，皮下散射，童话色彩。全年龄家庭漫剧，像冰雪奇缘，明显卡通，不是真人。",
  },
  {
    id: "clay",
    group: "电影叙事",
    label: "黏土定格",
    still:
      "黏土定格，手工捏造指纹和接缝，笨拙复古。搞笑儿童漫剧，像小羊肖恩，明显是橡皮泥，不是真人。",
  },
];

const MODELS = [
  { id: "gemini-flash", file: "gemini" },
  { id: "seedream-5.0", file: "seedream" },
] as const;

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

function writeIndex(rows: Array<Row & { gemini?: string; seedream?: string; err?: string }>) {
  const cards = rows
    .map((row) => {
      const g = row.gemini
        ? `<img src="${path.basename(row.gemini)}" alt="${row.label} Gemini">`
        : `<div class="miss">Gemini 失败</div>`;
      const s = row.seedream
        ? `<img src="${path.basename(row.seedream)}" alt="${row.label} 豆包">`
        : `<div class="miss">豆包失败</div>`;
      return `<article>
  <h3>${row.label}<small>${row.group}</small></h3>
  <div class="pair">
    <figure>${g}<figcaption>Gemini</figcaption></figure>
    <figure>${s}<figcaption>豆包 5.0</figcaption></figure>
  </div>
</article>`;
    })
    .join("\n");
  const html = `<!doctype html>
<meta charset="utf-8">
<title>画风对照</title>
<style>
  body{margin:0;background:#111;color:#eee;font:14px/1.4 -apple-system,sans-serif}
  h1{margin:20px 24px 8px;font-size:20px}
  p{margin:0 24px 20px;color:#aaa}
  main{display:grid;gap:28px;padding:0 24px 40px}
  article h3{margin:0 0 8px;font-size:16px}
  article small{margin-left:8px;color:#888;font-weight:400}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  img{width:100%;height:auto;background:#000;border-radius:8px}
  figcaption{margin-top:4px;color:#888}
  .miss{aspect-ratio:9/16;display:grid;place-items:center;background:#222;border-radius:8px;color:#c66}
</style>
<h1>23 种画风 × Gemini / 豆包 5.0</h1>
<p>同一场：徐奉按住红帖。只看画风，不锁旧脸。</p>
<main>
${cards}
</main>`;
  fs.writeFileSync(path.join(OUT, "index.html"), html);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { generateImageWithChat } = await import("../src/lib/ai/openai-image");
  const jobs = CATALOG.flatMap((row) =>
    MODELS.map((model) => ({ row, model })),
  );
  const destOf = (id: string, file: string) => path.join(OUT, `${id}-${file}.jpg`);
  const done = new Map<string, string>();
  const errors: string[] = [];

  const run = async (job: (typeof jobs)[number]) => {
    const dest = destOf(job.row.id, job.model.file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 8_000) {
      console.log(`跳过已有 ${job.row.label} ${job.model.file}`);
      done.set(`${job.row.id}:${job.model.file}`, dest);
      return;
    }
    const prompt = [SCENE, job.row.still, SAFETY].join("\n");
    console.log(`出 ${job.row.label} / ${job.model.file}…`);
    try {
      const { url } = await generateImageWithChat(prompt, {
        aspectRatio: "9:16",
        model: job.model.id,
      });
      await copyMedia(url, dest);
      done.set(`${job.row.id}:${job.model.file}`, dest);
      console.log(`  ${dest}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${job.row.label} ${job.model.file}: ${msg}`);
      console.error(`  失败 ${job.row.label} ${job.model.file}: ${msg}`);
    }
  };

  const batch = 4;
  for (let i = 0; i < jobs.length; i += batch) {
    await Promise.all(jobs.slice(i, i + batch).map(run));
  }

  writeIndex(
    CATALOG.map((row) => ({
      ...row,
      gemini: done.get(`${row.id}:gemini`),
      seedream: done.get(`${row.id}:seedream`),
    })),
  );
  fs.writeFileSync(
    path.join(OUT, "result.json"),
    JSON.stringify({ at: new Date().toISOString(), errors, count: done.size }, null, 2),
  );
  console.log(`完成 ${done.size}/${jobs.length}，页 ${path.join(OUT, "index.html")}`);
  if (errors.length) console.log(errors.join("\n"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
