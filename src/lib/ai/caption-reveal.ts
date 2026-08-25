export type CaptionCue = {
  start: number;
  end: number;
  line: string;
  punch?: string;
};

const SPEAKER_PREFIX = /^([\u4e00-\u9fffA-Za-z·]{1,8}[：:])/;
const PUNCT = /[，。！？、：:；;…—,.!?'"“”‘’（）()【】《》<>·[\]]/g;
const CLAUSE = /[，。！？、：:；;…—,.!?]+/;

export function splitSpeaker(line: string): { who: string; spoken: string } {
  const raw = String(line || "").replace(/\s+/g, "").trim();
  const m = raw.match(SPEAKER_PREFIX);
  if (m) return { who: m[1], spoken: raw.slice(m[1].length) };
  return { who: "", spoken: raw };
}

function stripPlayNotes(text: string): string {
  return text
    .replace(/[（(][^）)]{0,20}[）)]/g, (chunk) =>
      /冷|顶|怒|压|盯|笑|沉|慢|拍|低|咽|急|狠|停|跪/.test(chunk) ? "" : chunk,
    )
    .replace(/^[，、；:：]+/, "");
}

/** 对白原文，去掉角色名，保留断句标点。 */
export function captionSource(input: {
  voiceover?: string;
  onScreen?: string;
}): string {
  let raw = String(input.voiceover || "").replace(/\s+/g, "").trim();
  raw = stripPlayNotes(raw.replace(SPEAKER_PREFIX, ""));
  if (raw) return raw;
  const fallback = String(input.onScreen || "").replace(/\s+/g, "").trim();
  if (/特写|慢镜|镜头|近景|全景|俯拍|侧拍|手部|指节/.test(fallback)) return "";
  return fallback;
}

function cleanPhrase(text: string): string {
  return text.replace(PUNCT, "").replace(/\s+/g, "").trim();
}

/** 按说话停顿断句。过短的语气词并进下一句。 */
export function captionPhrases(source: string): string[] {
  const spoken = splitSpeaker(source).spoken;
  const raw = spoken
    .split(CLAUSE)
    .map(cleanPhrase)
    .filter(Boolean);
  const phrases: string[] = [];
  for (const part of raw) {
    const last = phrases[phrases.length - 1];
    if (last && last.length <= 1) phrases[phrases.length - 1] = last + part;
    else phrases.push(part);
  }
  return phrases;
}

export function displayCaption(input: {
  voiceover?: string;
  speaker?: string;
  onScreen?: string;
}): string {
  return captionPhrases(captionSource(input)).join("");
}

export function wrapCaption(text: string, width = 12, maxLines = 2): string {
  const raw = text.replace(/\s+/g, "").trim();
  if (!raw) return "";
  const lines: string[] = [];
  let rest = raw;
  while (rest && lines.length < maxLines) {
    lines.push(rest.slice(0, width));
    rest = rest.slice(width);
  }
  if (rest) {
    const last = lines[lines.length - 1] || "";
    lines[lines.length - 1] = `${last.slice(0, Math.max(1, width - 1))}…`;
  }
  return lines.join("\n");
}

function phraseAt(phrases: string[], progress: number): string {
  if (!phrases.length) return "";
  const p = Math.min(1, Math.max(0, progress));
  const weights = phrases.map((row) => Math.max(2, row.length));
  const total = weights.reduce((sum, n) => sum + n, 0);
  let acc = 0;
  for (let i = 0; i < phrases.length; i += 1) {
    acc += weights[i] / total;
    if (p <= acc || i === phrases.length - 1) return wrapCaption(phrases[i]);
  }
  return wrapCaption(phrases[phrases.length - 1]);
}

/** progress 0–1：按停顿整句切换，不逐字、不署名、不带标点。 */
export function revealCaption(line: string, progress: number): string {
  return phraseAt(captionPhrases(line), progress);
}

export function expandRevealCues(cues: CaptionCue[]): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const cue of cues) {
    const phrases = captionPhrases(cue.line);
    if (!phrases.length) continue;
    const span = Math.max(0.2, cue.end - cue.start);
    const weights = phrases.map((row) => Math.max(2, row.length));
    const total = weights.reduce((sum, n) => sum + n, 0);
    let t = cue.start;
    for (let i = 0; i < phrases.length; i += 1) {
      const next =
        i === phrases.length - 1
          ? cue.end
          : cue.start + (span * weights.slice(0, i + 1).reduce((sum, n) => sum + n, 0)) / total;
      out.push({
        start: t,
        end: Math.max(t + 0.12, next),
        line: wrapCaption(phrases[i], 10),
      });
      t = next;
    }
  }
  return out;
}
