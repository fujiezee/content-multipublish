export const NARRATOR_SPEAKER_ID = "narrator";

export type TtsVoiceGroup = "角色女" | "角色男" | "旁白" | "口音";

export type TtsVoiceOption = {
  id: string;
  label: string;
  hint: string;
  group: TtsVoiceGroup;
  openaiVoice: string;
};

export const TTS_VOICE_OPTIONS: TtsVoiceOption[] = [
  {
    id: "zh_female_xiaohe_uranus_bigtts",
    label: "小何 2.0 · 女 · 自然",
    hint: "普通话最稳，适合主角",
    group: "角色女",
    openaiVoice: "marin",
  },
  {
    id: "zh_female_vv_uranus_bigtts",
    label: "Vivi 2.0 · 女 · 热络",
    hint: "近、快，像短视频口播",
    group: "角色女",
    openaiVoice: "nova",
  },
  {
    id: "zh_female_shuangkuaisisi_uranus_bigtts",
    label: "思思 2.0 · 女 · 利落",
    hint: "干脆，当面讲",
    group: "角色女",
    openaiVoice: "coral",
  },
  {
    id: "zh_female_cancan_uranus_bigtts",
    label: "灿灿 2.0 · 女 · 知性",
    hint: "清楚，适合讲道理",
    group: "角色女",
    openaiVoice: "sage",
  },
  {
    id: "zh_female_qingxinnvsheng_uranus_bigtts",
    label: "清新 2.0 · 女 · 淡",
    hint: "干净、不甜腻",
    group: "角色女",
    openaiVoice: "shimmer",
  },
  {
    id: "zh_female_linjianvhai_uranus_bigtts",
    label: "邻家 2.0 · 女 · 近",
    hint: "像邻居聊天",
    group: "角色女",
    openaiVoice: "marin",
  },
  {
    id: "zh_female_meilinvyou_uranus_bigtts",
    label: "魅力女友 2.0 · 女",
    hint: "成熟一点，适合对谈",
    group: "角色女",
    openaiVoice: "verse",
  },
  {
    id: "zh_female_tianmeitaozi_uranus_bigtts",
    label: "桃子 2.0 · 女 · 甜",
    hint: "偏甜，别当旁白",
    group: "角色女",
    openaiVoice: "fable",
  },
  {
    id: "zh_female_sajiaoxuemei_uranus_bigtts",
    label: "学妹 2.0 · 女 · 软",
    hint: "软、年轻",
    group: "角色女",
    openaiVoice: "marin",
  },
  {
    id: "zh_male_m191_uranus_bigtts",
    label: "云舟 2.0 · 男 · 稳",
    hint: "低、稳，适合男主",
    group: "角色男",
    openaiVoice: "onyx",
  },
  {
    id: "zh_male_liufei_uranus_bigtts",
    label: "刘飞 2.0 · 男 · 实在",
    hint: "实、短句",
    group: "角色男",
    openaiVoice: "cedar",
  },
  {
    id: "zh_male_taocheng_uranus_bigtts",
    label: "小天 2.0 · 男 · 年轻",
    hint: "偏年轻男声",
    group: "角色男",
    openaiVoice: "echo",
  },
  {
    id: "zh_male_shaonianzixin_uranus_bigtts",
    label: "梓辛 2.0 · 男 · 少年",
    hint: "偏少年，适合年轻男主",
    group: "角色男",
    openaiVoice: "echo",
  },
  {
    id: "zh_male_dayi_uranus_bigtts",
    label: "大壹 2.0 · 男 · 配音",
    hint: "视频配音男声",
    group: "角色男",
    openaiVoice: "onyx",
  },
  {
    id: "zh_male_ruyayichen_uranus_bigtts",
    label: "逸辰 2.0 · 男 · 旁白",
    hint: "适合画外音",
    group: "旁白",
    openaiVoice: "ash",
  },
  {
    id: "zh_female_tianmeixiaoyuan_uranus_bigtts",
    label: "小源 2.0 · 女 · 旁白",
    hint: "软、适合耳边讲",
    group: "旁白",
    openaiVoice: "ballad",
  },
  {
    id: "zh_female_liuchangnv_uranus_bigtts",
    label: "流畅女声 2.0 · 旁白",
    hint: "长句也稳，适合画外音",
    group: "旁白",
    openaiVoice: "sage",
  },
  {
    id: "zh_female_jitangnv_uranus_bigtts",
    label: "鸡汤女 2.0 · 旁白",
    hint: "温、有起伏",
    group: "旁白",
    openaiVoice: "ballad",
  },
  {
    id: "zh_female_mizai_uranus_bigtts",
    label: "咪仔 2.0 · 女 · 旁白",
    hint: "黑猫侦探社咪仔，适合讲故事",
    group: "旁白",
    openaiVoice: "ballad",
  },
  {
    id: "zh_male_shenyeboke_uranus_bigtts",
    label: "深夜播客 2.0 · 男 · 旁白",
    hint: "低、近，像电台，可跟咪仔配对",
    group: "旁白",
    openaiVoice: "ash",
  },
  {
    id: "zh_female_wanwanxiaohe_moon_bigtts",
    label: "湾湾小何 · 女 · 台湾腔",
    hint: "台湾普通话",
    group: "口音",
    openaiVoice: "nova",
  },
  {
    id: "zh_male_jingqiangkanye_moon_bigtts",
    label: "京腔侃爷 · 男 · 北京",
    hint: "北京腔，适合吐槽",
    group: "口音",
    openaiVoice: "onyx",
  },
  {
    id: "zh_female_daimengchuanmei_moon_bigtts",
    label: "呆萌川妹 · 女 · 四川",
    hint: "川味",
    group: "口音",
    openaiVoice: "coral",
  },
  {
    id: "zh_female_yueyunv_mars_bigtts",
    label: "粤语小溏 · 女 · 粤语",
    hint: "粤语女声",
    group: "口音",
    openaiVoice: "shimmer",
  },
];

export const DEFAULT_CHARACTER_VOICE = "zh_female_vv_uranus_bigtts";
export const DEFAULT_NARRATOR_VOICE = "zh_male_ruyayichen_uranus_bigtts";

export const TTS_VOICE_ALIASES: Record<string, string> = {
  nova: "zh_female_vv_uranus_bigtts",
  coral: "zh_female_shuangkuaisisi_uranus_bigtts",
  shimmer: "zh_female_xiaohe_uranus_bigtts",
  sage: "zh_female_cancan_uranus_bigtts",
  marin: "zh_female_xiaohe_uranus_bigtts",
  ballad: "zh_female_tianmeixiaoyuan_uranus_bigtts",
  verse: "zh_female_vv_uranus_bigtts",
  alloy: "zh_female_xiaohe_uranus_bigtts",
  fable: "zh_female_shuangkuaisisi_uranus_bigtts",
  echo: "zh_male_taocheng_uranus_bigtts",
  ash: "zh_male_ruyayichen_uranus_bigtts",
  onyx: "zh_male_m191_uranus_bigtts",
  cedar: "zh_male_liufei_uranus_bigtts",
  zh_female_vv_uranus_bigtts: "zh_female_vv_uranus_bigtts",
  zh_female_cancan_mars_bigtts: "zh_female_cancan_uranus_bigtts",
  zh_female_shuangkuaisisi_moon_bigtts:
    "zh_female_shuangkuaisisi_uranus_bigtts",
  zh_male_chunhou_mars_bigtts: "zh_male_m191_uranus_bigtts",
  zh_male_yuanboxiaoshu_moon_bigtts: "zh_male_ruyayichen_uranus_bigtts",
  zh_male_wennuanahu_moon_bigtts: "zh_male_taocheng_uranus_bigtts",
  zh_male_shenyeboke_moon_bigtts: "zh_male_shenyeboke_uranus_bigtts",
};

export function resolveVoiceId(
  id?: string,
  fallback = DEFAULT_CHARACTER_VOICE,
): string {
  const raw = id?.trim() || "";
  const mapped = TTS_VOICE_ALIASES[raw] || raw || fallback;
  if (TTS_VOICE_OPTIONS.some((v) => v.id === mapped)) return mapped;
  if (TTS_VOICE_OPTIONS.some((v) => v.id === fallback)) return fallback;
  return TTS_VOICE_OPTIONS[0].id;
}

export function isNarratorSpeaker(value?: string): boolean {
  const raw = (value || "").trim();
  return !raw || /^(narrator|旁白|画外音)$/i.test(raw);
}

export function resolveShotSpeakerId(
  shot: { speakerId?: string; speaker?: string },
  cast: Array<{ id: string; name: string }>,
  speakMode?: string,
): string {
  if (shot.speakerId) {
    if (isNarratorSpeaker(shot.speakerId)) return NARRATOR_SPEAKER_ID;
    if (cast.some((c) => c.id === shot.speakerId)) return shot.speakerId;
  }
  const name = (shot.speaker || "").trim();
  if (name && !isNarratorSpeaker(name)) {
    const hit = cast.find((c) => c.name === name);
    if (hit) return hit.id;
  }
  if (isNarratorSpeaker(name) && name) return NARRATOR_SPEAKER_ID;
  if (speakMode === "dialogue" && cast[0]) return cast[0].id;
  return NARRATOR_SPEAKER_ID;
}

export function resolveShotVoiceId(
  shot: { speakerId?: string; speaker?: string },
  input: {
    speakMode?: string;
    narratorVoiceId?: string;
    cast?: Array<{ id: string; name: string; voice_id?: string }>;
  },
): string {
  const cast = input.cast || [];
  const speakerId = resolveShotSpeakerId(shot, cast, input.speakMode);
  if (speakerId === NARRATOR_SPEAKER_ID) {
    return resolveVoiceId(input.narratorVoiceId, DEFAULT_NARRATOR_VOICE);
  }
  const person = cast.find((c) => c.id === speakerId);
  return resolveVoiceId(person?.voice_id, DEFAULT_CHARACTER_VOICE);
}
