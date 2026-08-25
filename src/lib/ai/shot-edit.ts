import {
  innerVoiceMark,
  normalizeSpeakMode,
  shotIsInner,
  stripInnerTag,
  type VideoShot,
  type VideoSpeakMode,
} from "@/lib/types";

const SPEAKER_PREFIX = /^([\u4e00-\u9fffA-Za-z·]{1,8}(?:[（(](?:内心|独白|心里)[）)])?)[：:]/;

function spokenLine(text: string): string {
  let t = String(text || "")
    .replace(/【(?:对话|旁白)】/g, "")
    .trim();
  for (let i = 0; i < 6; i += 1) {
    const next = t.replace(SPEAKER_PREFIX, "").trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

export function removeShot(shots: VideoShot[], index: number): VideoShot[] {
  return shots
    .filter((shot) => shot.index !== index)
    .sort((a, b) => a.index - b.index)
    .map((shot, i) => ({ ...shot, index: i + 1 }));
}

export function voiceoverFromShots(
  shots: VideoShot[],
  mode?: VideoSpeakMode | string,
): string {
  const speak = normalizeSpeakMode(mode);
  const body = shots
    .map((shot) => {
      const line = spokenLine(shot.voiceover);
      if (!line) return "";
      const who =
        stripInnerTag(shot.speaker || "") ||
        (speak === "narration" ? "旁白" : "");
      if (!who) return line;
      const named =
        shotIsInner(shot) && who !== "旁白"
          ? `${who}（内心${innerVoiceMark(shot.innerLevel)}）`
          : who;
      return `${named}：${line}`;
    })
    .filter(Boolean)
    .join("");
  return `【${speak === "dialogue" ? "对话" : "旁白"}】${body}`;
}
