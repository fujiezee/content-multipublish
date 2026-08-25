import type { VideoShot } from "@/lib/types";

export const DIRECTOR_FEELS = ["怒", "冤", "怕", "甜", "爽"] as const;
export type DirectorFeel = (typeof DIRECTOR_FEELS)[number];
export const DIRECTOR_CLOSES = ["气", "爽"] as const;
export type DirectorClose = (typeof DIRECTOR_CLOSES)[number];

export type ShotAgentLock = {
  root: string;
  feel: DirectorFeel;
  close: DirectorClose;
  hookHit: string;
};

export type SeriesWardrobeLock = {
  clothes: string;
  set: string;
  lastFrameUrl: string;
};

function clip(text: unknown, max: number): string {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function normalizeDirectorFeel(raw: unknown): DirectorFeel {
  const t = String(raw || "").trim();
  return (DIRECTOR_FEELS as readonly string[]).includes(t)
    ? (t as DirectorFeel)
    : "冤";
}

export function normalizeDirectorClose(raw: unknown): DirectorClose {
  const t = String(raw || "").trim();
  return (DIRECTOR_CLOSES as readonly string[]).includes(t)
    ? (t as DirectorClose)
    : "气";
}

export function parseDirectorLock(raw?: string | null): ShotAgentLock | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const root = clip(o.root, 16);
    const hookHit = clip(o.hookHit ?? o.hook_hit, 64);
    if (!root && !hookHit) return null;
    return {
      root,
      feel: normalizeDirectorFeel(o.feel),
      close: normalizeDirectorClose(o.close),
      hookHit,
    };
  } catch {
    return null;
  }
}

export function directorLockToJson(lock?: ShotAgentLock | null): string {
  if (!lock) return "";
  return JSON.stringify({
    root: clip(lock.root, 16),
    feel: normalizeDirectorFeel(lock.feel),
    close: normalizeDirectorClose(lock.close),
    hookHit: clip(lock.hookHit, 64),
  });
}

export function parseSeriesWardrobe(raw?: string | null): SeriesWardrobeLock {
  const empty: SeriesWardrobeLock = { clothes: "", set: "", lastFrameUrl: "" };
  const text = String(raw || "").trim();
  if (!text) return empty;
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    return {
      clothes: clip(o.clothes, 80),
      set: clip(o.set, 40),
      lastFrameUrl: clip(o.lastFrameUrl ?? o.last_frame_url, 2000),
    };
  } catch {
    return empty;
  }
}

export function seriesWardrobeToJson(lock?: SeriesWardrobeLock | null): string {
  if (!lock) return "";
  const next = {
    clothes: clip(lock.clothes, 80),
    set: clip(lock.set, 40),
    lastFrameUrl: clip(lock.lastFrameUrl, 2000),
  };
  if (!next.clothes && !next.set && !next.lastFrameUrl) return "";
  return JSON.stringify(next);
}

const SET_MARK =
  /(?:在|于)([^，。\s]{1,12}(?:府|殿|厅|堂|房|屋|院|街|廊|门|殿上|府里|朝堂|办公室|会议室))/;
const OUTER_GARMENT =
  /(?:深色|黑色|白色|灰色|深蓝|藏青)?(?:西装套装|西装|西服|外套|大衣|夹克|长衫|长袍|朝服|官服|汉服|旗袍|正装)/;
const ANY_GARMENT =
  /(?:深色|黑色|白色|灰色|深蓝|藏青)?(?:西装套装|西装|西服|外套|大衣|夹克|长衫|长袍|朝服|官服|汉服|旗袍|正装|衬衫|衬衣|T恤|卫衣|便装)/;

/** 从画面里抽出这一场该锁的那套衣服。西装里露出衬衫时，锁外套，不锁衬衫。 */
export function extractClothesPhrase(text: string): string {
  const blob = String(text || "");
  const all = [...blob.matchAll(new RegExp(ANY_GARMENT.source, "g"))].map(
    (row) => row[0],
  );
  if (all.length) {
    return all.find((item) => OUTER_GARMENT.test(item)) || all[0];
  }
  const wear = blob.match(/穿(?:着)?([^，。]{2,20})/);
  return wear?.[1]?.replace(/^着/, "").trim() || "";
}

export function extractSeriesWardrobe(
  shots: VideoShot[],
  prev?: SeriesWardrobeLock | null,
): SeriesWardrobeLock {
  const first = shots[0];
  const last = shots.at(-1);
  const firstBlob = `${first?.visual || ""} ${first?.imagePrompt || ""}`;
  const setBlob = shots
    .slice(0, 3)
    .map((shot) => shot.visual || "")
    .join("。");
  const setHit = setBlob.match(SET_MARK)?.[1] || "";
  const clothesHit = extractClothesPhrase(firstBlob);
  const lastFrameUrl =
    last?.endUrl?.trim() ||
    last?.lastFrameUrl?.trim() ||
    last?.startUrl?.trim() ||
    "";
  return {
    clothes: clothesHit || prev?.clothes || "",
    set: setHit || prev?.set || "",
    lastFrameUrl: lastFrameUrl || prev?.lastFrameUrl || "",
  };
}

export function seriesWardrobeLine(lock?: SeriesWardrobeLock | null): string {
  if (!lock) return "";
  const clothes = extractClothesPhrase(lock.clothes) || lock.clothes;
  const bits = [
    clothes
      ? /西装|西服|外套|大衣|夹克|正装/.test(clothes)
        ? `已定装：${clothes}。后面各镜必须原样穿，禁止改成衬衫或便装`
        : `已定装：${clothes}。后面各镜必须原样穿，禁止换装`
      : "",
    lock.set ? `主场：${lock.set}` : "",
  ].filter(Boolean);
  if (!bits.length) return "";
  return `${bits.join("。")}。换场必须写「从A到B」，默认不准换装。`;
}
