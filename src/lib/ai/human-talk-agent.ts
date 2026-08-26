import { AsyncLocalStorage } from "node:async_hooks";
import { listScriptLlmOptions, streamScriptLlm } from "@/lib/ai/script-llm";
import { PLAIN_TALK } from "@/lib/ai/oral-copy-agent";
import { modelHasBillablePrice } from "@/lib/ai/model-catalog/pricing";
import type { AiModelView, AiProviderChannel } from "@/lib/ai/model-catalog/types";
import { formatHumanTalkMemoryPrompt } from "@/lib/ai/human-talk-memory";
import { listAiModels } from "@/lib/db";

export type HumanTalkKind = "article" | "podcast" | "script";

export type HumanTalkModelOption = {
  id: string;
  provider: "deepseek" | "openai" | "anthropic" | "proxy";
  label: string;
  hint: string;
  cost: string;
  ready: boolean;
  badges?: Array<"recommended" | "hot" | "new">;
};

export type HumanTalkResult = {
  text: string;
  changed: boolean;
  issues: string[];
  model: string;
};

const store = new AsyncLocalStorage<string>();
const workspaceStore = new AsyncLocalStorage<string>();

const AI_TELLS: Array<{ re: RegExp; issue: string }> = [
  { re: /综上所述/g, issue: "综上所述" },
  { re: /总而言之/g, issue: "总而言之" },
  { re: /不难发现/g, issue: "不难发现" },
  { re: /值得注意的是/g, issue: "值得注意的是" },
  { re: /在当今(?:社会|时代)/g, issue: "在当今…" },
  { re: /随着(?:互联网|科技|人工智能|时代)的(?:飞速)?(?:发展|进步)/g, issue: "随着…的发展" },
  { re: /底层逻辑/g, issue: "底层逻辑" },
  { re: /赋能/g, issue: "赋能" },
  { re: /闭环/g, issue: "闭环" },
  { re: /抓手/g, issue: "抓手" },
  { re: /本文将/g, issue: "本文将" },
  { re: /本章将/g, issue: "本章将" },
  { re: /本系列将讲述/g, issue: "本系列将讲述" },
  { re: /首先[，,][\s\S]{0,80}其次/, issue: "首先…其次" },
  { re: /从三个层面/g, issue: "从三个层面" },
  { re: /至关重要/g, issue: "至关重要" },
  { re: /不可或缺/g, issue: "不可或缺" },
  { re: /具有重要(?:的)?(?:意义|作用)/g, issue: "具有重要意义" },
  { re: /提供了有力的/g, issue: "提供了有力的" },
  { re: /大家好[，,]/g, issue: "大家好" },
  { re: /欢迎收听/g, issue: "欢迎收听" },
  { re: /今天我们来(?:讲|聊)/g, issue: "今天我们来讲" },
  { re: /那我们今天/g, issue: "那我们今天" },
  { re: /下期见/g, issue: "下期见" },
  { re: /我们可以发现/g, issue: "我们可以发现" },
  { re: /核心要点如下/g, issue: "核心要点如下" },
  { re: /在此基础上/g, issue: "在此基础上" },
  { re: /进行(?:深度)?赋能/g, issue: "进行赋能" },
  { re: /不疼/g, issue: "装口语的「不疼」" },
  { re: /池子里/g, issue: "池子里" },
  { re: /先别答/g, issue: "问完立刻先别答" },
];

function catalogProvider(p: AiProviderChannel): HumanTalkModelOption["provider"] {
  if (p === "deepseek") return "deepseek";
  return "proxy";
}

function catalogToOption(model: AiModelView): HumanTalkModelOption {
  return {
    id: model.slug,
    provider: catalogProvider(model.provider),
    label: model.label,
    hint: model.hint,
    cost: model.costHint,
    ready: model.ready && model.enabled,
    badges: model.badges,
  };
}

export function listHumanTalkModelOptions(): HumanTalkModelOption[] {
  try {
    const catalog = listAiModels({
      modality: "text",
      use: "review",
      enabledOnly: true,
    }).filter(modelHasBillablePrice);
    if (catalog.length) return catalog.map(catalogToOption);
  } catch {
    // DB not ready
  }
  try {
    const fallback = listAiModels({
      modality: "text",
      use: "copywriting",
      enabledOnly: true,
    }).filter(modelHasBillablePrice);
    if (fallback.length) return fallback.map(catalogToOption);
  } catch {
    // ignore
  }
  return listScriptLlmOptions().map((item) => ({
    id: item.id,
    provider: item.provider,
    label: item.label,
    hint: item.hint,
    cost: item.cost,
    ready: item.ready,
    badges: item.badges,
  }));
}

export function defaultHumanTalkModelId(): string {
  const ready = listHumanTalkModelOptions().filter((item) => item.ready);
  return (
    ready.find((item) => item.id === "deepseek-chat")?.id ||
    ready[0]?.id ||
    "deepseek-chat"
  );
}

export function normalizeHumanTalkModelId(raw?: string | null): string {
  const id = String(raw || "").trim();
  if (!id) return defaultHumanTalkModelId();
  if (listHumanTalkModelOptions().some((item) => item.id === id)) return id;
  try {
    const row = listAiModels({ modality: "text", enabledOnly: true }).find(
      (model) => model.slug === id,
    );
    if (row) return id;
  } catch {
    // ignore
  }
  return defaultHumanTalkModelId();
}

export function withHumanTalkModel<T>(
  id: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return store.run(normalizeHumanTalkModelId(id), fn);
}

export function withHumanTalkWorkspace<T>(
  workspaceId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const id = String(workspaceId || "").trim();
  if (!id) return fn();
  return workspaceStore.run(id, fn);
}

export function withHumanTalk<T>(
  workspaceId: string | undefined,
  modelId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return withHumanTalkWorkspace(workspaceId, () =>
    withHumanTalkModel(modelId, fn),
  );
}

export function activeHumanTalkModel(): string {
  return store.getStore() || defaultHumanTalkModelId();
}

export function activeHumanTalkWorkspace(): string {
  return String(workspaceStore.getStore() || "").trim();
}

export function copywritingNeedsHumanTalk(kind: string): boolean {
  return kind !== "slogan" && kind !== "script_outline";
}

function spokenChunks(text: string): string[] {
  const raw = String(text || "").trim();
  if (!raw) return [];
  try {
    const json = JSON.parse(raw) as {
      turns?: unknown;
      episodes?: unknown;
    };
    if (Array.isArray(json.turns)) {
      return json.turns
        .map((row) =>
          row && typeof row === "object" && "text" in row
            ? String((row as { text?: unknown }).text || "").trim()
            : "",
        )
        .filter(Boolean);
    }
    if (Array.isArray(json.episodes)) {
      return json.episodes.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const rec = row as { hook?: unknown; voiceover?: unknown };
        return [String(rec.hook || "").trim(), String(rec.voiceover || "").trim()].filter(
          Boolean,
        );
      });
    }
  } catch {
    // not json
  }
  return raw
    .split(/\n+/)
    .map((line) => line.replace(/^(?:问|答|主持|嘉宾|口播|旁白)[：:]\s*/, "").trim())
    .filter((line) => line.length >= 4);
}

function spokenTurns(text: string): Array<{ text: string; feel: string }> {
  const raw = String(text || "").trim();
  if (!raw) return [];
  try {
    const json = JSON.parse(raw) as { turns?: unknown };
    if (Array.isArray(json.turns)) {
      return json.turns
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const rec = row as { text?: unknown; feel?: unknown };
          const spoken = String(rec.text || "").trim();
          if (!spoken) return null;
          return { text: spoken, feel: String(rec.feel || "").trim() };
        })
        .filter((row): row is { text: string; feel: string } => Boolean(row));
    }
  } catch {
    // not json
  }
  return spokenChunks(raw).map((chunk) => ({ text: chunk, feel: "" }));
}

const PLAYFUL_LINE =
  /闻得出来|嗅得出来|模型闻|扑面而来|你别笑|得了吧|说真的吧|呵[，,！!]|损一句/;
const FLAT_FEEL = /认真|郑重|平|冷静|陈述/;

function heuristicToneIssues(text: string): string[] {
  const turns = spokenTurns(text);
  if (turns.length < 3) return [];
  const issues: string[] = [];
  const feels = turns.map((turn) => turn.feel).filter(Boolean);
  if (feels.length >= 4) {
    const unique = new Set(feels);
    if (unique.size <= 1) issues.push("口气一路平");
  }
  for (let i = 2; i < feels.length; i += 1) {
    if (feels[i] && feels[i] === feels[i - 1] && feels[i] === feels[i - 2]) {
      issues.push("连续几段一个调");
      break;
    }
  }
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];
    if (!turn || !PLAYFUL_LINE.test(turn.text)) continue;
    const feel = turn.feel;
    const neighbors = [turns[i - 1]?.text, turns[i + 1]?.text].filter(Boolean);
    const neighborHasShift = neighbors.some((line) => /[？?！!]/.test(line || ""));
    if (feel && FLAT_FEEL.test(feel)) {
      issues.push("俏皮句口气没换");
      break;
    }
    if (!feel && !/[？?！!]/.test(turn.text) && !neighborHasShift) {
      issues.push("俏皮句口气没换");
      break;
    }
  }
  return issues;
}

export function heuristicHumanTalkIssues(text: string): string[] {
  const blob = String(text || "");
  if (!blob.trim()) return [];
  const issues: string[] = [];
  for (const tell of AI_TELLS) {
    tell.re.lastIndex = 0;
    if (tell.re.test(blob)) issues.push(tell.issue);
  }
  const notBut = blob.match(/不是.{1,12}(?:而是|是)/g) || [];
  if (notBut.length >= 3) issues.push("「不是X是Y」套了太多次");
  const firstSecond = blob.match(/第[一二三1-3][、.．]/g) || [];
  if (firstSecond.length >= 3) issues.push("一二三提纲写在脸上");
  const chunks = spokenChunks(blob);
  for (let i = 1; i < chunks.length; i += 1) {
    const prev = chunks[i - 1] || "";
    const next = chunks[i] || "";
    if (/[？?]/.test(prev) && /先别(?:答|急着答)/.test(next)) {
      issues.push("问完不接，改口卖关子");
      break;
    }
    if (
      /英文|英语|English/i.test(prev) &&
      /你卖谁|卖给谁|你卖的是谁/.test(next) &&
      !/英文|英语|English/i.test(next)
    ) {
      issues.push("上一句英文，下一句客户，中间没桥");
      break;
    }
  }
  issues.push(...heuristicToneIssues(blob));
  return [...new Set(issues)];
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced?.[1] || raw).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function formatRules(kind: HumanTalkKind): string {
  if (kind === "podcast") {
    return `原文可能是口播 Markdown，也可能是 JSON：{"title":"","turns":[{"speaker":"host|guest","text":"","feel":""}]}。
重写必须保持同一格式：JSON 就仍输出完整 JSON（title / turns 条数、speaker 不要丢）。Markdown 就仍是可直接念的口播，不要改成公众号课。
相邻两轮必须咬住：后一句听得出是在回前一句，不许换题目。
俏皮可以，feel 必须跟着换：损、笑、轻一下，不能连续几段都是「认真揭开」。rewrite 时 feel 可以改。`;
  }
  if (kind === "script") {
    return `原文是短剧准稿。可能带【对话】或【旁白】，对白行是「角色名：原话」。
重写只改听着像机器、接不上、或口气一路平的词，不准改剧情、不准换人、不准删角色名、不准把戏写成口播课。花字/分镜不要管。
对白必须一来一回接得上。俏皮句前后口气要变，不能整场一个调。`;
  }
  return `原文是写稿成稿，常见格式：
标题: …
摘要: …
正文:
…
重写必须仍是这一套，标题/摘要/正文都要在。不要改成提纲，不要加「本文将」。
段与段必须顺着同一件事往下说。俏皮句前后节奏、问号、口气要换，不能贴在书面腔上。`;
}

const COHERENCE_RULES = `上下文必须一根线。上一句问什么，下一句就接这个问；上一句揭到哪，下一句从那儿往下。听的人要觉得是同一个人把一件事说完。

不过的例子：
「做 GEO 是不是一上来就得写英文？我听到好多人这么说。」
下一句却是「先别答。你看你卖谁。」
问的是英文，接的是客户，中间没有桥。真人不会这么跳。

怎么改：要么先把英文这件事说完再转到卖给谁，要么开头就问卖给谁。不要两头各甩一句，不要用「先别答」当假钩。

俏皮可以。假在口气没换。
- 过：前面急着问、不服，中间轻一下、损一句（「这种稿模型闻得出来」），下一句又接正事。听得出口气变了。
- 不过：整段平着讲，忽然插一句俏皮，前后仍是一个调。
- 「不疼」「池子里」不是俏皮，是空词，仍要改。

还要抓：
- 问完立刻「先别答 / 先别急着答」，然后另起一摊。
- 段落像提纲条目被拆成口语，彼此不咬合。
- 口播连续几段同一个心情，没有轻重。`;

function workspaceMemoryBlock(): string {
  const workspaceId = activeHumanTalkWorkspace();
  if (!workspaceId) return "";
  const memory = formatHumanTalkMemoryPrompt(workspaceId);
  return memory ? `\n${memory}\n` : "";
}

function systemPrompt(kind: HumanTalkKind): string {
  const job =
    kind === "podcast"
      ? "审口播/播客稿"
      : kind === "script"
        ? "审短剧对白"
        : "审文章成稿";
  return `你是点物的人话审核 Agent。只做一件事：${job}。机器稿、接不上的稿，都不要放行，顺着上一句重写成能听下去的人话。

${PLAIN_TALK}

${COHERENCE_RULES}
${workspaceMemoryBlock()}

什么叫机器稿（命中就要重写）：
- 书面腔、总结腔、客服腔、播音腔：综上所述、首先其次、本文将、大家好欢迎收听、底层逻辑、赋能、抓手、闭环、至关重要。
- 排比三连、金句工厂、「不是X是Y」连用三遍。
- 提纲写在脸上：第一第二第三、从三个层面、现象/误区/原理当小标题。
- 四平八稳、谁说都行、没有活人口气。
- 俏皮句贴在一个调上：前后语气语调没变。俏皮本身不是问题，口气没换才是。

什么不要误伤：
- 口语里偶发一次「原来不是 X，是 Y」可以留。
- 你看、其实、说白了、卡住了，这些是人话。
- 专有名词、人名、品牌、数字、事实不准编、不准删。
- 改的时候只接上断掉的那一截，不要另写一篇无关的。

${formatRules(kind)}

只输出 JSON：
过了：{"ok":true,"issues":[]}
没过：{"ok":false,"issues":["短因由"],"rewrite":"完整重写稿，格式与原文相同"}
不要解释，不要 Markdown 围栏。`;
}

function userPrompt(text: string, hints: string[]): string {
  const clue = hints.length
    ? `已抓到的问题（参考，不要见词就删，重点看上下句接不接得上）：${hints.join("、")}`
    : "先通读。机器味、上下句接不上、俏皮却口气一路平，都要重写；人话、一根线、口气有轻重才 ok=true。";
  const jsonHint = text.trim().startsWith("{")
    ? "原文是 JSON。rewrite 必须仍是完整 JSON，字段名、条数、speaker / episode_no 不要丢。俏皮句的 feel 必须换，不要连续几段同一个心情。"
    : "";
  return `${clue}
${jsonHint}

【待审】
${text}`;
}

function parseReview(raw: string, original: string): {
  ok: boolean;
  issues: string[];
  rewrite: string;
} {
  const json = extractJsonObject(raw);
  if (!json) {
    const trimmed = raw.trim();
    if (trimmed && /标题[:：]/.test(trimmed) && trimmed !== original.trim()) {
      return { ok: false, issues: ["模型没按 JSON 返回，稿子像重写稿"], rewrite: trimmed };
    }
    return { ok: true, issues: [], rewrite: "" };
  }
  const ok = json.ok !== false;
  const issues = Array.isArray(json.issues)
    ? json.issues.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const rewrite = typeof json.rewrite === "string" ? json.rewrite.trim() : "";
  if (json.ok === undefined && !rewrite) {
    const looksLikePayload =
      Array.isArray(json.episodes) || Array.isArray(json.turns);
    if (looksLikePayload) {
      return {
        ok: false,
        issues: issues.length ? issues : ["直接回了改稿"],
        rewrite: JSON.stringify(json),
      };
    }
  }
  return { ok, issues, rewrite };
}

export type HumanTalkProgress =
  | { type: "status"; message: string }
  | { type: "thinking"; delta: string };

export async function* streamPolishHumanTalk(input: {
  kind: HumanTalkKind;
  text: string;
  maxTokens?: number;
  signal?: AbortSignal;
}): AsyncGenerator<HumanTalkProgress, HumanTalkResult> {
  const text = String(input.text || "");
  const model = activeHumanTalkModel();
  const hints = heuristicHumanTalkIssues(text);
  if (text.replace(/\s+/g, "").length < 40) {
    return { text, changed: false, issues: [], model };
  }

  if (hints.length) {
    yield {
      type: "status",
      message: `人话审核抓到：${hints.slice(0, 4).join("、")}`,
    };
  } else {
    yield {
      type: "status",
      message: "正在过人话审核，看接不接得上、口气有没有假…",
    };
  }
  yield { type: "thinking", delta: "\n\n—— 人话审核 ——\n" };

  let raw = "";
  try {
    for await (const chunk of streamScriptLlm(
      [
        { role: "system", content: systemPrompt(input.kind) },
        { role: "user", content: userPrompt(text, hints) },
      ],
      {
        model,
        temperature: 0.45,
        maxTokens: input.maxTokens ?? (input.kind === "article" ? 32768 : 8192),
        timeoutMs: input.kind === "article" ? 240_000 : 90_000,
        signal: input.signal,
      },
    )) {
      if (chunk.type === "thinking" && chunk.text) {
        yield { type: "thinking", delta: chunk.text };
      } else if (chunk.type === "content" && chunk.text) {
        raw += chunk.text;
        yield { type: "thinking", delta: chunk.text };
      }
    }
  } catch (err) {
    console.error("[human-talk]", err instanceof Error ? err.message : err);
    return { text, changed: false, issues: hints, model };
  }

  const parsed = parseReview(raw, text);
  if (parsed.ok || !parsed.rewrite) {
    yield {
      type: "status",
      message: parsed.issues.length
        ? `人话审核过了（${parsed.issues.slice(0, 2).join("、")}，没重写）`
        : "人话审核过了，没改",
    };
    return { text, changed: false, issues: parsed.issues, model };
  }

  yield {
    type: "status",
    message: parsed.issues.length
      ? `人话审核没过：${parsed.issues.slice(0, 3).join("、")}，正在换成能听的…`
      : "人话审核没过，正在换成能听的…",
  };

  let rewrite = parsed.rewrite;
  const still = heuristicHumanTalkIssues(rewrite);
  if (still.length >= 3 && still.length >= hints.length) {
    console.warn("[human-talk] rewrite still dirty", still.join("、"));
  }
  if (!rewrite.trim()) rewrite = text;
  const changed = rewrite.trim() !== text.trim();
  if (changed) {
    yield { type: "status", message: "人话审核改完了" };
  }
  return {
    text: rewrite,
    changed,
    issues: parsed.issues,
    model,
  };
}

export async function polishHumanTalk(input: {
  kind: HumanTalkKind;
  text: string;
  maxTokens?: number;
  signal?: AbortSignal;
  onEvent?: (event: HumanTalkProgress) => void | Promise<void>;
}): Promise<HumanTalkResult> {
  const gen = streamPolishHumanTalk(input);
  while (true) {
    const step = await gen.next();
    if (step.done) return step.value;
    await input.onEvent?.(step.value);
  }
}

export async function polishPodcastScript<T extends {
  title: string;
  turns: Array<{ speaker: string; text: string; feel?: string }>;
}>(script: T): Promise<T> {
  const payload = JSON.stringify(
    {
      title: script.title,
      turns: script.turns.map((turn) => ({
        speaker: turn.speaker,
        text: turn.text,
        feel: turn.feel || "",
      })),
    },
    null,
    2,
  );
  const polished = await polishHumanTalk({
    kind: "podcast",
    text: payload,
    maxTokens: 4096,
  });
  if (!polished.changed) return script;
  const json = extractJsonObject(polished.text);
  const rows = Array.isArray(json?.turns) ? json.turns : [];
  if (!rows.length) return script;
  const nextTurns = script.turns.map((turn, index) => {
    const row = rows[index] as { text?: unknown; feel?: unknown } | undefined;
    const text = typeof row?.text === "string" ? row.text.trim() : "";
    const feel = typeof row?.feel === "string" ? row.feel.trim().slice(0, 36) : "";
    if (!text && !feel) return turn;
    return {
      ...turn,
      ...(text ? { text: text.slice(0, 240) } : {}),
      ...(feel ? { feel } : {}),
    };
  });
  const title =
    typeof json?.title === "string" && json.title.trim()
      ? json.title.trim().slice(0, 24)
      : script.title;
  return { ...script, title, turns: nextTurns };
}

export async function polishEpisodeScripts<T extends {
  episode_no: number;
  hook: string;
  voiceover: string;
}>(
  episodes: T[],
  onEvent?: (event: { type: "status"; message: string }) => void | Promise<void>,
): Promise<T[]> {
  if (!episodes.length) return episodes;
  await onEvent?.({ type: "status", message: "正在过人话审核…" });
  const chunkSize = 4;
  const out = episodes.map((ep) => ({ ...ep }));
  for (let i = 0; i < out.length; i += chunkSize) {
    const chunk = out.slice(i, i + chunkSize);
    const payload = JSON.stringify(
      {
        episodes: chunk.map((ep) => ({
          episode_no: ep.episode_no,
          hook: ep.hook,
          voiceover: ep.voiceover,
        })),
      },
      null,
      2,
    );
    const polished = await polishHumanTalk({
      kind: "script",
      text: payload,
      maxTokens: Math.min(16384, 2048 * chunk.length + 2048),
    });
    if (!polished.changed) continue;
    await onEvent?.({
      type: "status",
      message: "话接不上，正在顺着改…",
    });
    const json = extractJsonObject(polished.text);
    const rows = Array.isArray(json?.episodes) ? json.episodes : [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const rec = row as { episode_no?: unknown; hook?: unknown; voiceover?: unknown };
      const no = Number(rec.episode_no);
      const target = out.find((ep) => ep.episode_no === no);
      if (!target) continue;
      if (typeof rec.voiceover === "string" && rec.voiceover.trim()) {
        target.voiceover = rec.voiceover.trim();
      }
      if (typeof rec.hook === "string" && rec.hook.trim()) {
        target.hook = rec.hook.trim().slice(0, 80);
      }
    }
  }
  return out;
}
