import { resolveLookStyle } from "@/lib/ai/look-styles";
import {
  SHOT_ANGLES,
  SHOT_SIZES,
  type ShotAngle,
  type ShotPlate,
  type ShotSize,
  type VideoShot,
} from "@/lib/types";

const SIZE_SET = new Set<string>(SHOT_SIZES);
const ANGLE_SET = new Set<string>(SHOT_ANGLES);

export function normalizeShotSize(raw?: unknown): ShotSize | "" {
  const text = String(raw || "").trim();
  if (SIZE_SET.has(text)) return text as ShotSize;
  if (/特写/.test(text)) return "特写";
  if (/近景/.test(text)) return "近景";
  if (/中景/.test(text)) return "中景";
  if (/远景|全景/.test(text)) return "远景";
  return "";
}

export function normalizeShotAngle(raw?: unknown): ShotAngle | "" {
  const text = String(raw || "").trim();
  if (ANGLE_SET.has(text)) return text as ShotAngle;
  if (/过肩/.test(text)) return "过肩";
  if (/仰视|仰拍/.test(text)) return "仰视";
  if (/俯视|俯拍/.test(text)) return "俯视";
  if (/侧/.test(text)) return "侧";
  if (/平视/.test(text)) return "平视";
  return "";
}

export function normalizeShotMove(raw?: unknown): string {
  const text = String(raw || "").trim();
  if (/推镜|推进/.test(text)) return "推镜";
  if (/拉镜|拉远/.test(text)) return "拉镜";
  if (/横移/.test(text)) return "横移";
  if (/切镜/.test(text)) return "切镜";
  if (/固定/.test(text)) return "固定";
  return "";
}

export function talkHookPlate(): ShotPlate {
  return {
    size: "近景",
    angle: "平视",
    framing: "说话的人占画，嘴已经张开",
    light: "面光清楚",
    grade: "跟本剧画风",
    motion: "已在说",
  };
}

function lookGrade(lookStyle?: string | null): { light: string; grade: string } {
  const id = resolveLookStyle(lookStyle).id;
  if (id === "dark") return { light: "硬光打脸和手", grade: "黑金低饱和" };
  if (id === "cinema") return { light: "电影侧光", grade: "低饱和实景" };
  if (id === "ghibli" || id === "watercolor") {
    return { light: "柔光", grade: "水彩淡色" };
  }
  return { light: "面光清楚", grade: "跟本剧画风" };
}

export function parseShotPlate(raw: unknown): ShotPlate | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const size = normalizeShotSize(o.size ?? o.shotSize ?? o.shot_size);
  const angle = normalizeShotAngle(o.angle ?? o.shotAngle ?? o.shot_angle);
  const framing = String(o.framing ?? o.compose ?? o.构图 ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  const light = String(o.light ?? o.光影 ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  const grade = String(o.grade ?? o.色调 ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  const motion = String(o.motion ?? o.动势 ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  if (!size && !angle && !framing && !light && !grade && !motion) {
    return undefined;
  }
  return {
    size: size || "近景",
    angle: angle || "平视",
    framing,
    light,
    grade,
    motion,
  };
}

function cleanPlateFraming(raw: string, visual?: string): string {
  const framing = String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  const vis = String(visual || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!framing) return "";
  if (!vis) return framing;
  if (vis.startsWith(framing) || (framing.length >= 12 && vis.includes(framing))) {
    return "";
  }
  return framing;
}

export function inferShotPlate(
  shot?: Pick<VideoShot, "plate" | "camera" | "visual" | "look" | "beat"> | null,
  lookStyle?: string | null,
): ShotPlate {
  if (shot?.plate?.size) {
    return {
      size: normalizeShotSize(shot.plate.size) || "近景",
      angle: normalizeShotAngle(shot.plate.angle) || "平视",
      framing: cleanPlateFraming(shot.plate.framing, shot.visual),
      light: String(shot.plate.light || "").trim().slice(0, 16),
      grade: String(shot.plate.grade || "").trim().slice(0, 16),
      motion: String(shot.plate.motion || "").trim().slice(0, 12),
    };
  }
  const blob = `${shot?.camera || ""} ${shot?.visual || ""} ${shot?.look || ""}`;
  const size =
    normalizeShotSize(shot?.camera) ||
    normalizeShotSize(blob) ||
    (shot?.beat === "钩" || shot?.beat === "停" || shot?.beat === "打"
      ? "特写"
      : "近景");
  const look = lookGrade(lookStyle);
  const motion = /已经张嘴|正在说|已在说/.test(blob)
    ? "已在说"
    : /停|闭嘴/.test(blob)
      ? "停"
      : "";
  return {
    size,
    angle: normalizeShotAngle(blob) || "平视",
    framing: "",
    light: look.light,
    grade: look.grade,
    motion,
  };
}

export function resolveShotPlate(
  shot?: Pick<VideoShot, "plate" | "camera" | "visual" | "look" | "beat"> | null,
  lookStyle?: string | null,
): ShotPlate {
  return inferShotPlate(shot, lookStyle);
}

export function platePromptLines(plate: ShotPlate): string[] {
  return [
    `景别：${plate.size}`,
    `角度：${plate.angle}`,
    plate.framing ? `构图：${plate.framing}` : "",
    plate.light ? `光影：${plate.light}` : "",
    plate.grade ? `色调：${plate.grade}` : "",
    plate.motion ? `动势：${plate.motion}` : "",
  ].filter(Boolean);
}

export function cameraMoveOf(
  shot?: Pick<VideoShot, "camera" | "visual"> | null,
): string {
  return (
    normalizeShotMove(shot?.camera) ||
    normalizeShotMove(shot?.visual) ||
    "固定"
  );
}

export function dirtyStillsKeepSpeech(shot: VideoShot): VideoShot {
  const next = { ...shot };
  delete next.sceneUrl;
  delete next.startUrl;
  delete next.endUrl;
  delete next.framesOk;
  return next;
}

export function platesEqual(a?: ShotPlate | null, b?: ShotPlate | null): boolean {
  if (!a || !b) return false;
  return (
    a.size === b.size &&
    a.angle === b.angle &&
    a.framing === b.framing &&
    a.light === b.light &&
    a.grade === b.grade &&
    a.motion === b.motion
  );
}

/** 服务端快照若还没落到图，留下本地已经拿到的头尾，避免下一枪以为没出完。 */
export function keepLocalShotMedia(
  local: VideoShot[],
  remote: VideoShot[],
): VideoShot[] {
  if (!remote.length) return local;
  const loc = new Map(local.map((shot) => [shot.index, shot]));
  return remote.map((shot) => {
    const prev = loc.get(shot.index);
    if (!prev) return shot;
    return {
      ...shot,
      startUrl: shot.startUrl || prev.startUrl,
      endUrl: shot.endUrl || prev.endUrl,
      sceneUrl: shot.sceneUrl || prev.sceneUrl,
      speechUrl: shot.speechUrl || prev.speechUrl,
      clipUrl: shot.clipUrl || prev.clipUrl,
      rawClipUrl: shot.rawClipUrl || prev.rawClipUrl,
      lastFrameUrl: shot.lastFrameUrl || prev.lastFrameUrl,
    };
  });
}
