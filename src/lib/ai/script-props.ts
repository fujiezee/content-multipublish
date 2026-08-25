import { randomUUID } from "crypto";
import { chatCompletion } from "@/lib/ai/deepseek";
import { resolveLookStyle } from "@/lib/ai/look-styles";
import { MANHUA_NO_MARK } from "@/lib/ai/manhua-look";
import { generateImageWithChat } from "@/lib/ai/openai-image";
import { shotsFromJson, shotsToJson } from "@/lib/ai/video-script";
import {
  getVideoSeriesByArticle,
  listVideoEpisodes,
  updateVideoEpisodeFields,
  updateVideoSeriesFields,
} from "@/lib/db";
import type { ScriptProp, VideoShot } from "@/lib/types";

const MAX_SERIES_PROPS = 6;
const SKIP_PROP =
  /^(房间|屋子|大厅|客厅|卧室|门口|窗外|天空|太阳|月亮|桌子|椅子|板凳|沙发|床|门|窗|地面|地板|墙壁|衣服|长衫|西装|发型|脸|表情|眼泪|目光)$/;

export type ScriptPropNotice = {
  added: string[];
  reused: string[];
  pending: string[];
  message: string;
};

export function parseScriptProps(raw?: string | null): ScriptProp[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ScriptProp[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.trim().slice(0, 12) : "";
      if (!name || SKIP_PROP.test(name)) continue;
      out.push({
        id: typeof o.id === "string" && o.id.trim() ? o.id.trim() : randomUUID(),
        name,
        look: typeof o.look === "string" ? o.look.trim().slice(0, 80) : "",
        url: typeof o.url === "string" ? o.url.trim() : "",
      });
      if (out.length >= MAX_SERIES_PROPS) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function samePropName(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

export function shotMentionsProp(
  shot: Pick<VideoShot, "visual" | "voiceover" | "onScreen" | "imagePrompt" | "props">,
  prop: Pick<ScriptProp, "name">,
): boolean {
  const name = prop.name.trim();
  if (!name) return false;
  if ((shot.props || []).some((item) => samePropName(item, name))) return true;
  if (name.length < 2) return false;
  const blob = [shot.visual, shot.voiceover, shot.onScreen, shot.imagePrompt]
    .filter(Boolean)
    .join("\n");
  return blob.includes(name);
}

export function propsForShot(shot: VideoShot, props: ScriptProp[]): ScriptProp[] {
  return props.filter((prop) => prop.url && shotMentionsProp(shot, prop)).slice(0, 2);
}

export function bindShotProps(shots: VideoShot[], props: ScriptProp[]): VideoShot[] {
  return shots.map((shot) => {
    const names = props
      .filter((prop) => shotMentionsProp(shot, prop))
      .map((prop) => prop.name);
    if (!names.length) {
      if (!shot.props?.length) return shot;
      const next = { ...shot };
      delete next.props;
      return next;
    }
    return { ...shot, props: names };
  });
}

function episodeBlock(
  ep: {
    title: string;
    hook: string;
    voiceover: string;
    on_screen: string;
    shots: VideoShot[];
  },
  episodeNo: number,
): string {
  const shots = ep.shots
    .map(
      (shot) =>
        `第${shot.index}镜 画面：${shot.visual}\n对白：${shot.voiceover}\n花字：${shot.onScreen}`,
    )
    .join("\n");
  return `第${episodeNo}集 ${ep.title}\n钩子：${ep.hook}\n口播：${ep.voiceover}\n${shots}`;
}

/** 字数有限时优先留后面几集，前面只留得下的部分。 */
function episodePropText(
  episodes: Array<{
    title: string;
    hook: string;
    voiceover: string;
    on_screen: string;
    shots: VideoShot[];
  }>,
  limit = 7000,
): string {
  if (!episodes.length) return "";
  const blocks = episodes.map((ep, i) => episodeBlock(ep, i + 1));
  const all = blocks.join("\n\n");
  if (all.length <= limit) return all;
  const kept: string[] = [];
  let used = 0;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const next = blocks[i];
    const extra = kept.length ? 2 : 0;
    if (used + extra + next.length > limit && kept.length) break;
    kept.unshift(next);
    used += extra + next.length;
  }
  return kept.join("\n\n").slice(0, limit);
}

export async function describePropsFromScript(input: {
  seriesTitle?: string;
  episodes: Array<{
    title: string;
    hook: string;
    voiceover: string;
    on_screen: string;
    shots: VideoShot[];
  }>;
}): Promise<Array<{ name: string; look: string }>> {
  const text = episodePropText(input.episodes);
  if (!text.trim()) return [];
  const raw = await chatCompletion(
    [
      {
        role: "system",
        content: `你是短剧道具员。只从剧本原文里已经写到、会入画的具体物件列道具，不要发明，不要把人、衣服、房间、天气当成道具。
只输出 JSON 数组，0 到 ${MAX_SERIES_PROPS} 件：
[{"name":"玉佩","look":"材质颜色大小和关键细节，20-50字"}]
name 必须是剧本里出现过的物件名，2–8 字。
不要：桌子椅子门窗房间天空衣服发型表情眼泪目光。
要：手里拿的、递给别人的、特写会拍到的信/刀/玉佩/签子/酒杯/手机（仅当剧本写了）。
没有就输出 []。`,
      },
      {
        role: "user",
        content: `系列：${input.seriesTitle || "短视频"}

剧本：
${text}`,
      },
    ],
    { temperature: 0.2, maxTokens: 1200, timeoutMs: 45_000 },
  );
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const json = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!Array.isArray(json)) return [];
    const out: Array<{ name: string; look: string }> = [];
    for (const item of json.slice(0, MAX_SERIES_PROPS)) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.trim().slice(0, 12) : "";
      const look = typeof o.look === "string" ? o.look.trim().slice(0, 80) : "";
      if (!name || name.length < 2 || SKIP_PROP.test(name)) continue;
      if (!text.includes(name)) continue;
      if (out.some((row) => samePropName(row.name, name))) continue;
      out.push({ name, look });
    }
    return out;
  } catch {
    return [];
  }
}

export async function generatePropImage(input: {
  name: string;
  look?: string;
  lookStyle?: string | null;
  imageModel?: string;
}): Promise<string> {
  const style = resolveLookStyle(input.lookStyle);
  const look = input.look?.trim() || "";
  const { url } = await generateImageWithChat(
    [
      `1:1 ${style.stillAlias}道具设定图，后面分镜必须认这一件。`,
      style.still,
      `只画「${input.name}」这一件，完整能看清形状、材质、颜色。`,
      look ? `外形：${look}` : "",
      "干净浅底或干净台面。不要人，不要手，不要字，不要第二件东西。",
      MANHUA_NO_MARK,
      "只出一张图。",
    ]
      .filter(Boolean)
      .join("\n"),
    {
      aspectRatio: "1:1",
      model: input.imageModel,
    },
  );
  return url;
}

export async function ensureScriptProps(input: {
  articleId: string;
  imageModel?: string;
  onProgress?: (message: string) => void | Promise<void>;
}): Promise<ScriptPropNotice> {
  const empty: ScriptPropNotice = {
    added: [],
    reused: [],
    pending: [],
    message: "",
  };
  const series = getVideoSeriesByArticle(input.articleId);
  if (!series) return empty;
  const episodes = listVideoEpisodes(series.id).map((ep) => ({
    title: ep.title,
    hook: ep.hook,
    voiceover: ep.voiceover,
    on_screen: ep.on_screen,
    shots: shotsFromJson(ep.shots_json),
  }));
  if (!episodes.some((ep) => ep.shots.length || ep.voiceover.trim())) return empty;

  await input.onProgress?.("正在从剧本里认入画道具…");
  let briefs: Array<{ name: string; look: string }> = [];
  try {
    briefs = await describePropsFromScript({
      seriesTitle: series.title,
      episodes,
    });
  } catch {
    briefs = [];
  }
  if (!briefs.length) return empty;

  const existing = parseScriptProps(series.props_json);
  const next: ScriptProp[] = existing.filter((row) => row.url).slice(0, MAX_SERIES_PROPS);
  const added: string[] = [];
  const reused: string[] = [];
  const pending: string[] = [];

  for (const brief of briefs) {
    const kept = next.find((row) => samePropName(row.name, brief.name));
    if (kept?.url) {
      if (!kept.look && brief.look) kept.look = brief.look;
      reused.push(brief.name);
      continue;
    }
    if (next.length >= MAX_SERIES_PROPS) break;
    await input.onProgress?.(`正在出道具「${brief.name}」设定图…`);
    let url = "";
    try {
      url = await generatePropImage({
        name: brief.name,
        look: brief.look,
        lookStyle: series.look_style,
        imageModel: input.imageModel,
      });
      added.push(brief.name);
    } catch {
      pending.push(brief.name);
      await input.onProgress?.(`「${brief.name}」道具图没出成，分镜仍按文字画`);
    }
    next.push({
      id: randomUUID(),
      name: brief.name,
      look: brief.look,
      url,
    });
  }

  updateVideoSeriesFields(series.id, {
    props_json: JSON.stringify(next),
  });
  for (const ep of listVideoEpisodes(series.id)) {
    updateVideoEpisodeFields(ep.id, {
      shots_json: shotsToJson(bindShotProps(shotsFromJson(ep.shots_json), next)),
    });
  }

  const bits: string[] = [];
  if (added.length) bits.push(`已出道具${added.map((n) => `「${n}」`).join("、")}`);
  if (reused.length && !added.length) {
    bits.push(`道具${reused.map((n) => `「${n}」`).join("、")}沿用设定图`);
  }
  if (pending.length) {
    bits.push(`${pending.map((n) => `「${n}」`).join("、")}还没出成道具图`);
  }
  return { added, reused, pending, message: bits.join("。") };
}
