import { chatCompletion } from "@/lib/ai/deepseek";
import {
  applyShotEmotionPatches,
  isLectureAskLine,
  scrubShotFlowers,
  type ShotEmotionPatch,
} from "@/lib/ai/emotion-beat";
import {
  formatStanceCards,
  type StanceCard,
} from "@/lib/ai/stance-card";
import {
  bindShotsToVoiceover,
  canonicalizeVoiceover,
  rewriteIsUsable,
  splitLabeledTurns,
  type GeneratedEpisodeScript,
  type VideoScriptGenEvent,
} from "@/lib/ai/video-script";
import {
  normalizeSpeakMode,
  stripInnerTag,
  type VideoSpeakMode,
} from "@/lib/types";

const SPEAKER_PREFIX =
  /^([\u4e00-\u9fffA-Za-z·]{1,8}(?:[（(](?:内心|独白|心里)[）)])?)[：:]/;
const SCRIPT_MODE_RE = /^【(对话|旁白)】\s*/;

export type ScriptTurn = { who: string; line: string };
export type ScriptReviewVerdict = "ok" | "relabel" | "fix" | "rewrite";

export type ScriptIssue = {
  code: ScriptReviewVerdict | "solo" | "unlabeled" | "lecture";
  message: string;
};

function spokenLine(text: string): string {
  const t = String(text || "").trim();
  return t.replace(SPEAKER_PREFIX, "").trim() || t;
}

function speakerOf(text: string): string {
  return stripInnerTag(text.match(SPEAKER_PREFIX)?.[1] || "");
}

export function scriptTurns(voiceover: string): ScriptTurn[] {
  const clean = String(voiceover || "").replace(SCRIPT_MODE_RE, "").trim();
  if (!clean) return [];
  return splitLabeledTurns(clean).map((part) => ({
    who: speakerOf(part),
    line: spokenLine(part),
  }));
}

export function speakersFromVoiceover(text: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const turn of scriptTurns(text)) {
    const who = turn.who.trim();
    if (!who || who === "旁白" || !turn.line.trim() || seen.has(who)) continue;
    seen.add(who);
    names.push(who);
  }
  return names;
}

export function collectScriptCast(
  episode: Pick<GeneratedEpisodeScript, "voiceover" | "shots">,
  named: string[] = [],
): string[] {
  const fromScript = scriptTurns(episode.voiceover)
    .map((turn) => turn.who)
    .filter((name) => name && name !== "旁白");
  const fromShots = (episode.shots || [])
    .map((shot) => shot.speaker?.trim() || "")
    .filter((name) => name && name !== "旁白");
  return [...new Set([...named, ...fromScript, ...fromShots].filter(Boolean))];
}

export function relabelScriptTurns(
  voiceover: string,
  speakers: string[],
  allowed: string[],
): string | null {
  const turns = scriptTurns(voiceover);
  if (turns.length === 0 || speakers.length !== turns.length) return null;
  const ok = new Set(["旁白", ...allowed.filter(Boolean)]);
  const next = turns.map((turn, i) => {
    const who = String(speakers[i] || "").trim();
    return {
      who: who && (ok.size <= 1 || ok.has(who)) ? who : turn.who || who,
      line: turn.line,
    };
  });
  if (next.every((turn, i) => turn.who === turns[i]?.who)) return null;
  const header = String(voiceover || "").trim().match(SCRIPT_MODE_RE)?.[1];
  const body = next
    .map((turn) => (turn.who ? `${turn.who}：${turn.line}` : turn.line))
    .join("");
  return header ? `【${header}】${body}` : body;
}

export function findScriptIssues(
  episode: Pick<GeneratedEpisodeScript, "voiceover" | "shots" | "title">,
  speakMode?: VideoSpeakMode,
): ScriptIssue[] {
  const mode = normalizeSpeakMode(speakMode);
  const turns = scriptTurns(episode.voiceover);
  const issues: ScriptIssue[] = [];
  if (
    /第一把|第二把|第三把|三把尺子|你知道为什么吗|那怎么衡量|下一集.{0,12}(讲|拆|看)|三个问法|改对外说法|AI推荐了谁/.test(
      `${episode.title}\n${episode.voiceover}`,
    )
  ) {
    issues.push({ code: "lecture", message: "还是口播课腔" });
  }
  const firstLine =
    episode.shots?.[0]?.voiceover ||
    episode.voiceover.replace(/^【(?:对话|旁白)】\s*/, "").split(/[。！？]/)[0] ||
    "";
  if (isLectureAskLine(firstLine)) {
    issues.push({
      code: "lecture",
      message: "开场在讲规矩、问懂不懂，还没把帖拍上桌",
    });
  }
  if (mode !== "dialogue") return issues;
  const named = turns.filter((turn) => turn.who && turn.who !== "旁白");
  if (turns.length >= 4 && named.length < Math.ceil(turns.length * 0.6)) {
    issues.push({ code: "unlabeled", message: "对白没有按「角色名：」署名" });
  }
  const people = [...new Set(named.map((turn) => turn.who))];
  if (turns.length >= 6 && people.length < 2) {
    issues.push({ code: "solo", message: "对话写成了一个人念稿" });
  }
  return issues;
}

function applyVoiceover(
  episode: GeneratedEpisodeScript,
  voiceover: string,
  durationSec?: unknown,
  speakMode?: VideoSpeakMode,
): GeneratedEpisodeScript {
  const nextVo = canonicalizeVoiceover(voiceover, speakMode);
  const shots = bindShotsToVoiceover(episode.shots, nextVo, durationSec);
  const duration = shots.reduce((sum, shot) => sum + shot.seconds, 0);
  return {
    ...episode,
    voiceover: nextVo,
    shots,
    duration_sec: duration || episode.duration_sec,
  };
}

function extractReviewJson(raw: string): {
  pass?: boolean;
  verdict?: string;
  issues?: string[];
  speakers?: unknown;
  voiceover?: unknown;
  shots?: unknown;
} | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as {
      pass?: boolean;
      verdict?: string;
      issues?: string[];
      speakers?: unknown;
      voiceover?: unknown;
      shots?: unknown;
    };
  } catch {
    return null;
  }
}

function numberedTurns(turns: ScriptTurn[]): string {
  return turns
    .map((turn, i) => `${i + 1}. ${turn.who || "未署名"}：${turn.line}`)
    .join("\n");
}

async function judgeStance(input: {
  episode: GeneratedEpisodeScript;
  cards: StanceCard[];
  cast: string[];
  speakMode?: VideoSpeakMode;
}): Promise<{
  verdict: ScriptReviewVerdict;
  speakers?: string[];
  voiceover?: string;
  issues: string[];
}> {
  const turns = scriptTurns(input.episode.voiceover);
  if (turns.length < 2) return { verdict: "ok", issues: [] };
  const raw = await chatCompletion(
    [
      {
        role: "system",
        content: `你是短剧立场审稿。先锁人设卡，再逐句看这句话的权力、信息差、称呼像不像署名这个人。
场上可能有很多人。不要按两人对打轮流改。
同一个人可以连说几句。
分清三种修法：
1. relabel：口气和立场是对的，只是名字标错了。只改署名，原话不动。
2. fix：署名对，但这句话的立场反了（下属在下命令、不知情者在教人、拍板的人在请示）。必须改这一句的词，让它回到这个人的身份。
3. rewrite：连续多句立场塌了，整段权力关系写反，改几句救不回来。
通过：{"pass":true,"verdict":"ok","issues":[]}
署名错：{"pass":false,"verdict":"relabel","issues":["第N句应是某某，因为……"],"speakers":["人名"]}
改词：{"pass":false,"verdict":"fix","issues":["第N句立场反了"],"voiceover":"【对话】完整准稿"}
重写：{"pass":false,"verdict":"rewrite","issues":["后半集主管下属写反了"]}
speakers 必须和句子条数一样。voiceover 必须是完整准稿，剧情不要另起一套。`,
      },
      {
        role: "user",
        content: `${formatStanceCards(input.cards) || `场上的人：${input.cast.join("、")}`}
说话方式：${normalizeSpeakMode(input.speakMode) === "dialogue" ? "对话" : "旁白"}
第 ${input.episode.episode_no} 集《${input.episode.title}》
共 ${turns.length} 句：
${numberedTurns(turns)}`,
      },
    ],
    {
      model: "deepseek-chat",
      temperature: 0.15,
      maxTokens: 2500,
      timeoutMs: 60_000,
    },
  );
  const parsed = extractReviewJson(raw);
  if (!parsed || parsed.pass === true || parsed.verdict === "ok") {
    return { verdict: "ok", issues: [] };
  }
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.map((item) => String(item)).filter(Boolean)
    : [];
  const speakers = Array.isArray(parsed.speakers)
    ? parsed.speakers.map((name) => String(name || "").trim())
    : [];
  const voiceover =
    typeof parsed.voiceover === "string" ? parsed.voiceover.trim() : "";
  if (parsed.verdict === "rewrite") return { verdict: "rewrite", issues };
  if (parsed.verdict === "fix" && voiceover) {
    return { verdict: "fix", voiceover, issues };
  }
  if (speakers.length === turns.length) {
    return { verdict: "relabel", speakers, issues };
  }
  if (voiceover) return { verdict: "fix", voiceover, issues };
  return { verdict: "ok", issues };
}

function numberedShots(episode: GeneratedEpisodeScript): string {
  return (episode.shots || [])
    .map((shot) => {
      const flower = shot.onScreen || "（无花字）";
      const look = shot.look || "（没写看谁）";
      const beat = shot.beat || "（没写节拍）";
      return `${shot.index}. beat=${beat} look=${look} 花字=${flower}\n   对白：${shot.voiceover}\n   画面：${shot.visual}`;
    })
    .join("\n");
}

function parseEmotionShots(raw: unknown): ShotEmotionPatch[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const index = Number(o.index ?? o.shot ?? o.no);
      if (!Number.isFinite(index) || index <= 0) return null;
      return {
        index: Math.round(index),
        beat: typeof o.beat === "string" ? o.beat : "",
        look: typeof o.look === "string" ? o.look : "",
        visual: typeof o.visual === "string" ? o.visual : "",
        onScreen: typeof o.onScreen === "string" ? o.onScreen : typeof o.on_screen === "string" ? o.on_screen : "",
      };
    })
    .filter((row): row is ShotEmotionPatch => Boolean(row));
}

async function judgeEmotion(input: {
  episode: GeneratedEpisodeScript;
  show?: boolean;
}): Promise<{ pass: boolean; issues: string[]; shots: ShotEmotionPatch[] }> {
  const shots = input.episode.shots || [];
  if (shots.length < 2) return { pass: true, issues: [], shots: [] };
  const raw = await chatCompletion(
    [
      {
        role: "system",
        content: `你是漫剧情绪审稿。对白已经按人设卡审过，不要改准稿原话，只改分镜怎么调用观众情绪。
过不了的情况：
1. 开场没有扎人（第一镜不像钩，画面没有身体一紧）
2. 开场在讲规矩、问「你可明白/你可知/祖制如此」，还没把帖拍上桌
3. 全程没有反应镜（人人张嘴，没有看挨打的人、特写手/眼/折子）
4. 花字在复述对白，没有替观众说没出口的那句
5. 观众不知道替谁着急
6. 第一镜是两人端坐讲课的全景，没有特写帖/手/被压的脸
修法：只改 shots 的 beat/look/visual/onScreen。voiceover 一字不动。剧情不要另起一套。
beat 只能是 钩|共|顶|打|停。
通过：{"pass":true,"issues":[]}
要改分镜：{"pass":false,"issues":["开场没有扎","没有反应镜"],"shots":[{"index":1,"beat":"钩","look":"特写被扔的折子","visual":"…","onScreen":"…"}]}
shots 必须覆盖你改过的那些镜，index 对上原分镜。`,
      },
      {
        role: "user",
        content: `${input.show ? "这是竖屏漫剧。" : "这是口播短视频，也要有钩和共鸣。"}
第 ${input.episode.episode_no} 集《${input.episode.title}》
钩子：${input.episode.hook}
收束：${input.episode.recap}
准稿（不要改）：
${input.episode.voiceover}
分镜：
${numberedShots(input.episode)}`,
      },
    ],
    {
      model: "deepseek-chat",
      temperature: 0.2,
      maxTokens: 2500,
      timeoutMs: 60_000,
    },
  );
  const parsed = extractReviewJson(raw);
  if (!parsed || parsed.pass === true) {
    return { pass: true, issues: [], shots: [] };
  }
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.map((item) => String(item)).filter(Boolean)
    : [];
  return {
    pass: false,
    issues,
    shots: parseEmotionShots(parsed.shots),
  };
}

export async function reviewGeneratedEpisodes(
  episodes: GeneratedEpisodeScript[],
  input: {
    speakMode?: VideoSpeakMode;
    characterName?: string | string[];
    durationSec?: unknown;
    cards?: StanceCard[];
    show?: boolean;
    skipEmotion?: boolean;
    rewriteEpisode?: (
      episode: GeneratedEpisodeScript,
      issues: string[],
    ) => Promise<GeneratedEpisodeScript | null>;
  },
  onEvent?: (event: VideoScriptGenEvent) => void | Promise<void>,
): Promise<GeneratedEpisodeScript[]> {
  const named = (Array.isArray(input.characterName)
    ? input.characterName
    : [input.characterName || ""]
  )
    .map((name) => name.trim())
    .filter(Boolean);
  const out: GeneratedEpisodeScript[] = [];
  let fixed = 0;
  for (const episode of episodes) {
    await onEvent?.({
      type: "status",
      message: `第 ${episode.episode_no} 集审稿中，在核立场有没有写反…`,
    });
    const cast = collectScriptCast(episode, [
      ...named,
      ...(input.cards || []).map((card) => card.name),
    ]);
    let next = episode;
    let verdict: ScriptReviewVerdict = "ok";
    try {
      const judged = await judgeStance({
        episode,
        cards: input.cards || [],
        cast,
        speakMode: input.speakMode,
      });
      verdict = judged.verdict;
      if (judged.verdict === "relabel" && judged.speakers) {
        const relabeled = relabelScriptTurns(episode.voiceover, judged.speakers, [
          ...cast,
          "旁白",
        ]);
        if (relabeled) {
          const patched = applyVoiceover(
            episode,
            relabeled,
            input.durationSec,
            input.speakMode,
          );
          if (rewriteIsUsable(patched, episode, input.durationSec)) next = patched;
        }
      } else if (judged.verdict === "fix" && judged.voiceover) {
        const patched = applyVoiceover(
          episode,
          judged.voiceover,
          input.durationSec,
          input.speakMode,
        );
        if (rewriteIsUsable(patched, episode, input.durationSec)) next = patched;
      } else if (judged.verdict === "rewrite" && input.rewriteEpisode) {
        await onEvent?.({
          type: "status",
          message: `第 ${episode.episode_no} 集立场写反了，按人设卡重写对白…`,
        });
        const rewritten = await input.rewriteEpisode(episode, judged.issues);
        if (rewritten && rewriteIsUsable(rewritten, episode, input.durationSec)) {
          next = rewritten;
        }
      }
    } catch {
      next = episode;
      verdict = "ok";
    }
    if (next.voiceover !== episode.voiceover) {
      fixed += 1;
      const label =
        verdict === "rewrite"
          ? "按人设卡重写了对白"
          : verdict === "fix"
            ? "改了立场反了的句子"
            : "改了说错人的署名";
      await onEvent?.({
        type: "status",
        message: `第 ${episode.episode_no} 集审稿${label}`,
      });
    }
    if (!input.skipEmotion) {
      try {
        await onEvent?.({
          type: "status",
          message: `第 ${episode.episode_no} 集审稿中，在核共鸣和反应镜…`,
        });
        const felt = await judgeEmotion({ episode: next, show: input.show });
        if (!felt.pass && felt.shots.length > 0) {
          const patched = applyShotEmotionPatches(next.shots, felt.shots);
          const changed = patched.some((shot, i) => {
            const prev = next.shots[i];
            return (
              shot.beat !== prev?.beat ||
              shot.look !== prev?.look ||
              shot.visual !== prev?.visual ||
              shot.onScreen !== prev?.onScreen
            );
          });
          if (changed) {
            next = { ...next, shots: patched };
            await onEvent?.({
              type: "status",
              message: `第 ${episode.episode_no} 集审稿按情绪改了分镜`,
            });
          }
        }
      } catch {
        // 立场已经审过，情绪审稿失败就沿用当前分镜
      }
    }
    next = { ...next, shots: scrubShotFlowers(next.shots) };
    out.push(next);
  }
  await onEvent?.({
    type: "status",
    message: input.skipEmotion
      ? fixed > 0
        ? `审稿完成：改了 ${fixed} 集立场，分镜交给导演`
        : `审稿完成：${episodes.length} 集立场无误，分镜交给导演`
      : fixed > 0
        ? `审稿完成：改了 ${fixed} 集立场，并核过共鸣`
        : `审稿完成：${episodes.length} 集立场无误，已核共鸣`,
  });
  return out;
}
