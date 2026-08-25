export type MusicStyleGroupId = "genre" | "mood" | "tempo";

export type MusicStyle = {
  id: string;
  group: MusicStyleGroupId;
  label: string;
  prompt: string;
  swatch: string;
};

export const MUSIC_STYLE_GROUPS: {
  id: MusicStyleGroupId;
  label: string;
  hint: string;
  max: number;
}[] = [
  { id: "genre", label: "曲风", hint: "最多选两个", max: 2 },
  { id: "mood", label: "情绪", hint: "最多选两个", max: 2 },
  { id: "tempo", label: "节奏", hint: "选一个", max: 1 },
];

export const MUSIC_STYLES: MusicStyle[] = [
  { id: "c-pop", group: "genre", label: "华语流行", prompt: "中文流行", swatch: "linear-gradient(160deg,#f4b8c5,#7b2d4a)" },
  { id: "yue-pop", group: "genre", label: "粤语流行", prompt: "粤语流行", swatch: "linear-gradient(160deg,#f2c9a0,#6a2a2a)" },
  { id: "guofeng", group: "genre", label: "古风", prompt: "中国古风", swatch: "linear-gradient(160deg,#e8d5a3,#3d2a12)" },
  { id: "opera", group: "genre", label: "戏腔国风", prompt: "国风戏腔", swatch: "linear-gradient(160deg,#f0c9b0,#7a1d1d)" },
  { id: "chinese-folk", group: "genre", label: "民乐", prompt: "中国民乐，古筝琵琶", swatch: "linear-gradient(160deg,#f0e2c4,#4a3218)" },
  { id: "folk", group: "genre", label: "民谣", prompt: "民谣", swatch: "linear-gradient(160deg,#d7e0c3,#3f5a38)" },
  { id: "campus-folk", group: "genre", label: "校园民谣", prompt: "校园民谣", swatch: "linear-gradient(160deg,#e8f0d4,#5a6b38)" },
  { id: "ballad", group: "genre", label: "抒情慢歌", prompt: "抒情流行", swatch: "linear-gradient(160deg,#f3d5c8,#5a6b88)" },
  { id: "piano-pop", group: "genre", label: "钢琴流行", prompt: "钢琴流行", swatch: "linear-gradient(160deg,#eee6d8,#4a5568)" },
  { id: "indie", group: "genre", label: "独立流行", prompt: "独立流行", swatch: "linear-gradient(160deg,#d8c8e8,#3a3048)" },
  { id: "city-pop", group: "genre", label: "城市流行", prompt: "城市流行 City Pop", swatch: "linear-gradient(160deg,#ffb38a,#2a4a78)" },
  { id: "kpop", group: "genre", label: "韩流", prompt: "K-pop 韩流流行", swatch: "linear-gradient(160deg,#ff9ec8,#4a1a78)" },
  { id: "jpop", group: "genre", label: "日系流行", prompt: "J-pop 日系流行", swatch: "linear-gradient(160deg,#ffd0e8,#6a3a88)" },
  { id: "anime", group: "genre", label: "二次元", prompt: "二次元动画歌", swatch: "linear-gradient(160deg,#ffb3d9,#5b4dff)" },
  { id: "rap", group: "genre", label: "说唱", prompt: "中文说唱", swatch: "linear-gradient(160deg,#f2e27a,#1a1a1a)" },
  { id: "trap", group: "genre", label: "陷阱说唱", prompt: "陷阱说唱 Trap", swatch: "linear-gradient(160deg,#e8c84a,#12100a)" },
  { id: "rnb", group: "genre", label: "R&B", prompt: "R&B", swatch: "linear-gradient(160deg,#c9a0e8,#3a1848)" },
  { id: "soul", group: "genre", label: "灵魂乐", prompt: "灵魂乐 Soul", swatch: "linear-gradient(160deg,#e0a070,#4a2018)" },
  { id: "rock", group: "genre", label: "摇滚", prompt: "摇滚", swatch: "linear-gradient(160deg,#c45c4a,#1c1010)" },
  { id: "pop-rock", group: "genre", label: "流行摇滚", prompt: "流行摇滚", swatch: "linear-gradient(160deg,#e07060,#2a1418)" },
  { id: "punk", group: "genre", label: "朋克", prompt: "朋克", swatch: "linear-gradient(160deg,#f05040,#120808)" },
  { id: "metal", group: "genre", label: "金属", prompt: "金属", swatch: "linear-gradient(160deg,#8a8a8a,#0c0c0c)" },
  { id: "post-rock", group: "genre", label: "后摇", prompt: "后摇", swatch: "linear-gradient(160deg,#b8c4d4,#1a2430)" },
  { id: "electronic", group: "genre", label: "电子", prompt: "电子流行", swatch: "linear-gradient(160deg,#7ef0ff,#14205a)" },
  { id: "synth", group: "genre", label: "合成器流行", prompt: "合成器流行 Synth-pop", swatch: "linear-gradient(160deg,#9ad4ff,#1a2058)" },
  { id: "house", group: "genre", label: "浩室", prompt: "浩室 House", swatch: "linear-gradient(160deg,#80ffe0,#142848)" },
  { id: "dance", group: "genre", label: "舞曲", prompt: "舞曲", swatch: "linear-gradient(160deg,#ff8bd1,#2b0a4a)" },
  { id: "disco", group: "genre", label: "迪斯科", prompt: "迪斯科 Disco", swatch: "linear-gradient(160deg,#ff6ad5,#3a0a58)" },
  { id: "dj", group: "genre", label: "DJ热曲", prompt: "DJ 热曲，适合短视频", swatch: "linear-gradient(160deg,#ff5aa0,#1a0838)" },
  { id: "lofi", group: "genre", label: "Lo-fi", prompt: "Lo-fi", swatch: "linear-gradient(160deg,#d4c4a8,#3a3848)" },
  { id: "ambient", group: "genre", label: "氛围", prompt: "氛围电子 Ambient", swatch: "linear-gradient(160deg,#b8d0e8,#1a2838)" },
  { id: "cyber", group: "genre", label: "赛博电子", prompt: "赛博朋克电子", swatch: "linear-gradient(160deg,#39f0c0,#0a1028)" },
  { id: "vaporwave", group: "genre", label: "蒸汽波", prompt: "蒸汽波 Vaporwave", swatch: "linear-gradient(160deg,#ff8ad4,#3a78ff)" },
  { id: "jazz", group: "genre", label: "爵士", prompt: "爵士", swatch: "linear-gradient(160deg,#e8c878,#2a2010)" },
  { id: "blues", group: "genre", label: "布鲁斯", prompt: "布鲁斯 Blues", swatch: "linear-gradient(160deg,#6a8ab8,#101828)" },
  { id: "funk", group: "genre", label: "放克", prompt: "放克 Funk", swatch: "linear-gradient(160deg,#f0b040,#3a1808)" },
  { id: "country", group: "genre", label: "乡村", prompt: "乡村 Country", swatch: "linear-gradient(160deg,#d8b070,#4a3010)" },
  { id: "reggae", group: "genre", label: "雷鬼", prompt: "雷鬼 Reggae", swatch: "linear-gradient(160deg,#78d050,#1a3810)" },
  { id: "latin", group: "genre", label: "拉丁", prompt: "拉丁", swatch: "linear-gradient(160deg,#f07040,#481010)" },
  { id: "bossa", group: "genre", label: "波萨诺瓦", prompt: "波萨诺瓦 Bossa Nova", swatch: "linear-gradient(160deg,#e8d0a8,#385848)" },
  { id: "cinematic", group: "genre", label: "电影感", prompt: "电影配乐感", swatch: "linear-gradient(160deg,#d4c4a8,#1c2430)" },
  { id: "symphony", group: "genre", label: "交响", prompt: "交响管弦", swatch: "linear-gradient(160deg,#e8dcc0,#1c2438)" },
  { id: "game", group: "genre", label: "游戏风", prompt: "游戏配乐感", swatch: "linear-gradient(160deg,#70e0a8,#142038)" },
  { id: "light", group: "genre", label: "轻音乐", prompt: "轻音乐", swatch: "linear-gradient(160deg,#f7f1e4,#8aa4b8)" },
  { id: "new-age", group: "genre", label: "新世纪", prompt: "新世纪 New Age", swatch: "linear-gradient(160deg,#d0e8f0,#3a5870)" },
  { id: "zen", group: "genre", label: "禅意", prompt: "禅意空灵", swatch: "linear-gradient(160deg,#dce8d4,#3a5040)" },
  { id: "nursery", group: "genre", label: "童谣", prompt: "童谣儿歌", swatch: "linear-gradient(160deg,#ffe8a0,#78b0e0)" },

  { id: "burn", group: "mood", label: "燃", prompt: "燃、爆发", swatch: "linear-gradient(160deg,#ff7a3d,#5a0d0d)" },
  { id: "hurt", group: "mood", label: "虐心", prompt: "虐心、压抑", swatch: "linear-gradient(160deg,#8a9bb5,#161820)" },
  { id: "heal", group: "mood", label: "治愈", prompt: "治愈、温柔", swatch: "linear-gradient(160deg,#c8ead4,#3d6b5c)" },
  { id: "sweet", group: "mood", label: "甜宠", prompt: "甜、亲密", swatch: "linear-gradient(160deg,#ffd0dc,#c45c78)" },
  { id: "romantic", group: "mood", label: "浪漫", prompt: "浪漫", swatch: "linear-gradient(160deg,#f0b8c8,#7a3048)" },
  { id: "suspense", group: "mood", label: "悬疑", prompt: "悬疑、暗涌", swatch: "linear-gradient(160deg,#6b7a9a,#0c1018)" },
  { id: "hero", group: "mood", label: "热血", prompt: "热血", swatch: "linear-gradient(160deg,#ffb347,#8b1e1e)" },
  { id: "lonely", group: "mood", label: "孤独", prompt: "孤独", swatch: "linear-gradient(160deg,#9aa7b8,#2a3140)" },
  { id: "uplift", group: "mood", label: "励志", prompt: "励志、昂扬", swatch: "linear-gradient(160deg,#ffe08a,#c45c1a)" },
  { id: "satire", group: "mood", label: "讽刺", prompt: "讽刺、冷感", swatch: "linear-gradient(160deg,#c5c8b8,#2c3028)" },
  { id: "epic", group: "mood", label: "史诗", prompt: "史诗、宏大", swatch: "linear-gradient(160deg,#e6d5a8,#1a2744)" },
  { id: "nostalgia", group: "mood", label: "怀旧", prompt: "怀旧", swatch: "linear-gradient(160deg,#e8c8a0,#5a4030)" },
  { id: "dreamy", group: "mood", label: "梦幻", prompt: "梦幻", swatch: "linear-gradient(160deg,#d0c8f0,#4a3878)" },
  { id: "chill", group: "mood", label: "放松", prompt: "放松、慵懒", swatch: "linear-gradient(160deg,#c8e0d8,#3a5850)" },
  { id: "festive", group: "mood", label: "喜庆", prompt: "喜庆、热闹", swatch: "linear-gradient(160deg,#ff6a4a,#8a1808)" },
  { id: "funny", group: "mood", label: "搞怪", prompt: "搞怪、戏谑", swatch: "linear-gradient(160deg,#ffe06a,#d45a20)" },
  { id: "tense", group: "mood", label: "紧张", prompt: "紧张、压迫", swatch: "linear-gradient(160deg,#c07070,#201018)" },
  { id: "tragic", group: "mood", label: "悲壮", prompt: "悲壮", swatch: "linear-gradient(160deg,#c8b090,#2a2018)" },

  { id: "slow", group: "tempo", label: "慢", prompt: "慢歌", swatch: "linear-gradient(160deg,#d9e4f0,#4a5568)" },
  { id: "mid", group: "tempo", label: "中板", prompt: "中速", swatch: "linear-gradient(160deg,#ead9c4,#6b5344)" },
  { id: "fast", group: "tempo", label: "快", prompt: "快歌", swatch: "linear-gradient(160deg,#ffd36b,#d4532a)" },
  { id: "build", group: "tempo", label: "渐强", prompt: "前慢后快，层层推进", swatch: "linear-gradient(160deg,#f0d080,#c04020)" },
];

const byId = new Map(MUSIC_STYLES.map((row) => [row.id, row]));

export function musicStyleById(id: string): MusicStyle | undefined {
  return byId.get(id);
}

export function composeMusicStylePrompt(
  tagIds: string[],
  extra?: string,
  vocal?: "m" | "f",
): string {
  const parts = tagIds
    .map((id) => byId.get(id)?.prompt)
    .filter((row): row is string => Boolean(row));
  const note = extra?.trim();
  if (note) parts.push(note);
  if (vocal === "f") parts.push("女声");
  if (vocal === "m") parts.push("男声");
  return Array.from(new Set(parts)).join("，") || "中文流行，适合短视频";
}

export function musicStyleChip(tagIds: string[]): MusicStyle {
  const genre = tagIds
    .map((id) => byId.get(id))
    .find((row) => row?.group === "genre");
  return genre || byId.get("c-pop") || MUSIC_STYLES[0];
}

export function musicStyleSummary(tagIds: string[], extra?: string): string {
  const labels = tagIds
    .map((id) => byId.get(id)?.label)
    .filter((row): row is string => Boolean(row));
  const note = extra?.trim();
  if (note) labels.push(note);
  return labels.join(" · ") || "选曲风";
}
