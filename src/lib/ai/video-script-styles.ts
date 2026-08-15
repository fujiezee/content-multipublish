import type { VideoScriptGenre, VideoScriptHookStyle } from "@/lib/types";

export type { VideoScriptHookStyle };

export const VIDEO_SCRIPT_HOOK_STYLES: Array<{
  id: VideoScriptHookStyle;
  label: string;
  hint: string;
  genre: VideoScriptGenre;
}> = [
  {
    id: "talk",
    label: "科普口播",
    hint: "直接讲清一件事，像跟朋友说话",
    genre: "edu",
  },
  {
    id: "roast",
    label: "打脸反转",
    hint: "先顺着常见错法，再一巴掌打回来",
    genre: "drama",
  },
  {
    id: "confess",
    label: "忏悔自述",
    hint: "我以前也踩过这个坑，现在才想通",
    genre: "drama",
  },
  {
    id: "argue",
    label: "抬杠抬死",
    hint: "先抬一句反对，当场拆掉",
    genre: "drama",
  },
  {
    id: "expose",
    label: "揭底内幕",
    hint: "揭一层别人不说的，但必须来自文章和语料",
    genre: "drama",
  },
  {
    id: "contrast",
    label: "前后对比",
    hint: "错法和对法并排，一眼看出差别",
    genre: "edu",
  },
  {
    id: "drama",
    label: "剧情短剧",
    hint: "用一件具体的事把道理演出来",
    genre: "drama",
  },
];

export function normalizeHookStyle(raw: unknown): VideoScriptHookStyle {
  const id = typeof raw === "string" ? raw.trim() : "";
  return VIDEO_SCRIPT_HOOK_STYLES.some((s) => s.id === id)
    ? (id as VideoScriptHookStyle)
    : "talk";
}

export function hookStyleMeta(id?: string | null) {
  const style = normalizeHookStyle(id);
  return (
    VIDEO_SCRIPT_HOOK_STYLES.find((s) => s.id === style) ||
    VIDEO_SCRIPT_HOOK_STYLES[0]
  );
}

export function genreFromHookStyle(id?: string | null): VideoScriptGenre {
  return hookStyleMeta(id).genre;
}

export function hookStyleLabel(id?: string | null): string {
  return hookStyleMeta(id).label;
}

export function hookStyleLine(id?: string | null): string {
  switch (normalizeHookStyle(id)) {
    case "roast":
      return `叙事壳：打脸反转。
前 3 秒先把观众正在做的错法说出来，让他点头；15 秒内一巴掌打回来：原来不是这样。
中间只推进「错在哪 → 对的做法是什么」一件事。不要骂人，不要编客户和数据。
花字狠、短，像打在脸上的那一句。`;
    case "confess":
      return `叙事壳：忏悔自述。
用第一人称「我以前也……」。钩子是自己踩过的坑，不是说教。
共鸣用「当时我也觉得自己挺对」，落地是现在才想通的那一句。
不要哭腔，不要英雄翻盘，像跟熟人承认一件事。`;
    case "argue":
      return `叙事壳：抬杠抬死。
开头先抛一句观众会抬的杠：「不就是……吗 / 谁还不是……」。
立刻拆掉这句杠，只拆一个点，拆完给一个能用的小办法。
对白可以顶两句，但不要变成拌嘴小品，更不要人身攻击。`;
    case "expose":
      return `叙事壳：揭底内幕。
钩子是「这件事大家一直没说破」。只揭文章和语料里已经有的一层，不许编内幕、客户、公司名。
节奏：先点破 → 为什么一直被掩盖/被忽略 → 你现在能怎么做。
像揭一层纸，不像爆料自媒体。`;
    case "contrast":
      return `叙事壳：前后对比。
整集只对比一件事的错法和对法。画面和口播都并排：左边这样会怎样，右边那样会怎样。
钩子用「就差这一点」。不要列清单，不要讲超过一个对比轴。`;
    case "drama":
      return `叙事壳：剧情短剧。
用一个具体的人、一件具体的事把文章里的道理演出来。要有人物、冲突、小反转。
对白口语，像真实聊天，不要播音腔，不要英雄脸谱，不要为煽情而哭。
钩子用「冲突/秘密/选择」停住；结尾留未说完的下一拍。`;
    default:
      return `叙事壳：科普口播。
一集只讲一个知识点。像聪明朋友拍着桌子讲，不要念稿，不要自我介绍，不要「大家好今天来讲」。
钩子用「原来不是这样 / 你一直做错了 / 一个很多人不知道的小区别」；共鸣用生活里的错法；中间用例子不用定义。`;
  }
}
