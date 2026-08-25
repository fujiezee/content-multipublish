const SCRIPT_MARK =
  /【对话】|【旁白】|第\s*\d+\s*集|镜头\s*\d|分镜|^INT\.|^EXT\.|VO[:：]|OS[:：]|（内心/m;
const SPEAKER_LINE = /^(?:[^\n：:]{1,12})[：:]/m;

export function looksLikeImportedScript(text: string): boolean {
  const t = String(text || "").trim();
  if (t.length < 8) return false;
  return SCRIPT_MARK.test(t) || SPEAKER_LINE.test(t);
}

export function resolveScriptSourceKind(
  raw?: string | null,
  body?: string,
): "article" | "script" {
  if (raw === "script") return "script";
  if (raw === "article") return "article";
  return looksLikeImportedScript(body || "") ? "script" : "article";
}

export function scriptSourceMinChars(kind: "article" | "script"): number {
  return kind === "script" ? 40 : 80;
}

const EPISODE_MARK = /第\s*(\d+)\s*集/g;

export function guessImportedEpisodeCount(text: string): number {
  const raw = String(text || "").trim();
  if (!raw) return 1;
  const marks = [...raw.matchAll(EPISODE_MARK)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (marks.length > 0) {
    return Math.min(80, Math.max(1, Math.max(...marks)));
  }
  const byLen = Math.round(raw.length / 900);
  return Math.min(80, Math.max(1, byLen));
}

export function leftoverImportedEpisodes(
  text: string,
  written: number,
): number {
  const guessed = guessImportedEpisodeCount(text);
  const have = Math.max(0, Math.round(Number(written) || 0));
  return Math.max(0, guessed - have);
}

const NOT_PERSON =
  /^(旁白|画外音|内心|独白|VO|OS|镜头|画面|花字|特写|近景|中景|远景|字幕|对白|动作|场景|时间|地点|备注|提示|知道|注意|标题)$/i;
const ACTION_AS_NAME =
  /扔过|扔了|甩进|甩到|按住|按着|笑了|像刀|怀里|走进|走出|转身|抬头|低头|伸手|抬手|盯着|看着|拿起|放下|递过|拍板|签子|玉佩|衣裳|目光|居然|特写|推开|关上|跪下|站起|坐到|走向|看向|望着|冷笑|怒视/;
const NAME_TOKEN =
  /([\u4e00-\u9fffA-Za-z·]{1,8})(?:[（(](?:内心|独白|心里)[^）)]*[）)])?[：:]/g;

export function looksLikeCharacterName(raw: string): boolean {
  const name = String(raw || "")
    .replace(/[（(](?:内心|独白|心里)[^）)]*[）)]/g, "")
    .trim();
  if (!name || name.length > 6) return false;
  if (NOT_PERSON.test(name)) return false;
  if (/^(他|她|它|我|你|这|那)/.test(name) && name.length > 1) return false;
  if (ACTION_AS_NAME.test(name)) return false;
  if (name.length >= 4 && /[扔甩按笑走站坐拿递压打推拉抱跪转望盯看哭喊叫拍摔]/.test(name)) {
    return false;
  }
  return true;
}

export function collectDialogueCast(text: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const raw = String(text || "").replace(/<[^>]+>/g, "\n");
  for (const match of raw.matchAll(NAME_TOKEN)) {
    const name = match[1].trim();
    if (!looksLikeCharacterName(name) || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export async function readScriptFile(file: File): Promise<string> {
  if (file.size > 2_000_000) throw new Error("文件太大，先剪到 2MB 以内");
  const name = file.name.toLowerCase();
  const okType =
    file.type.startsWith("text/") ||
    file.type === "application/json" ||
    /\.(txt|md|fountain|json)$/.test(name);
  if (!okType) throw new Error("先用 txt、md 或 fountain 文本");
  const text = (await file.text()).replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("这个文件是空的");
  return text;
}
