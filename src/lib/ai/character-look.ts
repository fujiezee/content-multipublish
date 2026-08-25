import type { VideoCharacterAngle, VideoCharacterPhoto } from "@/lib/types";
import { rewritePublicMediaUrl } from "@/lib/content/media-urls";

export function parsePhotos(raw: string): VideoCharacterPhoto[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (typeof item === "string" && item.trim()) {
          return { url: rewritePublicMediaUrl(item.trim()) };
        }
        if (
          item &&
          typeof item === "object" &&
          typeof (item as { url?: string }).url === "string"
        ) {
          return { url: rewritePublicMediaUrl((item as { url: string }).url.trim()) };
        }
        return null;
      })
      .filter((x): x is VideoCharacterPhoto => Boolean(x?.url));
  } catch {
    return [];
  }
}

export function parseAngles(raw: string): VideoCharacterAngle[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const o = item as Record<string, unknown>;
        if (typeof o.url !== "string" || !o.url.trim()) return null;
        return {
          id: typeof o.id === "string" ? o.id : "angle",
          label: typeof o.label === "string" ? o.label : "角度",
          url: rewritePublicMediaUrl(o.url.trim()),
        };
      })
      .filter((x): x is VideoCharacterAngle => Boolean(x));
  } catch {
    return [];
  }
}

/** 角色库或本剧角色已经有参考图 / 多角度时，识别角色不要再生成外形。 */
export function characterHasLook(row?: {
  thumb?: string | null;
  photos?: Array<{ url?: string } | string> | null;
  angles?: Array<{ url?: string } | null> | null;
  photos_json?: string | null;
  angles_json?: string | null;
} | null): boolean {
  if (!row) return false;
  if (String(row.thumb || "").trim()) return true;
  const urls = (items?: Array<{ url?: string } | string> | null) =>
    (items || []).some((item) =>
      typeof item === "string"
        ? Boolean(item.trim())
        : Boolean(item?.url?.trim()),
    );
  if (urls(row.photos) || urls(row.angles)) return true;
  return (
    parsePhotos(row.photos_json || "[]").length > 0 ||
    parseAngles(row.angles_json || "[]").length > 0
  );
}
