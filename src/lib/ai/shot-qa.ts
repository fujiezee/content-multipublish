import { inferShotJoin } from "@/lib/ai/manhua-look";
import { inferShotPlate } from "@/lib/ai/shot-plate";
import {
  shotHasKeyframes,
  shotNeedsLockedSpeech,
  type ShotQaFlag,
  type VideoShot,
} from "@/lib/types";

export const FILM_STEPS = [
  { id: "speech", label: "锁声" },
  { id: "stills", label: "静帧" },
  { id: "approve", label: "过片" },
  { id: "render", label: "出片" },
  { id: "qa", label: "拉片" },
  { id: "compose", label: "合成" },
] as const;

export type FilmStepId = (typeof FILM_STEPS)[number]["id"];

export type ShotQaMark = {
  index: number;
  flags: ShotQaFlag[];
  onsetSec?: number;
};

export function reviewShotPullSheet(shots: VideoShot[]): ShotQaMark[] {
  const ordered = [...shots].sort((a, b) => a.index - b.index);
  return ordered.map((shot, i) => {
    const prev = i > 0 ? ordered[i - 1] : undefined;
    const flags: ShotQaFlag[] = [];
    const onset = Number(shot.speechOnsetSec);
    if (
      shotNeedsLockedSpeech(shot) &&
      shot.clipUrl?.trim() &&
      Number.isFinite(onset) &&
      onset > 0.3
    ) {
      flags.push("late-open");
    }
    const join = inferShotJoin(shot, prev);
    if (
      join === "cut" &&
      prev &&
      inferShotPlate(shot).size === inferShotPlate(prev).size
    ) {
      flags.push("same-size");
    }
    if (shotNeedsLockedSpeech(shot) && !shot.speechUrl?.trim()) {
      flags.push("no-speech");
    }
    if (
      prev &&
      shot.speaker &&
      prev.speaker &&
      shot.speaker === prev.speaker &&
      shot.speaker !== "旁白" &&
      shot.voiceId &&
      prev.voiceId &&
      shot.voiceId !== prev.voiceId
    ) {
      flags.push("voice-drift");
    }
    return {
      index: shot.index,
      flags,
      ...(Number.isFinite(onset) ? { onsetSec: onset } : {}),
    };
  });
}

export function shotQaLabel(flag: ShotQaFlag): string {
  if (flag === "late-open") return "开口晚";
  if (flag === "same-size") return "景别没换";
  if (flag === "no-speech") return "没锁声";
  return "声线漂了";
}

export function inferFilmStep(input: {
  shots: VideoShot[];
  confirmed?: boolean;
  composed?: boolean;
}): FilmStepId {
  const shots = input.shots;
  if (!shots.length || !input.confirmed) return "speech";
  if (shots.some((shot) => shotNeedsLockedSpeech(shot) && !shot.speechUrl?.trim())) {
    return "speech";
  }
  if (shots.some((shot) => !shotHasKeyframes(shot))) return "stills";
  if (shots.some((shot) => !shot.framesOk)) return "approve";
  if (shots.some((shot) => !shot.clipUrl?.trim())) return "render";
  const qa = reviewShotPullSheet(shots);
  if (qa.some((row) => row.flags.length > 0) && !input.composed) return "qa";
  return "compose";
}
