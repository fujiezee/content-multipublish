import { chatCompletion } from "@/lib/ai/deepseek";
import { manhuaCharacterPrompt } from "@/lib/ai/manhua-look";
import {
  generateImageWithChat,
  loadImageRef,
  type ImageInlineRef,
} from "@/lib/ai/openai-image";
import type { VideoCharacterAngle, VideoCharacterPhoto } from "@/lib/types";

export type ScriptCharacterBrief = {
  name: string;
  look: string;
  role?: string;
};

export const CHARACTER_ANGLES: Array<{ id: string; label: string; view: string }> =
  [
    { id: "front", label: "正面", view: "正面半身到腰，面向镜头，表情自然，可以有一个小手势，不要僵硬站桩" },
    { id: "three_quarter", label: "侧前", view: "四分之三侧面，能看清脸和身体轮廓" },
    { id: "side", label: "侧面", view: "正侧面全身，头和身体都侧过来" },
    { id: "back", label: "背面", view: "背面全身，能看清头发、衣服后背" },
  ];

export function parsePhotos(raw: string): VideoCharacterPhoto[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (typeof item === "string" && item.trim()) return { url: item.trim() };
        if (item && typeof item === "object" && typeof (item as { url?: string }).url === "string") {
          return { url: (item as { url: string }).url.trim() };
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
          url: o.url.trim(),
        };
      })
      .filter((x): x is VideoCharacterAngle => Boolean(x));
  } catch {
    return [];
  }
}

async function refsFromPhotos(photos: VideoCharacterPhoto[]): Promise<ImageInlineRef[]> {
  const refs: ImageInlineRef[] = [];
  for (const photo of photos.slice(0, 4)) {
    const ref = await loadImageRef(photo.url);
    if (ref) refs.push(ref);
  }
  return refs;
}

function scriptText(
  episodes: Array<{ title: string; hook: string; voiceover: string; on_screen: string }>,
): string {
  return episodes
    .slice(0, 8)
    .map(
      (ep, i) =>
        `第${i + 1}集 ${ep.title}\n钩子：${ep.hook}\n出字：${ep.on_screen}\n口播：${ep.voiceover}`,
    )
    .join("\n\n");
}

export async function describeCharactersFromScript(input: {
  seriesTitle?: string;
  genre?: string;
  nameHint?: string;
  episodes: Array<{ title: string; hook: string; voiceover: string; on_screen: string }>;
}): Promise<ScriptCharacterBrief[]> {
  if (input.episodes.length === 0) {
    throw new Error("还没有剧本，先写出一集再按剧本生成角色");
  }
  const raw = await chatCompletion(
    [
      {
        role: "system",
        content: `你是短视频角色造型师。根据剧本列出所有出镜的半写实插画角色，五官清楚像个人，不要写成实拍真人，不要明星脸，不要二次元大眼睛。
只输出 JSON 数组，1 到 4 个人，按戏份从多到少：
[{"name":"角色名","role":"主角或配角","look":"外貌一段话，含性别年龄身材发型五官衣服配饰气质，80-140字，按半写实插画写，不要写皮肤毛孔或照片质感"}]
剧本里有几个人就写几个人。小学生也能看懂。不要写品牌、网址。`,
      },
      {
        role: "user",
        content: `系列：${input.seriesTitle || "短视频"}
形态：${input.genre === "drama" ? "剧情短剧" : "科普口播"}
${input.nameHint ? `已经选定的人：${input.nameHint}` : ""}

剧本：
${scriptText(input.episodes).slice(0, 6000)}`,
      },
    ],
    { temperature: 0.4, maxTokens: 1600, timeoutMs: 60_000 },
  );
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  const briefs: ScriptCharacterBrief[] = [];
  if (start >= 0 && end > start) {
    try {
      const json = JSON.parse(raw.slice(start, end + 1)) as unknown;
      if (Array.isArray(json)) {
        for (const item of json.slice(0, 4)) {
          if (!item || typeof item !== "object") continue;
          const o = item as Record<string, unknown>;
          const name = typeof o.name === "string" ? o.name.trim().slice(0, 16) : "";
          const look =
            typeof o.look === "string"
              ? o.look.replace(/\s+/g, " ").trim().slice(0, 180)
              : "";
          const role = typeof o.role === "string" ? o.role.trim().slice(0, 8) : "";
          if (name || look) briefs.push({ name: name || "角色", look, role });
        }
      }
    } catch {
      // fall through
    }
  }
  if (briefs.length === 0) {
    throw new Error("没从剧本里看出角色，请先把口播写具体一点");
  }
  const withLook = briefs.filter((b) => b.look);
  if (withLook.length === 0) {
    throw new Error("没从剧本里看出角色长什么样，请先把口播写具体一点");
  }
  return withLook;
}

export async function describeCharacterFromScript(input: {
  seriesTitle?: string;
  genre?: string;
  nameHint?: string;
  episodes: Array<{ title: string; hook: string; voiceover: string; on_screen: string }>;
}): Promise<ScriptCharacterBrief> {
  const all = await describeCharactersFromScript(input);
  const hit = input.nameHint
    ? all.find((b) => b.name === input.nameHint?.trim())
    : all[0];
  const brief = hit || all[0];
  if (!brief?.look) {
    throw new Error("没从剧本里看出角色长什么样，请先把口播写具体一点");
  }
  return brief;
}

export async function generateCharacterAngles(input: {
  name?: string;
  look?: string;
  photos?: VideoCharacterPhoto[];
  onProgress?: (message: string) => void;
}): Promise<VideoCharacterAngle[]> {
  const photos = input.photos || [];
  const photoRefs = photos.length ? await refsFromPhotos(photos) : [];
  const who = input.name?.trim() || "这个人";
  const look = input.look?.trim() || "";
  if (photoRefs.length === 0 && !look) {
    throw new Error("先上传角色照片，或先有剧本再按剧本生成");
  }

  const out: VideoCharacterAngle[] = [];
  let lockRefs: ImageInlineRef[] = [];
  for (const angle of CHARACTER_ANGLES) {
    await input.onProgress?.(`正在生成${angle.label}…`);
    const phase =
      lockRefs.length > 0
        ? "from-lock"
        : photoRefs.length > 0
          ? "from-photo"
          : "from-text";
    const refs = lockRefs.length ? lockRefs : photoRefs;
    const { url } = await generateImageWithChat(
      manhuaCharacterPrompt({ who, look, view: angle.view, phase }),
      {
        aspectRatio: "3:4",
        references: refs.length ? refs : undefined,
      },
    );
    out.push({ id: angle.id, label: angle.label, url });
    if (lockRefs.length === 0) {
      const self = await loadImageRef(url);
      if (self) lockRefs = [self];
    }
  }
  return out;
}
