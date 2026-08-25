import { maxImageRefsForModel } from "@/lib/ai/image-gen-models";
import {
  inferEpisodeWardrobeLock,
  inferShotJoin,
  manhuaScenePrompt,
  sceneCutsAway,
  shouldReusePrevStart,
  type SceneCastPerson,
  type SceneCastRef,
  type SceneRefLook,
} from "@/lib/ai/manhua-look";
import { propsForShot, samePropName, shotMentionsProp } from "@/lib/ai/script-props";
import {
  inferCharacterGender,
  voiceGender,
} from "@/lib/ai/tts-voice-ids";
import { seriesWardrobeLine, type SeriesWardrobeLock, type ShotAgentLock } from "@/lib/ai/director-lock";
import { normalizeShotBeat, shotSpeaksFromStart } from "@/lib/ai/emotion-beat";
import { lockEpisodeSpeechTiming } from "@/lib/ai/shot-speech";
import {
  generateImageWithChat,
  loadImageRef,
  type ImageInlineRef,
} from "@/lib/ai/openai-image";
import {
  defaultRefShotIndex,
  shotEndUrl,
  shotHasKeyframes,
  shotNeedsLockedSpeech,
  shotStartUrl,
  shotTailUrl,
  type VideoCharacterAngle,
  type VideoCharacterPhoto,
  shotIsInner,
  type ScriptProp,
  type ShotJoin,
  type VideoShot,
  type VideoSpeakMode,
} from "@/lib/types";

export { defaultRefShotIndex };

export type { SceneRefLook };

/** 分镜预算按 Seedream 10 张。出图再按模型截。 */
export const MAX_SCENE_REFS = 10;
export const maxSceneRefsForModel = maxImageRefsForModel;

export type SceneRefPlanItem =
  | { kind: "character"; name: string }
  | { kind: "prop"; name: string; look?: string }
  | { kind: "scene"; url: string };

/** 这一镜画面/对白里实际出场的人，按本剧名单认。 */
export function peopleOnShot(
  shot:
    | Pick<
        VideoShot,
        "speaker" | "voiceover" | "visual" | "look" | "onScreen" | "imagePrompt"
      >
    | null
    | undefined,
  names: string[],
): string[] {
  if (!shot) return [];
  const roster = [
    ...new Set(
      names
        .map((name) => name.trim())
        .filter((name) => name && name !== "旁白")
        .sort((a, b) => b.length - a.length),
    ),
  ];
  const blob = [
    shot.speaker,
    shot.voiceover,
    shot.visual,
    shot.look,
    shot.onScreen,
    shot.imagePrompt,
  ]
    .filter(Boolean)
    .join("\n");
  const found: string[] = [];
  const speaker = String(shot.speaker || "").trim();
  if (speaker && speaker !== "旁白" && roster.includes(speaker)) found.push(speaker);
  for (const name of roster) {
    if (blob.includes(name) && !found.includes(name)) found.push(name);
  }
  return found;
}

/**
 * 参考图怎么占名额：这一镜新出场的人/道具优先；
 * 有尾帧/定场时先留 1 个名额给它，避免三人同框把衔接图挤掉。
 * 上一镜已经有的人稍后补设定图。名额按出图模型来（Gemini 4 / Seedream 10）。
 */
export function planSceneRefs(input: {
  shot: VideoShot;
  anchor?: VideoShot | null;
  names: string[];
  props?: ScriptProp[];
  leadUrls?: string[];
  maxRefs?: number;
  /** 结尾帧：先放角色/道具，衔接图往后排，避免 Seedream 把开头图原样抄成结尾。 */
  leadAfterCast?: boolean;
}): SceneRefPlanItem[] {
  const maxRefs = Math.max(1, Math.round(input.maxRefs ?? MAX_SCENE_REFS));
  const names = [...new Set(input.names.map((name) => name.trim()).filter(Boolean))];
  const here = peopleOnShot(input.shot, names);
  const there = peopleOnShot(input.anchor, names);
  const visible = here.length ? here : names;
  const missing = visible.filter((name) => !there.includes(name));
  const seen = visible.filter((name) => there.includes(name));
  const catalog = input.props || [];
  const propsHere = catalog.filter(
    (prop) => prop.url?.trim() && shotMentionsProp(input.shot, prop),
  );
  const propsThere = input.anchor
    ? catalog.filter(
        (prop) => prop.url?.trim() && shotMentionsProp(input.anchor as VideoShot, prop),
      )
    : [];
  const isOldProp = (prop: ScriptProp) =>
    propsThere.some((row) => samePropName(row.name, prop.name));
  const newProps = propsHere.filter((prop) => !isOldProp(prop));
  const oldProps = propsHere.filter(isOldProp);
  const leads = uniqueUrls(input.leadUrls || []);
  const reserveLead = leads[0] ? 1 : 0;
  const plan: SceneRefPlanItem[] = [];
  const push = (item: SceneRefPlanItem, cap = maxRefs) => {
    if (plan.length >= cap) return;
    if (item.kind === "scene" && plan.some((row) => row.kind === "scene" && row.url === item.url)) {
      return;
    }
    if (
      item.kind === "character" &&
      plan.some((row) => row.kind === "character" && row.name === item.name)
    ) {
      return;
    }
    if (
      item.kind === "prop" &&
      plan.some((row) => row.kind === "prop" && samePropName(row.name, item.name))
    ) {
      return;
    }
    plan.push(item);
  };
  const beforeLead = maxRefs - reserveLead;
  if (input.leadAfterCast) {
    // 结尾先钉定装帧，再放角色设定图。设定图常是衬衫，排在前面会把西装换掉。
    if (leads[0]) push({ kind: "scene", url: leads[0] });
    for (const name of missing) push({ kind: "character", name });
    for (const name of seen) push({ kind: "character", name });
    for (const prop of newProps) {
      push({ kind: "prop", name: prop.name, look: prop.look });
    }
    for (const prop of oldProps) {
      push({ kind: "prop", name: prop.name, look: prop.look });
    }
    for (const url of leads.slice(1)) push({ kind: "scene", url });
    return plan;
  }
  for (const name of missing) push({ kind: "character", name }, beforeLead);
  for (const prop of newProps) push({ kind: "prop", name: prop.name, look: prop.look }, beforeLead);
  if (leads[0]) push({ kind: "scene", url: leads[0] });
  for (const name of seen) push({ kind: "character", name });
  for (const prop of oldProps) push({ kind: "prop", name: prop.name, look: prop.look });
  for (const url of leads.slice(1)) push({ kind: "scene", url });
  return plan;
}

/** 这一镜要钉的参考图：入画人 + 入画道具 + 1 张衔接帧（尾帧或定场）。 */
export function shotRefLoad(input: {
  shot: Pick<
    VideoShot,
    "speaker" | "voiceover" | "visual" | "look" | "onScreen" | "imagePrompt" | "props"
  >;
  names: string[];
}): { people: number; props: number; lock: number; total: number } {
  const people = peopleOnShot(input.shot, input.names).length;
  const props = [...new Set((input.shot.props || []).map((name) => name.trim()).filter(Boolean))]
    .length;
  const lock = 1;
  return { people, props, lock, total: people + props + lock };
}

/** 单镜点出图/重出图：按指定参考镜（默认下一镜）。批量出头尾：向前接上一镜。 */
export function sceneRefLook(onlyIndexes?: number[] | null): SceneRefLook {
  return onlyIndexes && onlyIndexes.length > 0 ? "backward" : "forward";
}

function uniqueUrls(urls: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = raw?.trim() || "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function sceneImageLeads(input: {
  phase: "start" | "end";
  refLook: SceneRefLook;
  prevTail?: string;
  startUrl?: string;
  endUrl?: string;
  nextHead?: string;
  refStart?: string;
  refEnd?: string;
  nextCutsAway?: boolean;
  join?: ShotJoin;
}): { urls: string[]; anchor: "prev" | "next" | "self" | "none" } {
  const prevTail = input.prevTail?.trim() || "";
  const startUrl = input.startUrl?.trim() || "";
  const endUrl = input.endUrl?.trim() || "";
  const refStart =
    input.refStart?.trim() ||
    (input.refLook === "backward" ? input.nextHead?.trim() || "" : "");
  const refEnd = input.refEnd?.trim() || "";
  const hasRef = Boolean(refStart || refEnd);
  if (hasRef) {
    if (input.phase === "end") {
      return {
        urls: uniqueUrls(
          input.nextCutsAway
            ? [startUrl, refStart, refEnd]
            : [startUrl, refStart, refEnd],
        ),
        anchor: startUrl ? "self" : "next",
      };
    }
    if (input.join === "cut" || input.nextCutsAway) {
      return {
        urls: uniqueUrls([endUrl, refStart, refEnd]),
        anchor: endUrl ? "self" : "next",
      };
    }
    return {
      urls: uniqueUrls([prevTail, endUrl, refStart, refEnd]),
      anchor: prevTail || endUrl ? "prev" : "next",
    };
  }
  if (input.phase === "end") {
    return {
      urls: uniqueUrls([startUrl]),
      anchor: startUrl ? "self" : "none",
    };
  }
  if (input.join === "cut") {
    return {
      urls: uniqueUrls([startUrl]),
      anchor: startUrl ? "self" : "none",
    };
  }
  return {
    urls: uniqueUrls([prevTail]),
    anchor: prevTail ? "prev" : "none",
  };
}

type AngleId = "front" | "three_quarter" | "side";

function preferAngleId(shot: VideoShot): AngleId {
  const beat = normalizeShotBeat(shot.beat);
  const camera = String(shot.camera || "");
  const look = String(shot.look || "");
  if (shot.join === "away" || camera === "远景") return "front";
  if (
    beat === "顶" ||
    /对手|说话的人|过肩/.test(look) ||
    camera === "中景"
  ) {
    return "three_quarter";
  }
  return "front";
}

async function loadAngleMap(
  angles?: VideoCharacterAngle[],
): Promise<Partial<Record<AngleId, ImageInlineRef>>> {
  const map: Partial<Record<AngleId, ImageInlineRef>> = {};
  for (const id of ["front", "three_quarter", "side"] as AngleId[]) {
    const row = angles?.find((item) => item.id === id && item.url);
    if (!row?.url) continue;
    const ref = await loadImageRef(row.url);
    if (ref) map[id] = ref;
  }
  if (!map.front) {
    const any = angles?.find((item) => item.url);
    if (any?.url) {
      const ref = await loadImageRef(any.url);
      if (ref) map.front = ref;
    }
  }
  return map;
}

function pickCharacterRef(
  map: Partial<Record<AngleId, ImageInlineRef>> | undefined,
  prefer: AngleId,
): ImageInlineRef | undefined {
  if (!map) return undefined;
  return map[prefer] || map.front || map.three_quarter || map.side;
}

export type SceneGenProgress = {
  index: number;
  total: number;
  done: number;
  message: string;
  shot?: VideoShot;
};

async function makeKeyframe(input: {
  phase: "start" | "end";
  shot: VideoShot;
  prev?: VideoShot;
  next?: VideoShot;
  anchor?: VideoShot;
  who: string;
  names: string[];
  cast: SceneCastPerson[];
  refsByName: Map<string, Partial<Record<AngleId, ImageInlineRef>>>;
  wardrobeLock: string;
  director?: ShotAgentLock | null;
  seriesAnchorUrl?: string;
  startUrl?: string;
  endUrl?: string;
  prevTail?: string;
  nextHead?: string;
  refStart?: string;
  refEnd?: string;
  refShotNo?: number;
  nextCutsAway?: boolean;
  refLook: SceneRefLook;
  cutsAway: boolean;
  join?: ShotJoin;
  imageModel?: string;
  lookStyle?: string | null;
  props?: ScriptProp[];
}): Promise<string> {
  const leads = sceneImageLeads({
    phase: input.phase,
    refLook: input.refLook,
    prevTail: input.prevTail,
    startUrl: input.startUrl,
    endUrl: input.endUrl,
    nextHead: input.nextHead,
    refStart: input.refStart,
    refEnd: input.refEnd,
    nextCutsAway: input.nextCutsAway,
    join: input.join,
  });
  const maxRefs = maxSceneRefsForModel(input.imageModel);
  const plan = planSceneRefs({
    shot: input.shot,
    anchor: input.anchor,
    names: input.names,
    props: input.props,
    leadUrls: uniqueUrls([input.seriesAnchorUrl, ...leads.urls]),
    maxRefs,
    leadAfterCast: input.phase === "end",
  });
  const sceneRefs: ImageInlineRef[] = [];
  const castRefs: SceneCastRef[] = [];
  const propPrompt: Array<{ name: string; look?: string; refIndex?: number }> = [];
  for (const item of plan) {
    if (sceneRefs.length >= maxRefs) break;
    if (item.kind === "character") {
      const ref = pickCharacterRef(
        input.refsByName.get(item.name),
        preferAngleId(input.shot),
      );
      if (!ref) continue;
      sceneRefs.push(ref);
      castRefs.push({ name: item.name, refIndex: sceneRefs.length });
      continue;
    }
    if (item.kind === "prop") {
      const prop = (input.props || []).find((row) => samePropName(row.name, item.name));
      const ref = prop?.url ? await loadImageRef(prop.url) : null;
      if (!ref) {
        propPrompt.push({ name: item.name, look: item.look });
        continue;
      }
      sceneRefs.push(ref);
      propPrompt.push({
        name: item.name,
        look: item.look,
        refIndex: sceneRefs.length,
      });
      continue;
    }
    const ref = await loadImageRef(item.url);
    if (ref) sceneRefs.push(ref);
  }
  const mentioned = propsForShot(input.shot, input.props || []);
  for (const prop of mentioned) {
    if (propPrompt.some((row) => samePropName(row.name, prop.name))) continue;
    propPrompt.push({ name: prop.name, look: prop.look });
  }
  const prompt = manhuaScenePrompt({
    who: input.who
      ? input.names.map((n) => `「${n}」`).join("、")
      : "",
    cast: input.cast,
    castRefs,
    visual: input.shot.visual,
    imagePrompt: input.shot.imagePrompt,
    voiceover: input.shot.voiceover,
    prevVisual: input.prev?.visual,
    nextVisual: input.next?.visual,
    wardrobeLock: input.wardrobeLock,
    hasPrevScene: Boolean(input.prevTail || input.startUrl),
    hasNextScene: Boolean(input.refStart || input.refEnd || input.nextHead),
    hasRefScene: Boolean(input.refStart || input.refEnd || input.nextHead),
    nextCutsAway: input.nextCutsAway,
    refLook: input.refLook,
    refShotNo: input.refShotNo,
    phase: input.phase,
    cutsAway: input.cutsAway,
    join: input.join,
    beat: input.shot.beat,
    look: input.shot.look,
    inner: shotIsInner(input.shot),
    speakFromStart: shotSpeaksFromStart(input.shot),
    director: input.director,
    lookStyle: input.lookStyle,
    plate: input.shot.plate,
    camera: input.shot.camera,
    props: propPrompt,
    seconds: input.shot.seconds,
  });
  const { url } = await generateImageWithChat(prompt, {
    aspectRatio: "9:16",
    references: sceneRefs.length ? sceneRefs.slice(0, maxRefs) : undefined,
    model: input.imageModel,
  });
  return url;
}

export async function generateEpisodeScenes(input: {
  shots: VideoShot[];
  characterName?: string;
  photos?: VideoCharacterPhoto[];
  angles?: VideoCharacterAngle[];
  characters?: Array<{
    name?: string;
    look?: string;
    gender?: string;
    voiceId?: string;
    photos?: VideoCharacterPhoto[];
    angles?: VideoCharacterAngle[];
  }>;
  force?: boolean;
  onlyIndexes?: number[];
  refShotIndex?: number;
  imageModel?: string;
  lookStyle?: string | null;
  props?: ScriptProp[];
  director?: ShotAgentLock | null;
  wardrobe?: SeriesWardrobeLock | null;
  seriesAnchorUrl?: string;
  speakMode?: VideoSpeakMode | string;
  narratorVoiceId?: string;
  castVoices?: Array<{ id: string; name: string; voice_id?: string }>;
  maxSec?: number;
  /** 一次请求最多新出几镜（头+尾）。Worker 上默认 1，避免超时后整集回滚。 */
  maxNewShots?: number;
  /** 只补缺的头/尾，不重出已经有的那一端。 */
  fillMissing?: boolean;
  onProgress?: (event: SceneGenProgress) => void | Promise<void>;
}): Promise<VideoShot[]> {
  let shots = [...input.shots].sort((a, b) => a.index - b.index);
  if (shots.length === 0) {
    throw new Error("这集还没有分镜，先写出剧本");
  }
  const only = (input.onlyIndexes || [])
    .map((n) => Math.round(Number(n)))
    .filter((n) => Number.isFinite(n) && n > 0);
  const targets = only.length > 0 ? new Set(only) : null;
  if (targets) {
    const missing = [...targets].filter(
      (index) => !shots.some((shot) => shot.index === index),
    );
    if (missing.length > 0) {
      throw new Error(`没有第 ${missing.join("、")} 镜，无法重出`);
    }
  }
  const maxNewShots =
    Number.isFinite(input.maxNewShots) && (input.maxNewShots || 0) > 0
      ? Math.round(input.maxNewShots as number)
      : Number.POSITIVE_INFINITY;
  const needsWorkEarly = (shot: VideoShot) =>
    targets ? targets.has(shot.index) : input.force || !shotHasKeyframes(shot);
  const lockCap = Number.isFinite(maxNewShots) ? maxNewShots : shots.length;
  const lockTargets = shots.filter(needsWorkEarly).slice(0, Math.max(1, lockCap));
  if (lockTargets.some((shot) => !shot.speechUrl?.trim())) {
    await input.onProgress?.({
      index: lockTargets[0]?.index || 0,
      total: lockTargets.length,
      done: 0,
      message: "先按对白出声，用真实时长出图…",
    });
    const locked = await lockEpisodeSpeechTiming({
      shots: lockTargets,
      speakMode: input.speakMode,
      narratorVoiceId: input.narratorVoiceId,
      cast: input.castVoices,
      maxSec: input.maxSec,
      onProgress: async (message, shot) => {
        await input.onProgress?.({
          index: shot?.index || 0,
          total: lockTargets.length,
          done: 0,
          message,
          shot,
        });
      },
    });
    const byIndex = new Map(locked.map((shot) => [shot.index, shot]));
    shots = shots.map((shot) => byIndex.get(shot.index) || shot);
  }
  const lockedIndexes = new Set(lockTargets.map((shot) => shot.index));
  const missingSpeech = shots
    .filter((shot) => lockedIndexes.has(shot.index))
    .filter((shot) => shotNeedsLockedSpeech(shot) && !shot.speechUrl?.trim())
    .map((shot) => shot.index);
  if (missingSpeech.length > 0) {
    throw new Error(
      `第 ${missingSpeech.join("、")} 镜锁声失败，先按对白出声再出分镜`,
    );
  }
  const people =
    input.characters && input.characters.length > 0
      ? input.characters
      : [
          {
            name: input.characterName,
            photos: input.photos,
            angles: input.angles,
          },
        ];
  const refsByName = new Map<string, Partial<Record<AngleId, ImageInlineRef>>>();
  const cast: SceneCastPerson[] = [];
  for (const person of people) {
    const name = person.name?.trim();
    if (!name) continue;
    const inferred = inferCharacterGender({
      name,
      look: person.look,
      gender: person.gender,
    });
    const fromVoice = voiceGender(person.voiceId);
    const gender: SceneCastPerson["gender"] =
      inferred === "male" || fromVoice === "male"
        ? "男"
        : inferred === "female"
          ? "女"
          : "";
    cast.push({
      name,
      gender,
      look: person.look,
    });
    if (refsByName.has(name)) continue;
    refsByName.set(name, await loadAngleMap(person.angles));
  }
  const names = cast.map((row) => row.name);
  const who = names.join("、");
  const wardrobeLock = [
    inferEpisodeWardrobeLock(shots),
    seriesWardrobeLine(input.wardrobe),
  ]
    .filter(Boolean)
    .join("");
  const needsWork = (shot: VideoShot) =>
    targets ? targets.has(shot.index) : input.force || !shotHasKeyframes(shot);
  const pending = shots.filter(needsWork);
  const total = pending.length || shots.length;
  const out: VideoShot[] = [];
  let done = 0;
  let framesThisPass = 0;
  let startedShots = 0;
  let lastErr = "";
  const startedAt = Date.now();
  const budgetMs = 105_000;
  const fillMissing = input.fillMissing === true;
  const redoExisting = Boolean(targets) && !fillMissing;

  const tick = async (
    shot: VideoShot,
    message: string,
    extra?: Partial<SceneGenProgress>,
  ) => {
    await input.onProgress?.({
      index: shot.index,
      total,
      done,
      message,
      ...extra,
    });
  };

  const refLook = sceneRefLook(only);
  const explicitRef = Math.round(Number(input.refShotIndex));

  for (const shot of shots) {
    const prev =
      out.find((row) => row.index === shot.index - 1) ||
      shots.find((row) => row.index === shot.index - 1);
    const next = shots.find((row) => row.index === shot.index + 1);
    const join = inferShotJoin(shot, prev);
    const cutsAway = join === "away" || sceneCutsAway(shot);
    const prevTail = shotTailUrl(prev);
    const refIndex =
      refLook === "backward"
        ? Number.isFinite(explicitRef) &&
          explicitRef > 0 &&
          explicitRef !== shot.index
          ? explicitRef
          : defaultRefShotIndex(shots, shot.index)
        : undefined;
    const refShot =
      refIndex && refIndex !== shot.index
        ? shots.find((row) => row.index === refIndex)
        : undefined;
    const refStart = shotStartUrl(refShot);
    const refEnd = shotEndUrl(refShot);
    const lookBack = Boolean(refShot && (refStart || refEnd));
    const refIsLater = Boolean(refShot && refShot.index > shot.index);
    const nextCutsAway = sceneCutsAway(refShot || next);
    const reuseStart = Boolean(
      prevTail && !refIsLater && shouldReusePrevStart(shot, prev),
    );
    const redo = needsWork(shot);
    let startUrl = shotStartUrl(shot);
    let endUrl = shotEndUrl(shot);
    let changed = false;
    const makeShotFrame = async (phase: "start" | "end") => {
      const label = phase === "start" ? "开头" : "结尾";
      await tick(
        shot,
        lookBack && refShot
          ? `第 ${shot.index} 镜参考第 ${refShot.index} 镜，重出${label}…`
          : targets
            ? `第 ${shot.index} 镜${label}重出中…`
            : `第 ${shot.index} 镜${label}生成中（${done + 1}/${total}）…`,
      );
      const heartbeat = setInterval(() => {
        void tick(
          shot,
          `第 ${shot.index} 镜${label}还在出图，等这张回来…`,
        ).catch(() => undefined);
      }, 3000);
      try {
        return await makeKeyframe({
          phase,
          shot,
          prev,
          next,
          anchor: refShot || prev,
          who,
          names,
          cast,
          refsByName,
          wardrobeLock,
          startUrl,
          endUrl,
          prevTail,
          nextHead: refStart,
          refStart,
          refEnd,
          refShotNo: refShot?.index,
          nextCutsAway,
          refLook: refIsLater ? "backward" : "forward",
          cutsAway,
          join,
          imageModel: input.imageModel,
          lookStyle: input.lookStyle,
          props: input.props,
          director: input.director,
          seriesAnchorUrl:
            shot.index === 1 ? input.seriesAnchorUrl : undefined,
        });
      } finally {
        clearInterval(heartbeat);
      }
    };

    if (reuseStart) {
      if (startUrl !== prevTail) {
        startUrl = prevTail;
        changed = true;
      }
    }
    const overBudget = Date.now() - startedAt > budgetMs && framesThisPass > 0;
    const quotaFull = startedShots >= maxNewShots;
    if (redo && (quotaFull || overBudget)) {
      // 额度用完就静默留下，下一枪再出。不要把进度条推到还没出的镜。
      out.push({
        ...shot,
        join,
        startUrl,
        endUrl,
        sceneUrl: startUrl || shot.sceneUrl,
      });
      continue;
    }
    const genStart =
      !reuseStart && redo && (!startUrl || input.force || redoExisting);
    const genEnd = redo && (!endUrl || input.force || redoExisting);
    if (genStart || genEnd) startedShots += 1;

    const snapshot = (): VideoShot => {
      const nextShot: VideoShot = {
        ...shot,
        join,
        startUrl,
        endUrl,
        sceneUrl: startUrl || shot.sceneUrl,
      };
      if (changed) {
        delete nextShot.clipUrl;
        delete nextShot.rawClipUrl;
        delete nextShot.lastFrameUrl;
        delete nextShot.clipAltUrl;
        delete nextShot.framesOk;
      }
      return nextShot;
    };

    const saveFrame = async (phase: "start" | "end") => {
      const url = await makeShotFrame(phase);
      if (phase === "start") startUrl = url;
      else endUrl = url;
      changed = true;
      framesThisPass += 1;
      await tick(
        shot,
        phase === "start"
          ? `第 ${shot.index} 镜开头已落下`
          : `第 ${shot.index} 镜结尾已落下`,
        { shot: snapshot() },
      );
    };

    try {
      if (lookBack && refIsLater && (genStart || genEnd)) {
        if (genEnd) await saveFrame("end");
        if (genStart) await saveFrame("start");
      } else {
        if (genStart) await saveFrame("start");
        if (genEnd) await saveFrame("end");
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : "出图失败";
      await tick(shot, `第 ${shot.index} 镜出图没落下：${lastErr.slice(0, 80)}`, {
        shot: changed ? snapshot() : undefined,
      });
      if (!changed && (genStart || genEnd)) {
        throw err instanceof Error ? err : new Error(lastErr);
      }
    }

    const nextShot = snapshot();
    out.push(nextShot);
    if (redo && shotHasKeyframes(nextShot)) {
      done += 1;
      await tick(
        shot,
        lookBack && refShot
          ? `第 ${shot.index} 镜已按第 ${refShot.index} 镜重出`
          : targets
            ? `第 ${shot.index} 镜头尾已就绪`
            : `第 ${shot.index} 镜头尾已就绪（${done}/${total}）`,
        { shot: nextShot, done },
      );
    } else if (changed) {
      await tick(shot, `第 ${shot.index} 镜已落下部分头尾，下次接着出`, {
        shot: nextShot,
      });
    }
  }
  if (pending.length > 0 && framesThisPass === 0 && lastErr) {
    throw new Error(lastErr);
  }
  return out;
}
