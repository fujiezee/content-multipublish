import {
  characterHasLook,
  describeCharactersFromScript,
  generateCharacterAngles,
  type ScriptCharacterBrief,
} from "@/lib/ai/character-sheet";
import {
  isNarratorSpeaker,
  matchCastBySpeaker,
  pickCharacterVoice,
  voiceGender,
} from "@/lib/ai/tts-voice-ids";
import { isShowStyle, MAX_SERIES_CAST } from "@/lib/ai/video-script-styles";
import {
  embedStanceNotes,
  episodeScriptBlob,
  generateStanceCards,
} from "@/lib/ai/stance-card";
import {
  appendSeriesCast,
  createStudioCharacter,
  getVideoSeriesByArticle,
  listCharacterCatalog,
  listSeriesCharacters,
  listVideoEpisodes,
  updateStudioCharacter,
  updateVideoSeriesFields,
} from "@/lib/db";

export type ScriptCastNotice = {
  needed: string[];
  added: string[];
  reused: string[];
  pendingLooks: string[];
  message: string;
};

export async function ensureScriptCast(input: {
  articleId: string;
  workspaceId: string;
  hookStyle?: string;
  speakMode?: string;
  imageModel?: string;
  onProgress?: (message: string) => void | Promise<void>;
  onCastChange?: () => void | Promise<void>;
}): Promise<ScriptCastNotice> {
  const series = getVideoSeriesByArticle(input.articleId);
  const empty: ScriptCastNotice = {
    needed: [],
    added: [],
    reused: [],
    pendingLooks: [],
    message: "",
  };
  if (!series) return empty;

  const episodes = listVideoEpisodes(series.id);

  const existingCast = listSeriesCharacters(input.articleId);
  const existingNames = existingCast
    .map((row) => row.name.trim())
    .filter(Boolean);
  await input.onProgress?.(
    existingNames.length
      ? "正在核对剧本里有没有新角色…"
      : "正在用模型从剧本里认角色…",
  );
  let briefs: ScriptCharacterBrief[] = [];
  try {
    briefs = await describeCharactersFromScript({
      seriesTitle: series.title,
      genre: series.genre,
      hookStyle: input.hookStyle || series.hook_style,
      nameHint: existingNames.join("、"),
      episodes: episodes.map((ep) => ({
        title: ep.title,
        hook: ep.hook,
        voiceover: ep.voiceover,
        on_screen: ep.on_screen,
      })),
    });
  } catch {
    briefs = existingCast.map((row) => ({
      name: row.name,
      look: row.look || "",
    }));
  }
  if (briefs.length === 0 && existingNames.length) {
    briefs = existingCast.map((row) => ({
      name: row.name,
      look: row.look || "",
    }));
  }

  const needed: string[] = [];
  const pushName = (name: string) => {
    const raw = name.trim().slice(0, 16);
    if (!raw || isNarratorSpeaker(raw)) return;
    if (matchCastBySpeaker(raw, needed.map((n) => ({ id: n, name: n })))) return;
    needed.push(raw);
  };
  for (const brief of briefs) pushName(brief.name);

  const show = isShowStyle(input.hookStyle || series.hook_style);
  const dialogue = input.speakMode === "dialogue" || series.speak_mode === "dialogue";
  if ((show || dialogue) && needed.length < 2 && briefs.length >= 2) {
    for (const brief of briefs) pushName(brief.name);
  }

  if (briefs.length) {
    await input.onProgress?.(
      `认出了 ${briefs.map((item) => `「${item.name}」`).join("、")}`,
    );
    await input.onProgress?.("正在按剧本写角色介绍…");
    try {
      const cards = await generateStanceCards({
        names: briefs.map((item) => item.name),
        hookStyle: input.hookStyle || series.hook_style,
        title: series.title,
        script: episodeScriptBlob(episodes),
        briefs,
      });
      if (cards.length) {
        updateVideoSeriesFields(series.id, {
          notes: embedStanceNotes(series.notes, cards),
        });
      }
    } catch {
      // 角色介绍写失败不挡挂人
    }
  }

  const catalog = listCharacterCatalog(input.workspaceId, { angles: "first" });
  let cast = listSeriesCharacters(input.articleId);
  const added: string[] = [];
  const reused: string[] = [];
  const pendingLooks: string[] = [];
  const usedVoices = new Set(
    [...cast, ...catalog]
      .map((row) => row.voice_id?.trim())
      .filter((id): id is string => Boolean(id)),
  );

  const briefOf = (name: string) =>
    briefs.find((item) => item.name === name) || { name, look: "" };

  const assignVoice = (name: string, look?: string, gender?: string) => {
    const voice = pickCharacterVoice({
      name,
      look,
      gender,
      used: usedVoices,
    });
    usedVoices.add(voice);
    return voice;
  };

  for (const person of cast) {
    const brief = briefOf(person.name);
    const patch: { id: string; workspaceId: string; voice_id?: string; look?: string } = {
      id: person.id,
      workspaceId: input.workspaceId,
    };
    if (!person.voice_id?.trim()) {
      patch.voice_id = assignVoice(person.name, brief.look, brief.gender);
    }
    if (!person.look?.trim() && brief.look) patch.look = brief.look;
    if (patch.voice_id || patch.look) updateStudioCharacter(patch);
  }
  cast = listSeriesCharacters(input.articleId);

  for (const name of needed) {
    if (cast.length >= MAX_SERIES_CAST) break;
    if (matchCastBySpeaker(name, cast)) continue;
    const inLibrary = matchCastBySpeaker(name, catalog);
    if (inLibrary) {
      const brief = briefOf(name);
      const patch: { id: string; workspaceId: string; voice_id?: string; look?: string } = {
        id: inLibrary.id,
        workspaceId: input.workspaceId,
      };
      if (!inLibrary.voice_id?.trim()) {
        patch.voice_id = assignVoice(name, brief.look, brief.gender);
      }
      if (!inLibrary.look?.trim() && brief.look) patch.look = brief.look;
      if (patch.voice_id || patch.look) updateStudioCharacter(patch);
      appendSeriesCast(series.id, inLibrary.id);
      reused.push(inLibrary.name || name);
      cast = listSeriesCharacters(input.articleId);
      await input.onProgress?.(
        characterHasLook(inLibrary)
          ? `「${inLibrary.name || name}」已有角色图，直接挂上，不再生成外形`
          : `已从角色库挂上「${inLibrary.name || name}」`,
      );
      await input.onCastChange?.();
      continue;
    }
    const brief = briefOf(name);
    await input.onProgress?.(`剧本里还需要「${name}」，正在按设定生成外形…`);
    let angles: { id: string; label: string; url: string }[] = [];
    if (brief.look) {
      try {
        angles = await generateCharacterAngles({
          name,
          look: brief.look,
          lookStyle: series.look_style,
          imageModel: input.imageModel,
          onProgress: async (message) => {
            await input.onProgress?.(`「${name}」${message}`);
          },
        });
      } catch {
        pendingLooks.push(name);
        await input.onProgress?.(`「${name}」外形没出齐，可稍后在本剧角色里补`);
      }
    } else {
      pendingLooks.push(name);
      await input.onProgress?.(`「${name}」还没有外形设定，先挂上名字`);
    }
    const saved = createStudioCharacter({
      workspaceId: input.workspaceId,
      name,
      photos_json: "[]",
      angles_json: JSON.stringify(angles),
      source: "script",
      articleId: input.articleId,
      voice_id: assignVoice(name, brief.look, brief.gender),
      look: brief.look,
    });
    appendSeriesCast(series.id, saved.id);
    added.push(name);
    cast = listSeriesCharacters(input.articleId);
    const voiceLabel =
      voiceGender(saved.voice_id) === "male"
        ? "男声"
        : voiceGender(saved.voice_id) === "female"
          ? "女声"
          : "音色";
    await input.onProgress?.(
      angles.length
        ? `「${name}」已进角色库（${angles.length} 个角度），已配${voiceLabel}`
        : `「${name}」已进角色库，已配${voiceLabel}`,
    );
    await input.onCastChange?.();
  }

  const stillMissing = needed.filter(
    (name) => !matchCastBySpeaker(name, listSeriesCharacters(input.articleId)),
  );
  const bits: string[] = [];
  if (reused.length) bits.push(`已从角色库挂上${reused.map((n) => `「${n}」`).join("、")}`);
  if (added.length) bits.push(`已按剧本生成${added.map((n) => `「${n}」`).join("、")}`);
  if (pendingLooks.length) {
    bits.push(`${pendingLooks.map((n) => `「${n}」`).join("、")}还没出外形，可在本剧角色里补`);
  }
  if (stillMissing.length) {
    bits.push(
      `还缺${stillMissing.map((n) => `「${n}」`).join("、")}，本剧角色已满 ${MAX_SERIES_CAST} 人`,
    );
  }
  if (!bits.length && (needed.length || existingNames.length)) {
    bits.push("本剧角色都已在，没有认出新人");
  }

  return {
    needed,
    added,
    reused,
    pendingLooks,
    message: bits.join("。"),
  };
}
