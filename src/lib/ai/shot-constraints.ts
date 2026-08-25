import { platePromptLines, resolveShotPlate } from "@/lib/ai/shot-plate";
import type { ShotPlate, VideoShot } from "@/lib/types";

export function negativeShotLines(): string[] {
  return [
    "不要屏幕字幕。",
    "不要 BGM，不要配乐，不要背景音乐。",
    "不要写「要开口」，不要先酝酿再张嘴。",
    "除了对白那一句，提示词里的说明一律不要出声。",
  ];
}

export function talkTimelineLines(input: {
  durationSec: number;
  first?: boolean;
  talk?: boolean;
}): string[] {
  const dur = Math.max(4, Number(input.durationSec) || 4);
  const last = Math.max(0, dur - 0.4).toFixed(1);
  const midEnd = Math.max(0.3, dur - 0.4).toFixed(1);
  const lines = [
    input.first && input.talk
      ? "0-0.3s：嘴已张开，第一句已经在说。不要先盯镜头，不要嘴角微动才开口。"
      : "",
    `0.3-${midEnd}s：按这一镜的动作和景别往前演，不要另起构图。`,
    `${last}-${dur}s：收到结束帧表情，停住，不要再酝酿下一句。`,
  ];
  return lines.filter(Boolean);
}

export function positiveShotLines(input: {
  shot: Pick<VideoShot, "camera" | "visual" | "look" | "beat" | "plate">;
  lookStyle?: string | null;
  talk?: boolean;
  first?: boolean;
  durationSec?: number;
  phase?: "start" | "end" | "video";
  plate?: ShotPlate;
}): string[] {
  const plate = input.plate || resolveShotPlate(input.shot, input.lookStyle);
  const lines = [...platePromptLines(plate)];
  if (input.phase === "start" && input.talk && input.first) {
    lines.push("开头帧嘴必须已经张开，人正在说。禁止闭嘴冷脸。");
  }
  if (input.phase === "video") {
    lines.push(
      ...talkTimelineLines({
        durationSec: input.durationSec || 5,
        first: input.first,
        talk: input.talk,
      }),
    );
  }
  return lines;
}
