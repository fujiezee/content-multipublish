import { emotionFaceLine } from "@/lib/ai/emotion-beat";
import {
  extractClothesPhrase,
  type ShotAgentLock,
} from "@/lib/ai/director-lock";
import { resolveLookStyle } from "@/lib/ai/look-styles";
import { negativeShotLines, positiveShotLines } from "@/lib/ai/shot-constraints";
import {
  normalizeShotJoin,
  type ShotJoin,
  type VideoShot,
} from "@/lib/types";

export const MANHUA_STYLE = resolveLookStyle("semi").still;

export const MANHUA_NO_MARK = "无水印、无文字、无 logo、无网址、无字幕。";

/** 出图前清掉真人照片和卡通词。合集画风自己的词要留。 */
export function stripPhotoLook(text: string, lookStyle?: string | null): string {
  const look = resolveLookStyle(lookStyle);
  let next = text
    .replace(/超写实|照片级|真人实拍|实拍人脸|实拍风格/g, look.stillAlias)
    .replace(/\bphotoreal(?:istic)?\b/gi, "")
    .replace(/赛璐璐|二次元|卡通变形|卡通风|动画片|平涂卡通/g, look.stillAlias)
    .replace(/皮肤毛孔|皮肤纹理|相机噪点|证件照|手机自拍/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (look.id === "semi") {
    next = next
      .replace(/写实风格|写实风|偏写实|电影静帧|电影感|像拍戏|现场光/g, "半写实插画")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  if (look.id === "dark") {
    next = next
      .replace(/写实风格|写实风|偏写实|电影静帧|电影感|像拍戏|大白天/g, "暗黑厚涂")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return next;
}

export function manhuaCharacterPrompt(input: {
  who: string;
  look?: string;
  view: string;
  phase: "from-photo" | "from-lock" | "from-text";
  lookStyle?: string | null;
}): string {
  const who = input.who.trim() || "这个人";
  const look = input.look?.trim() || "";
  const style = resolveLookStyle(input.lookStyle);
  const head =
    input.phase === "from-photo"
      ? `根据参考照片转绘同一个${style.roleWord}，${input.view}。脸要清楚、能认出来就是这个人。眼镜、胡子、发型、衣服、围巾必须留下，不要换脸、不要换装。照片只用来认人，画成戏里的角色，不要实拍，也不要证件照。`
      : input.phase === "from-lock"
        ? `根据角色设定图生成同一个人，${input.view}。必须和参考图是同一个人，衣服发型不能换，质感跟参考图走。`
        : `根据文字设定画一个${style.roleWord}，${input.view}。`;
  return [
    head,
    `角色叫「${who}」。`,
    look ? `外形：${look}` : "",
    style.still,
    "竖版 3:4，干净浅底。表情自然，不要僵硬站桩。",
    MANHUA_NO_MARK,
    "只出一张图。",
  ]
    .filter(Boolean)
    .join("\n");
}

const STAND_MARK = /站起|站着|起身|立着|撑桌站|已经站/;
const SIT_MARK = /坐着|坐下|坐在|坐回|坐下来/;
const WALK_MARK = /走[到向过开]|走向|走开|走过来|迈步/;
const SIT_DOWN_MARK = /坐下|坐回|坐下来/;

export function inferStance(text: string): "stand" | "sit" | "walk" | "unknown" {
  const t = String(text || "");
  if (WALK_MARK.test(t)) return "walk";
  if (STAND_MARK.test(t)) return "stand";
  if (SIT_MARK.test(t)) return "sit";
  return "unknown";
}

const ACTION_MARK =
  /拍桌|摔门|甩|撕|跪|起身|站起|走近|走开|走过来|迈步|扑|按住|砸|扔|抽出/;

/** 画面里用 → 拆开头/结束。给头尾静帧各用半句，避免两张画成同一姿势。 */
export function splitShotBeats(visual: string): { start: string; end: string } {
  const t = stripPhotoLook(visual || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return { start: "", end: "" };
  const arrow = t.split(/\s*(?:→|—>|-->|⇒)\s*/);
  if (arrow.length >= 2 && arrow[0]?.trim() && arrow[1]?.trim()) {
    return { start: arrow[0].trim(), end: arrow.slice(1).join(" ").trim() };
  }
  const pair = t.match(
    /^(?:开头[:：]?\s*)(.+?)(?:[，。；]\s*)?(?:结束|结尾|收在|停在)[:：]?\s*(.+)$/,
  );
  if (pair?.[1] && pair[2]) {
    return { start: pair[1].trim(), end: pair[2].trim() };
  }
  return { start: t, end: "" };
}

/** 口播坐着讲、镜头固定、画面没写走动打斗，才允许同机位。仍要嘴/眼/手和开头不一样。 */
export function stillTalkingHead(
  shot?: Pick<
    VideoShot,
    "camera" | "visual" | "beat" | "join" | "plate" | "look"
  > | null,
): boolean {
  if (!shot) return false;
  if (shot.join === "away" || shot.beat === "打") return false;
  const move = inferShotCamera(shot.visual, shot.camera);
  if (move === "推镜" || move === "拉镜" || move === "横移") return false;
  const visual = String(shot.visual || "");
  if (WALK_MARK.test(visual) || ACTION_MARK.test(visual)) return false;
  const beats = splitShotBeats(visual);
  const startPose = inferStance(beats.start || visual);
  const endPose = inferStance(beats.end);
  if (
    beats.end &&
    startPose !== "unknown" &&
    endPose !== "unknown" &&
    startPose !== endPose
  ) {
    return false;
  }
  const talking = /已在说|正在说|口播|对着镜头说/.test(
    `${visual} ${shot.plate?.motion || ""}`,
  );
  const seated = startPose === "sit" || /坐/.test(visual);
  return talking && seated && (move === "固定" || move === "近景" || move === "特写");
}

function endEvolveLine(input: {
  visual?: string;
  seconds?: number;
  camera?: string;
  stillTalk?: boolean;
}): string {
  const sec = Math.max(4, Math.round(Number(input.seconds) || 0) || 8);
  const move = inferShotCamera("", input.camera) || inferShotCamera(input.visual, "");
  if (move === "推镜") {
    return `这一镜演了约 ${sec} 秒。结束帧必须明显比开头更近，脸或手占画更大，禁止还停在开头那个景别。`;
  }
  if (move === "拉镜") {
    return `这一镜演了约 ${sec} 秒。结束帧必须明显比开头更远，禁止还停在开头那个景别。`;
  }
  if (move === "横移") {
    return `这一镜演了约 ${sec} 秒。结束帧机位必须已经横移过，构图不能和开头同一块。`;
  }
  if (input.stillTalk) {
    return `口播坐着讲可以同机位，但结束帧嘴形、眼神或手势必须和开头不一样。禁止复制开头那一张。`;
  }
  return `这一镜演了约 ${sec} 秒。结束帧必须一眼能看出时间过了：站坐、手、朝向或景别至少改一处。禁止和开头几乎同一张。`;
}

export function sceneBlockingLines(input: {
  prevVisual?: string;
  visual?: string;
  nextVisual?: string;
  phase?: "start" | "end";
  seconds?: number;
  camera?: string;
  stillTalk?: boolean;
}): string[] {
  const prev = stripPhotoLook(input.prevVisual || "");
  const visual = stripPhotoLook(input.visual || "");
  const next = stripPhotoLook(input.nextVisual || "");
  const beats = splitShotBeats(visual);
  const prevPose = inferStance(prev);
  const herePose = inferStance(beats.start || visual);
  const nextPose = inferStance(next);
  const lines: string[] = [];
  if (input.phase === "end") {
    if (beats.start) {
      lines.push(
        `这一镜开头是：${beats.start}。结束帧禁止还停在这个姿势和构图。`,
      );
    }
    if (beats.end && beats.end !== beats.start) {
      lines.push(`这一镜结束必须演到：${beats.end}。`);
    } else {
      lines.push(endEvolveLine(input));
    }
    if (next) {
      lines.push(
        `下一镜将是：${next}。这一镜结束要能接到那里，但本张仍是本镜结束，不要提前切到下一镜，也不要和本镜开头一样。`,
      );
    }
    if (
      nextPose === "walk" &&
      herePose === "sit" &&
      !STAND_MARK.test(beats.end || visual) &&
      !WALK_MARK.test(beats.end || visual)
    ) {
      lines.push(
        "下一镜人要走动。这一镜结束时应已起身或迈出一步，不要还坐死在椅子上。",
      );
    }
    return lines;
  }
  if (prev) {
    lines.push(
      `上一镜结束时：${prev}。这一镜开头的站坐、位置、朝向、手里的东西必须接着上一镜的结束状态，只往前演，不要重置回开场。`,
    );
  }
  if (
    (prevPose === "stand" || prevPose === "walk") &&
    herePose === "sit" &&
    !SIT_DOWN_MARK.test(beats.start || visual)
  ) {
    lines.push(
      "上一镜人已经站着或在走。这一镜必须画成站着，禁止无故画回坐在椅子上。",
    );
  }
  if (
    prevPose === "sit" &&
    herePose === "stand" &&
    !STAND_MARK.test(beats.start || visual)
  ) {
    lines.push("上一镜还坐着，这一镜若要站着，画面里必须能看出起身，不要瞬移站好。");
  }
  if (beats.start && beats.end && input.phase === "start") {
    lines.push(`这一镜开头画：${beats.start}。不要提前画到结束状态。`);
  }
  if (next) {
    lines.push(
      `下一镜将是：${next}。这一镜的结束状态要能接着演到下一镜，给下一镜留出演变，不要和下一镜打架。`,
    );
  }
  if (
    nextPose === "walk" &&
    herePose === "sit" &&
    !STAND_MARK.test(visual) &&
    !WALK_MARK.test(visual)
  ) {
    lines.push(
      "下一镜人要走动。这一镜结束时应已起身或迈出一步，不要还坐死在椅子上。",
    );
  }
  return lines;
}

const ANCIENT_MARK =
  /古代|古装|长衫|长袍|朝服|官服|汉服|穿越|朝廷|府衙|殿上|皇上|束发|发髻|锦袍|布衣|绣裙|马褂|襦裙/;
const MODERN_MARK =
  /西装|衬衫|T恤|卫衣|牛仔裤|短袖|西装裤|办公室|电脑|手机|运动鞋|高跟鞋/;

/** 角色外形里的衣服会把后镜画回设定图衬衫。出图只认脸、发型、体型。 */
export function stripLookClothes(look: string): string {
  return String(look || "")
    .replace(/定装[:：][^，。]*/g, "")
    .replace(/穿(?:着)?[^，。]{1,24}/g, "")
    .replace(
      /(?:深色|黑色|白色|灰色|深蓝|藏青)?(?:西装套装|西装|西服|外套|大衣|夹克|衬衫|衬衣|T恤|卫衣|便装|正装|长衫|长袍|朝服|官服|汉服|旗袍)/g,
      "",
    )
    .replace(/[，、]{2,}/g, "，")
    .replace(/^[\s，、]+|[\s，、]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function inferEpisodeWardrobeLock(
  shots: Array<{ visual?: string; imagePrompt?: string }>,
): string {
  const first = shots[0];
  const clothes = extractClothesPhrase(
    `${first?.visual || ""} ${first?.imagePrompt || ""}`,
  );
  const text = shots
    .map((shot) => `${shot.visual || ""} ${shot.imagePrompt || ""}`)
    .join("\n");
  const ancient = ANCIENT_MARK.test(text);
  const modern = MODERN_MARK.test(text);
  const clothesLine = clothes
    ? [
        `本集定装是「${clothes}」。后面每一镜必须原样穿这套，禁止换装、换发型。`,
        /西装|西服|外套|大衣|夹克|正装/.test(clothes)
          ? "禁止改成衬衫、解开外套只剩衬衫。角色设定图只认脸，设定图里若是衬衫或便装，不要画进这一镜。"
          : "角色设定图只认脸，不要把设定图里另一套衣服画回来。",
      ].join("")
    : "";
  if (ancient && modern) {
    return [
      "本集有古今对照。每个人只准穿一套：第一镜定装后整集照穿。今人不要中途改成古装，古人不要中途改成西装。",
      clothesLine || "同一个人禁止这一镜长衫、下一镜衬衫。",
    ]
      .filter(Boolean)
      .join("");
  }
  if (ancient) {
    return [
      "本集是古代场。第一镜定装后，所有人整集穿同一套古装、同一发型。角色设定图若是现代便装，只认脸，不要把现代衣服画回来，也不要每镜换一套袍子。",
      clothesLine,
    ]
      .filter(Boolean)
      .join("");
  }
  if (modern) {
    return [
      clothesLine ||
        "本集是现代场。第一镜定装后整集同一套现代衣服。禁止中途换成衬衫或古装长衫。",
      clothes ? "" : "角色设定图只认脸，不要把设定图里另一套衣服画回来。",
    ]
      .filter(Boolean)
      .join("");
  }
  return (
    clothesLine ||
    "第一镜定装：衣服、发型、配饰整集锁定。后面各镜只改动作表情机位，禁止换装。"
  );
}

const SCENE_CUT_MARK =
  /换场|从\S{1,12}到\S{0,12}(?:门外|屋|房|厅|场|街|院|廊)|另一[间场屋]|走进|走出|到了另一/;
const CAMERA_CUT_MARK = /反应镜|硬切|切镜|切到(?!另一|门外|屋|房|厅|场)/;

export function sceneCutsAway(shot?: {
  visual?: string;
  imagePrompt?: string;
} | null): boolean {
  if (!shot) return false;
  return SCENE_CUT_MARK.test(`${shot.visual || ""} ${shot.imagePrompt || ""}`);
}

export function inferShotJoin(
  shot?: Pick<VideoShot, "join" | "visual" | "imagePrompt" | "camera" | "beat" | "look"> | null,
  prev?: Pick<VideoShot, "look" | "camera" | "beat"> | null,
): ShotJoin {
  const stored = normalizeShotJoin(shot?.join);
  if (stored) return stored;
  if (sceneCutsAway(shot)) return "away";
  if (inferShotCamera(shot?.visual, shot?.camera) === "切镜") return "cut";
  const beat = String(shot?.beat || "");
  if (beat === "停" || beat === "钩" || beat === "打") return "cut";
  const look = String(shot?.look || "").trim();
  const prevLook = String(prev?.look || "").trim();
  if (look && prevLook && look !== prevLook) return "cut";
  if (CAMERA_CUT_MARK.test(`${shot?.visual || ""} ${shot?.imagePrompt || ""}`)) {
    return "cut";
  }
  return "continue";
}

export function shouldReusePrevStart(
  shot?: Pick<VideoShot, "join" | "visual" | "imagePrompt" | "camera" | "beat" | "look"> | null,
  prev?: Pick<VideoShot, "look" | "camera" | "beat"> | null,
): boolean {
  return Boolean(prev) && inferShotJoin(shot, prev) === "continue";
}

export type SceneRefLook = "forward" | "backward";

export type SceneCastPerson = {
  name: string;
  gender?: "男" | "女" | "";
  look?: string;
};

export type SceneCastRef = { name: string; refIndex: number };

function refIndexForCast(
  name: string,
  index: number,
  refs: number | SceneCastRef[],
): number {
  if (typeof refs === "number") return index < refs ? index + 1 : 0;
  return refs.find((row) => row.name === name)?.refIndex || 0;
}

/** 职位名容易被画成女生。分镜里把人和性别写死。 */
export function sceneCastLines(
  cast: SceneCastPerson[],
  refs: number | SceneCastRef[] = 0,
): string[] {
  const people = cast
    .map((row) => ({
      name: row.name.trim(),
      gender: row.gender === "女" ? "女" : row.gender === "男" ? "男" : "",
      look: row.look?.replace(/\s+/g, " ").trim() || "",
    }))
    .filter((row) => row.name);
  if (!people.length) return [];
  const lines = people.map((person, i) => {
    const sex = person.gender
      ? `「${person.name}」是${person.gender}的，必须画成${person.gender}人，禁止画成${person.gender === "男" ? "女" : "男"}人。`
      : `「${person.name}」必须和设定图同一张脸、同一性别。这是职位/称呼，不是女孩名，不要擅自画成女生。`;
    const face = stripLookClothes(person.look || "");
    const look = face ? `外形：${face.slice(0, 160)}` : "";
    const refNo = refIndexForCast(person.name, i, refs);
    const ref = refNo
      ? `参考图${refNo}是「${person.name}」的正面设定，只认这张脸。提示词里写「参考图${refNo}」。`
      : "";
    return [sex, look, ref].filter(Boolean).join("");
  });
  lines.push("禁止换脸，禁止加新人，禁止把男人画成女人。");
  return lines;
}

export function manhuaScenePrompt(input: {
  who?: string;
  cast?: SceneCastPerson[];
  castRefCount?: number;
  castRefs?: SceneCastRef[];
  visual: string;
  imagePrompt?: string;
  voiceover?: string;
  prevVisual?: string;
  nextVisual?: string;
  wardrobeLock?: string;
  hasPrevScene?: boolean;
  hasNextScene?: boolean;
  hasRefScene?: boolean;
  nextCutsAway?: boolean;
  refLook?: SceneRefLook;
  refShotNo?: number;
  phase?: "start" | "end";
  cutsAway?: boolean;
  join?: ShotJoin | "";
  beat?: string;
  look?: string;
  inner?: boolean;
  speakFromStart?: boolean;
  director?: ShotAgentLock | null;
  lookStyle?: string | null;
  plate?: import("@/lib/types").ShotPlate;
  camera?: string;
  seconds?: number;
  props?: Array<{ name: string; look?: string; refIndex?: number }>;
}): string {
  const who = input.who?.trim() || "";
  const style = resolveLookStyle(input.lookStyle);
  const castLines = sceneCastLines(
    input.cast || [],
    input.castRefs?.length ? input.castRefs : input.castRefCount || 0,
  );
  const visual = stripPhotoLook(input.visual || "", input.lookStyle);
  const beats = splitShotBeats(visual);
  const stillTalk = stillTalkingHead({
    camera: input.camera,
    visual: input.visual,
    beat: input.beat,
    join: input.join,
    plate: input.plate,
    look: input.look,
  });
  const imagePrompt = stripPhotoLook(input.imagePrompt || "", input.lookStyle);
  const prevVisual = stripPhotoLook(input.prevVisual || "", input.lookStyle);
  const refLook = input.refLook || "forward";
  const refNo = Math.round(Number(input.refShotNo)) || 0;
  const hasRef = Boolean(input.hasRefScene || input.hasNextScene);
  const anchored = hasRef && refNo > 0;
  const lookBack = refLook === "backward" && hasRef;
  const locked = Boolean(input.hasPrevScene || prevVisual || lookBack || anchored);
  const phase = input.phase || "start";
  const blocking = sceneBlockingLines({
    prevVisual,
    visual,
    nextVisual: input.nextVisual,
    phase,
    seconds: input.seconds,
    camera: input.camera,
    stillTalk,
  });
  const refName = refNo > 0 ? `第 ${refNo} 镜` : "指定参考镜";
  const phaseLine = (() => {
    if (phase === "end") {
      const evolve = endEvolveLine({
        visual,
        seconds: input.seconds,
        camera: input.camera,
        stillTalk,
      });
      if (anchored || lookBack) {
        return input.nextCutsAway
          ? `这是这一镜的结束帧。参考图是${refName}已经定好的图，但那一镜已经换场：只认人、认已定装的衣服和画风。这一镜结束仍停在本场，不要画进那一场。${evolve}`
          : `这是这一镜的结束帧。参考图是${refName}已经定好的图。人、衣服、场和画风必须和那一镜一致。姿势和构图必须从本镜开头演过去，禁止和开头几乎同一张。${evolve}`;
      }
      return `这是这一镜演完之后的结束帧，不是开头的复制。人、衣服、场必须和开头参考图同一套。${evolve}下一镜会拿这张当开头，所以结束状态要停得住。`;
    }
    if (anchored || lookBack) {
      return input.cutsAway
        ? `这是换场开头。参考图是${refName}已经定好的图：认人、认衣服、认画风。这一张要画到新场的第一帧，不要还停在上一场，也不要照搬那一镜的场。`
        : `这是这一镜的开头帧。参考图是${refName}已经定好的图。人、衣服、场和画风必须和那一镜一致，只改这一镜的动作、表情、机位。`;
    }
    if (input.cutsAway || input.join === "away") {
      return "这是换场开头。参考图第一张是上一镜结尾：只认人、认已定装的衣服。这一张要画到新场的第一帧，人已经进入新场，不要还停在上一场。";
    }
    if (input.join === "cut") {
      return "这是硬切开头。同一场、同一套衣服、同一张脸，但构图必须换：换看的人，或换特写/近景。不要照搬上一镜结束的构图，不要接着上镜的站位往前挪半步。";
    }
    if (locked) {
      return "这是这一镜的开头帧。必须接上一镜结束状态：同一场、同一套已经定好的衣服、同一发型、同一光线、同一站坐朝向。";
    }
    return "这是本集第一镜的开头帧，在这里定装。后面各镜都要接这一镜的人、衣服和场。";
  })();
  const refSplit = anchored || lookBack
    ? input.nextCutsAway
      ? `参考图分工：${refName}管人脸、衣服、画风；角色设定图只认脸。不要把这一镜画进那一场。`
      : `参考图分工：${refName}管人脸、衣服、场和画风；角色设定图只认脸、眼镜、体型。这一镜必须和${refName}是同一套人、同一套装。`
    : locked
      ? phase === "end"
        ? "参考图分工：本镜开头只认人、衣服、发型、场和光线，禁止抄开头的姿势和构图；角色设定图只认脸。结束帧必须已经演过几秒。"
        : "参考图分工：上一镜结尾或本镜开头管衣服、发型、场；角色设定图只认脸、眼镜、体型。不要把设定图里的衬衫、便装或另一时代的衣服画回来。"
      : "角色设定图只认脸、眼镜、体型。本集衣服跟这一场时代走，并在这一镜定死，不要照搬设定图里另一时代的便装。不要把设定图衬衫画成这一场的衣服。";
  return [
    `竖屏 9:16 ${style.stillAlias}关键帧，后面只拿开头帧和结束帧给 Seedance 2.0 出片。`,
    style.still,
    "人物上半身和脸必须看清。",
    emotionFaceLine(input.beat, input.look, input.inner, {
      feel: input.director?.feel,
      hookHit: input.director?.hookHit,
      talk: input.speakFromStart,
    }),
    ...positiveShotLines({
      shot: {
        camera: input.camera,
        visual: input.visual,
        look: input.look,
        beat: input.beat,
        plate: input.plate,
      },
      lookStyle: input.lookStyle,
      talk: input.speakFromStart,
      first: input.speakFromStart && input.phase === "start",
      phase: input.phase === "end" ? "end" : "start",
      plate: input.plate,
    }),
    ...negativeShotLines(),
    input.speakFromStart && input.phase === "start"
      ? "口播开场：这一张开头帧嘴必须已经张开，人正在说。不要闭嘴冷脸，不要「要开口」。"
      : input.director?.hookHit && input.beat === "钩"
        ? `开场必须看见：${input.director.hookHit}。`
        : "",
    input.speakFromStart
      ? "有口气，不要神色平静当唯一表情。"
      : "禁止端坐讲课脸，禁止神色平静或谨慎当唯一表情。钩和顶必须看见冷、绷、怕。",
    refSplit,
    MANHUA_NO_MARK,
    ...castLines,
    !castLines.length && who
      ? `出镜的人是${who}，必须和角色设定图是同一些人，不要换脸、不要加新人，不要画成女生除非设定图就是女的。`
      : "",
    !castLines.length && !who
      ? "出镜用一个稳定的角色，脸要清楚，像戏里的人。不要擅自画成女生。"
      : "",
    input.wardrobeLock || "",
    ...(input.props || []).map((prop) =>
      prop.refIndex
        ? `参考图${prop.refIndex}是道具「${prop.name}」的设定图。这一镜里出现必须是同一件，形状、材质、颜色不要换。${prop.look ? `外形：${prop.look}` : ""}`
        : `这一镜道具「${prop.name}」必须画进画面${prop.look ? `：${prop.look}` : ""}，不要换成别的东西。`,
    ),
    phaseLine,
    locked && phase === "start" && !input.cutsAway && input.join !== "cut"
      ? "除非本镜画面写了换装或换场，禁止换装换脸换房间，禁止人瞬移回开场姿势。"
      : "",
    input.join === "cut" && phase === "start"
      ? "禁止换装换脸换房间。必须换机位或换看的人，构图不能和上一镜一样。"
      : "",
    ...blocking,
    phase === "end"
      ? beats.end && beats.end !== beats.start
        ? `这一镜结束画面：${beats.end}`
        : visual
          ? `这一镜画面（必须演到结束，禁止还停在开头）：${visual}`
          : ""
      : beats.start
        ? `这一镜开头画面：${beats.start}`
        : visual
          ? `这一镜画面：${visual}`
          : "",
    imagePrompt
      ? phase === "end"
        ? `构图演到结束：${imagePrompt}`
        : `构图：${imagePrompt}`
      : "",
    input.voiceover
      ? `这镜对白（不要画成讲解脸）：${input.voiceover.slice(0, 60)}`
      : "",
    "只出一张图。",
  ]
    .filter(Boolean)
    .join("\n");
}

const CAMERA_MOVES = [
  "特写",
  "近景",
  "中景",
  "远景",
  "推镜",
  "拉镜",
  "横移",
  "固定",
  "切镜",
] as const;

export function normalizeShotCamera(raw?: string | null): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  const hit = CAMERA_MOVES.find((id) => text.includes(id));
  return hit || text.slice(0, 8);
}

export function inferShotCamera(visual?: string, camera?: string): string {
  return normalizeShotCamera(camera) || normalizeShotCamera(visual) || "固定";
}

export function cameraScheduleLine(camera?: string | null): string {
  const move = inferShotCamera("", camera || "");
  if (move === "推镜") return "这一镜只做一次缓慢推进，不要换别的运镜。";
  if (move === "拉镜") return "这一镜只做一次缓慢拉远，不要换别的运镜。";
  if (move === "横移") return "这一镜只做一次轻微横移，不要环绕，不要再切别的镜头。";
  if (move === "特写" || move === "近景") {
    return "这一镜固定近看，只推近脸或手，不要换成全景。";
  }
  if (move === "远景") return "这一镜固定远看，人要能认，不要突然切特写。";
  if (move === "切镜") return "这一镜硬切到新构图后停住，不要再连续换镜。";
  return "这一镜镜头固定，或只做一种极轻的运动，不要频繁更换镜头方式。";
}

export function manhuaVideoStyle(lookStyle?: string | null): string {
  const look = resolveLookStyle(lookStyle);
  return [
    look.video,
    "人、衣服、场跟参考图是同一套，脸不要换，不要把设定图里另一套衣服画回来。",
    "这是连续短剧，不是幻灯片。第一帧和最后一帧已经锁死，只在这两帧之间往前演。不要把别的静帧当成第一帧。接戏时不要另起构图；硬切时第一帧本身就是新构图。",
    "不要水印，不要 logo，不要屏幕字幕。",
  ].join("\n");
}

export const MANHUA_VIDEO_STYLE = manhuaVideoStyle("semi");
