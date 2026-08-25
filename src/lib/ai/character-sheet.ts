import { chatCompletion } from "@/lib/ai/deepseek";
import {
  hookStyleLabel,
  hookStyleLookLine,
  normalizeHookStyle,
} from "@/lib/ai/video-script-styles";
import { manhuaCharacterPrompt } from "@/lib/ai/manhua-look";
import {
  collectDialogueCast,
  looksLikeCharacterName,
} from "@/lib/ai/script-import";
import {
  generateImageWithChat,
  loadImageRef,
  type ImageInlineRef,
} from "@/lib/ai/openai-image";
import type { VideoCharacterAngle, VideoCharacterPhoto } from "@/lib/types";
import {
  characterHasLook,
  parseAngles,
  parsePhotos,
} from "@/lib/ai/character-look";

export { characterHasLook, parseAngles, parsePhotos };

export type ScriptCharacterBrief = {
  name: string;
  look: string;
  role?: string;
  intro?: string;
  gender?: "男" | "女";
};

function composeCharacterLook(input: {
  gender?: string;
  age?: string;
  look?: string;
  marks?: string;
  wardrobe?: string;
  habit?: string;
}): string {
  const parts = [
    input.gender?.trim(),
    input.age?.trim(),
    input.look?.replace(/\s+/g, " ").trim(),
    input.marks?.trim() ? `标志：${input.marks.trim()}` : "",
    input.wardrobe?.trim() ? `定装：${input.wardrobe.trim()}` : "",
    input.habit?.trim() ? `习惯：${input.habit.trim()}` : "",
  ].filter(Boolean);
  return parts.join("，").replace(/，+/g, "，").slice(0, 360);
}

export const CHARACTER_ANGLES: Array<{ id: string; label: string; view: string }> =
  [
    { id: "front", label: "正面", view: "正面半身到腰，面向镜头，表情自然，可以有一个小手势，不要僵硬站桩" },
    { id: "three_quarter", label: "侧前", view: "四分之三侧面，能看清脸和身体轮廓" },
    { id: "side", label: "侧面", view: "正侧面全身，头和身体都侧过来" },
    { id: "back", label: "背面", view: "背面全身，能看清头发、衣服后背" },
  ];

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
    .slice(0, 12)
    .map(
      (ep, i) =>
        `第${i + 1}集 ${ep.title}\n钩子：${ep.hook}\n口播：${ep.voiceover}`,
    )
    .join("\n\n");
}

function hintedNames(raw?: string): string[] {
  return String(raw || "")
    .split(/[、,，/\s]+/)
    .map((name) => name.trim())
    .filter((name) => name && name !== "旁白" && looksLikeCharacterName(name));
}

function fallbackCharacterBriefs(input: {
  nameHint?: string;
  episodes: Array<{ title: string; hook: string; voiceover: string; on_screen: string }>;
}): ScriptCharacterBrief[] {
  const names = [
    ...new Set([
      ...hintedNames(input.nameHint),
      ...collectDialogueCast(scriptText(input.episodes)),
    ]),
  ].slice(0, 8);
  return names.map((name) => ({ name, look: "", role: "", intro: "" }));
}

export async function describeCharactersFromScript(input: {
  seriesTitle?: string;
  genre?: string;
  hookStyle?: string;
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
        content: `你在读短剧剧本，找出场上的人。只认会说话、有名字的人物，不要认镜头、动作、花字、表情、道具、地名、预告。
不要用规则去扫「某某：」。先读完整准稿，再判断谁是人。
例如「霍北辰：放下。」是人；「又立刻摸土」「小石头一愣」「沈清禾开匣」「系统残响」「第二季预告」「西域沙洲」不是人。
只输出 JSON 数组，1 到 8 个人，按戏份从多到少：
[{"name":"人名","role":"剧里的身份，如边关守将、被定罪的妻子，不要写主角配角拿主意的人","intro":"40-90字真实介绍：是谁、和谁什么关系、这出戏要干什么，必须从准稿读出来，禁止压/被压/插一句模板","gender":"男或女","age":"大约几岁","look":"身高体型发型发色五官气质，40-80字","marks":"疤痕眼镜纹身随身物，没有就空","wardrobe":"这一场定装：日常或公务/战斗各写清颜色和款式","habit":"常见动作或说话样子，能画出来"}]
name 只写人名，不要加人名后面的动作。gender 必须写准。不要明星脸，不要品牌、网址。`,
      },
      {
        role: "user",
        content: `系列：${input.seriesTitle || "短视频"}
形态：${hookStyleLabel(input.hookStyle || (input.genre === "drama" ? "drama" : "talk"))}
造型：${hookStyleLookLine(input.hookStyle || (input.genre === "drama" ? "drama" : "talk"))}
${input.hookStyle ? `题材：${hookStyleLabel(normalizeHookStyle(input.hookStyle))}。` : ""}
${input.nameHint ? `已经选定的人：${input.nameHint}` : ""}

剧本：
${scriptText(input.episodes).slice(0, 6000)}`,
      },
    ],
    { temperature: 0.4, maxTokens: 2200, timeoutMs: 60_000 },
  );
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  const briefs: ScriptCharacterBrief[] = [];
  if (start >= 0 && end > start) {
    try {
      const json = JSON.parse(raw.slice(start, end + 1)) as unknown;
      if (Array.isArray(json)) {
        for (const item of json.slice(0, 8)) {
          if (!item || typeof item !== "object") continue;
          const o = item as Record<string, unknown>;
          const name = typeof o.name === "string" ? o.name.trim().slice(0, 16) : "";
          const role = typeof o.role === "string"
            ? o.role.replace(/拿主意的人|被压的人|在场的人|主角或配角/g, "").trim().slice(0, 24)
            : "";
          const intro = typeof o.intro === "string"
            ? o.intro.replace(/\s+/g, " ").trim().slice(0, 180)
            : "";
          const genderRaw = typeof o.gender === "string" ? o.gender.trim() : "";
          const gender = /女/.test(genderRaw)
            ? "女"
            : /男/.test(genderRaw)
              ? "男"
              : undefined;
          const look = composeCharacterLook({
            gender,
            age: typeof o.age === "string" ? o.age : "",
            look: typeof o.look === "string" ? o.look : "",
            marks: typeof o.marks === "string" ? o.marks : "",
            wardrobe: typeof o.wardrobe === "string" ? o.wardrobe : "",
            habit: typeof o.habit === "string" ? o.habit : "",
          });
          if (name && name !== "旁白") {
            briefs.push({ name, look, role, intro, gender });
          }
        }
      }
    } catch {
      // fall through
    }
  }
  if (briefs.length === 0) {
    briefs.push(...fallbackCharacterBriefs(input));
  }
  if (briefs.length === 0) {
    throw new Error("没从剧本里看出角色，请先把口播写具体一点");
  }
  return briefs;
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
  imageModel?: string;
  lookStyle?: string | null;
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
      manhuaCharacterPrompt({
        who,
        look,
        view: angle.view,
        phase,
        lookStyle: input.lookStyle,
      }),
      {
        aspectRatio: "3:4",
        references: refs.length ? refs : undefined,
        model: input.imageModel,
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
