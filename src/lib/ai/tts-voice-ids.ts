export const NARRATOR_SPEAKER_ID = "narrator";

export type TtsVoiceGroup =
  | "我的"
  | "角色女"
  | "角色男"
  | "老年人"
  | "旁白"
  | "卡通"
  | "口音";

export const CUSTOM_VOICE_GROUP: TtsVoiceGroup = "我的";

export type TtsSpeechProvider = "ark" | "openai";

export type TtsSpeechModelOption = {
  id: string;
  label: string;
  hint: string;
  provider: TtsSpeechProvider;
};

export const TTS_SPEECH_MODELS: TtsSpeechModelOption[] = [
  {
    id: "doubao-seed-tts-2.0",
    label: "豆包语音 2.0",
    hint: "默认。小何、深夜播客这些 2.0 音色",
    provider: "ark",
  },
  {
    id: "seed-tts-2.0-expressive",
    label: "豆包 2.0 表现力",
    hint: "对谈更有情绪，声线可能偏一点",
    provider: "ark",
  },
  {
    id: "doubao-seed-tts-1.0",
    label: "豆包语音 1.0",
    hint: "台湾腔、京腔、川妹这些老音色",
    provider: "ark",
  },
  {
    id: "gpt-4o-mini-tts",
    label: "GPT 配音",
    hint: "不是方舟原声，咪仔会对成别的女声",
    provider: "openai",
  },
];

export const DEFAULT_TTS_SPEECH_MODEL = "doubao-seed-tts-2.0";

export function resolveTtsSpeechModel(id?: string | null): string {
  const raw = String(id || "").trim();
  if (TTS_SPEECH_MODELS.some((row) => row.id === raw)) return raw;
  return DEFAULT_TTS_SPEECH_MODEL;
}

export function ttsSpeechModelMeta(id?: string | null): TtsSpeechModelOption {
  const resolved = resolveTtsSpeechModel(id);
  return (
    TTS_SPEECH_MODELS.find((row) => row.id === resolved) || TTS_SPEECH_MODELS[0]
  );
}

export function isCustomVoiceId(id?: string): boolean {
  const raw = id?.trim() || "";
  if (!raw) return false;
  return (
    /^(cosyvoice-|qwen-audio-|qwen3-tts|custom_)/i.test(raw) ||
    /^dw[a-z0-9]{6,16}$/i.test(raw)
  );
}

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
    id: "zh_female_popo_uranus_bigtts",
    label: "婆婆 2.0 · 女 · 老年",
    hint: "年长女声，适合婆婆、老太太",
    group: "老年人",
    openaiVoice: "marin",
  },
  {
    id: "ICL_uranus_zh_female_heainainai_tob",
    label: "和蔼奶奶 2.0 · 女 · 老年",
    hint: "温和奶奶音，适合长辈",
    group: "老年人",
    openaiVoice: "ballad",
  },
  {
    id: "ICL_uranus_zh_male_youmodaye_tob",
    label: "幽默大爷 2.0 · 男 · 老年",
    hint: "说书大爷、逗趣长辈，不要给阁老、首辅",
    group: "老年人",
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
    label: "咪仔 2.0 · 女 · 卡通",
    hint: "黑猫侦探社卡通配音，故事旁白可以，播客对谈一般别用",
    group: "旁白",
    openaiVoice: "ballad",
  },
  {
    id: "zh_male_shenyeboke_uranus_bigtts",
    label: "深夜播客 2.0 · 男 · 旁白",
    hint: "低、近，像电台主持",
    group: "旁白",
    openaiVoice: "ash",
  },
  {
    id: "zh_female_sophie_uranus_bigtts",
    label: "苏菲 2.0 · 女 · 魅力",
    hint: "成熟女声，适合对谈",
    group: "角色女",
    openaiVoice: "verse",
  },
  {
    id: "zh_female_kefunvsheng_uranus_bigtts",
    label: "暖阳 2.0 · 女 · 客服",
    hint: "稳、暖，适合讲解",
    group: "角色女",
    openaiVoice: "sage",
  },
  {
    id: "zh_female_yingyujiaoxue_uranus_bigtts",
    label: "Tina 2.0 · 女 · 老师",
    hint: "教学口吻，中英都行",
    group: "角色女",
    openaiVoice: "sage",
  },
  {
    id: "zh_female_wenroumama_uranus_bigtts",
    label: "温柔妈妈 2.0 · 女",
    hint: "软、稳，适合长辈女声",
    group: "角色女",
    openaiVoice: "marin",
  },
  {
    id: "zh_female_qiaopinv_uranus_bigtts",
    label: "俏皮女 2.0 · 女",
    hint: "轻快，适合短视频",
    group: "角色女",
    openaiVoice: "nova",
  },
  {
    id: "zh_female_zhishuaiyingzi_uranus_bigtts",
    label: "英子 2.0 · 女 · 直率",
    hint: "冲、干脆",
    group: "角色女",
    openaiVoice: "coral",
  },
  {
    id: "zh_female_gaolengyujie_uranus_bigtts",
    label: "高冷御姐 2.0 · 女",
    hint: "冷一点、成熟",
    group: "角色女",
    openaiVoice: "verse",
  },
  {
    id: "zh_female_wenroushunv_uranus_bigtts",
    label: "温柔淑女 2.0 · 女",
    hint: "软、稳，适合小说女主",
    group: "角色女",
    openaiVoice: "marin",
  },
  {
    id: "zh_female_gufengshaoyu_uranus_bigtts",
    label: "古风少御 2.0 · 女",
    hint: "古装女主",
    group: "角色女",
    openaiVoice: "ballad",
  },
  {
    id: "zh_female_mengyatou_uranus_bigtts",
    label: "萌丫头 2.0 · 女",
    hint: "年轻、轻快",
    group: "角色女",
    openaiVoice: "fable",
  },
  {
    id: "zh_female_tiexinnvsheng_uranus_bigtts",
    label: "贴心女声 2.0 · 女",
    hint: "近、暖，适合答疑",
    group: "角色女",
    openaiVoice: "marin",
  },
  {
    id: "zh_female_jitangmei_uranus_bigtts",
    label: "鸡汤妹妹 2.0 · 女",
    hint: "有起伏，适合口播",
    group: "角色女",
    openaiVoice: "ballad",
  },
  {
    id: "zh_female_kailangjiejie_uranus_bigtts",
    label: "开朗姐姐 2.0 · 女",
    hint: "亮、热络",
    group: "角色女",
    openaiVoice: "nova",
  },
  {
    id: "zh_female_linxiao_uranus_bigtts",
    label: "林潇 2.0 · 女",
    hint: "角色女声，适合对谈",
    group: "角色女",
    openaiVoice: "verse",
  },
  {
    id: "zh_female_lingling_uranus_bigtts",
    label: "玲玲姐姐 2.0 · 女",
    hint: "亲、像姐姐讲",
    group: "角色女",
    openaiVoice: "nova",
  },
  {
    id: "zh_female_qinqienv_uranus_bigtts",
    label: "亲切女声 2.0 · 女",
    hint: "近、不端",
    group: "角色女",
    openaiVoice: "marin",
  },
  {
    id: "zh_female_wenjingmaomao_uranus_bigtts",
    label: "文静毛毛 2.0 · 女",
    hint: "安静、清楚",
    group: "角色女",
    openaiVoice: "shimmer",
  },
  {
    id: "zh_female_zhixingnv_uranus_bigtts",
    label: "知性女声 2.0 · 女",
    hint: "讲道理、不甜腻",
    group: "角色女",
    openaiVoice: "sage",
  },
  {
    id: "zh_female_qingchezizi_uranus_bigtts",
    label: "清澈梓梓 2.0 · 女",
    hint: "干净年轻女声",
    group: "角色女",
    openaiVoice: "shimmer",
  },
  {
    id: "zh_female_tianmeiyueyue_uranus_bigtts",
    label: "悦悦 2.0 · 女 · 甜",
    hint: "偏甜，短视频可以",
    group: "角色女",
    openaiVoice: "fable",
  },
  {
    id: "zh_female_roumeinvyou_uranus_bigtts",
    label: "柔美女友 2.0 · 女",
    hint: "软、近",
    group: "角色女",
    openaiVoice: "marin",
  },
  {
    id: "zh_female_wenrouxiaoya_uranus_bigtts",
    label: "温柔小雅 2.0 · 女",
    hint: "稳、软",
    group: "角色女",
    openaiVoice: "marin",
  },
  {
    id: "zh_female_wuzetian_uranus_bigtts",
    label: "武则天 2.0 · 女",
    hint: "古装女帝",
    group: "角色女",
    openaiVoice: "verse",
  },
  {
    id: "zh_female_gujie_uranus_bigtts",
    label: "顾姐 2.0 · 女",
    hint: "利落姐感",
    group: "角色女",
    openaiVoice: "coral",
  },
  {
    id: "zh_male_linjiananhai_uranus_bigtts",
    label: "邻家男孩 2.0 · 男",
    hint: "近、年轻",
    group: "角色男",
    openaiVoice: "echo",
  },
  {
    id: "zh_male_ruyaqingnian_uranus_bigtts",
    label: "儒雅青年 2.0 · 男",
    hint: "稳、适合小说男主",
    group: "角色男",
    openaiVoice: "onyx",
  },
  {
    id: "zh_male_qingcang_uranus_bigtts",
    label: "擎苍 2.0 · 男",
    hint: "沉、有戏",
    group: "角色男",
    openaiVoice: "onyx",
  },
  {
    id: "zh_male_wennuanahu_uranus_bigtts",
    label: "温暖阿虎 2.0 · 男",
    hint: "暖、实在",
    group: "角色男",
    openaiVoice: "cedar",
  },
  {
    id: "zh_male_aojiaobazong_uranus_bigtts",
    label: "傲娇霸总 2.0 · 男",
    hint: "短剧男主",
    group: "角色男",
    openaiVoice: "onyx",
  },
  {
    id: "zh_male_fanjuanqingnian_uranus_bigtts",
    label: "反卷青年 2.0 · 男",
    hint: "松、像吐槽",
    group: "角色男",
    openaiVoice: "echo",
  },
  {
    id: "zh_male_huolixiaoge_uranus_bigtts",
    label: "活力小哥 2.0 · 男",
    hint: "亮、快",
    group: "角色男",
    openaiVoice: "echo",
  },
  {
    id: "zh_male_baqiqingshu_uranus_bigtts",
    label: "霸气青叔 2.0 · 男",
    hint: "沉、适合有声书",
    group: "角色男",
    openaiVoice: "onyx",
  },
  {
    id: "zh_male_gaolengchenwen_uranus_bigtts",
    label: "高冷沉稳 2.0 · 男",
    hint: "低、稳",
    group: "角色男",
    openaiVoice: "ash",
  },
  {
    id: "zh_male_kailangdidi_uranus_bigtts",
    label: "开朗弟弟 2.0 · 男",
    hint: "年轻、亮",
    group: "角色男",
    openaiVoice: "echo",
  },
  {
    id: "zh_male_kuailexiaodong_uranus_bigtts",
    label: "快乐小东 2.0 · 男",
    hint: "轻快男声",
    group: "角色男",
    openaiVoice: "echo",
  },
  {
    id: "zh_male_kailangxuezhang_uranus_bigtts",
    label: "开朗学长 2.0 · 男",
    hint: "热络、年轻",
    group: "角色男",
    openaiVoice: "echo",
  },
  {
    id: "zh_male_youyoujunzi_uranus_bigtts",
    label: "悠悠君子 2.0 · 男",
    hint: "缓、文",
    group: "角色男",
    openaiVoice: "ash",
  },
  {
    id: "zh_male_qingshuangnanda_uranus_bigtts",
    label: "清爽男大 2.0 · 男",
    hint: "干净年轻男声",
    group: "角色男",
    openaiVoice: "echo",
  },
  {
    id: "zh_male_yuanboxiaoshu_uranus_bigtts",
    label: "渊博小叔 2.0 · 男",
    hint: "讲知识、稳",
    group: "角色男",
    openaiVoice: "onyx",
  },
  {
    id: "zh_male_yangguangqingnian_uranus_bigtts",
    label: "阳光青年 2.0 · 男",
    hint: "亮、正",
    group: "角色男",
    openaiVoice: "echo",
  },
  {
    id: "zh_male_wenrouxiaoge_uranus_bigtts",
    label: "温柔小哥 2.0 · 男",
    hint: "软一点的男声",
    group: "角色男",
    openaiVoice: "cedar",
  },
  {
    id: "zh_male_dongfanghaoran_uranus_bigtts",
    label: "东方浩然 2.0 · 男",
    hint: "正、适合旁白男声",
    group: "角色男",
    openaiVoice: "onyx",
  },
  {
    id: "zh_male_silang_uranus_bigtts",
    label: "四郎 2.0 · 男",
    hint: "角色男声",
    group: "角色男",
    openaiVoice: "onyx",
  },
  {
    id: "zh_male_lanyinmianbao_uranus_bigtts",
    label: "懒音绵宝 2.0 · 男",
    hint: "懒、拖一点",
    group: "角色男",
    openaiVoice: "ash",
  },
  {
    id: "ICL_uranus_zh_female_linjuayi_tob",
    label: "邻居阿姨 2.0 · 女 · 中年",
    hint: "街坊阿姨音，适合中年女声",
    group: "老年人",
    openaiVoice: "marin",
  },
  {
    id: "zh_male_jieshuoxiaoming_uranus_bigtts",
    label: "解说小明 2.0 · 男 · 旁白",
    hint: "视频解说",
    group: "旁白",
    openaiVoice: "echo",
  },
  {
    id: "zh_male_yizhipiannan_uranus_bigtts",
    label: "译制片男 2.0 · 旁白",
    hint: "老译制片腔",
    group: "旁白",
    openaiVoice: "onyx",
  },
  {
    id: "zh_female_tvbnv_uranus_bigtts",
    label: "TVB女声 2.0 · 旁白",
    hint: "港剧旁白感",
    group: "旁白",
    openaiVoice: "sage",
  },
  {
    id: "zh_male_xuanyijieshuo_uranus_bigtts",
    label: "悬疑解说 2.0 · 男 · 旁白",
    hint: "压、适合故事",
    group: "旁白",
    openaiVoice: "ash",
  },
  {
    id: "zh_male_cixingjieshuonan_uranus_bigtts",
    label: "磁性解说 2.0 · 男 · 旁白",
    hint: "低、清楚",
    group: "旁白",
    openaiVoice: "ash",
  },
  {
    id: "zh_male_guanggaojieshuo_uranus_bigtts",
    label: "广告解说 2.0 · 男 · 旁白",
    hint: "卖货口播",
    group: "旁白",
    openaiVoice: "onyx",
  },
  {
    id: "zh_female_xinlingjitang_uranus_bigtts",
    label: "心灵鸡汤 2.0 · 女 · 旁白",
    hint: "温、有停顿",
    group: "旁白",
    openaiVoice: "ballad",
  },
  {
    id: "zh_female_xiaoxue_uranus_bigtts",
    label: "儿童绘本 2.0 · 女 · 旁白",
    hint: "讲给小孩听",
    group: "旁白",
    openaiVoice: "fable",
  },
  {
    id: "zh_female_shaoergushi_uranus_bigtts",
    label: "少儿故事 2.0 · 女 · 旁白",
    hint: "故事腔",
    group: "旁白",
    openaiVoice: "fable",
  },
  {
    id: "zh_female_peiqi_uranus_bigtts",
    label: "佩奇猪 2.0 · 卡通",
    hint: "动画片配音，播客对谈别用",
    group: "卡通",
    openaiVoice: "fable",
  },
  {
    id: "zh_male_sunwukong_uranus_bigtts",
    label: "猴哥 2.0 · 男 · 卡通",
    hint: "孙悟空，故事可以",
    group: "卡通",
    openaiVoice: "echo",
  },
  {
    id: "zh_male_xionger_uranus_bigtts",
    label: "熊二 2.0 · 男 · 卡通",
    hint: "动画片男声",
    group: "卡通",
    openaiVoice: "echo",
  },
  {
    id: "zh_female_yingtaowanzi_uranus_bigtts",
    label: "樱桃丸子 2.0 · 女 · 卡通",
    hint: "动漫女声",
    group: "卡通",
    openaiVoice: "fable",
  },
  {
    id: "zh_male_naiqimengwa_uranus_bigtts",
    label: "奶气萌娃 2.0 · 童声",
    hint: "小孩声",
    group: "卡通",
    openaiVoice: "fable",
  },
  {
    id: "zh_male_liangsangmengzai_uranus_bigtts",
    label: "亮嗓萌仔 2.0 · 童声",
    hint: "亮、小孩",
    group: "卡通",
    openaiVoice: "echo",
  },
  {
    id: "zh_male_tiancaitongsheng_uranus_bigtts",
    label: "天才童声 2.0",
    hint: "童声解说",
    group: "卡通",
    openaiVoice: "echo",
  },
  {
    id: "zh_male_lubanqihao_uranus_bigtts",
    label: "鲁班七号 2.0 · 卡通",
    hint: "游戏角色声",
    group: "卡通",
    openaiVoice: "echo",
  },
  {
    id: "zh_male_tangseng_uranus_bigtts",
    label: "唐僧 2.0 · 男 · 卡通",
    hint: "西游记",
    group: "卡通",
    openaiVoice: "ash",
  },
  {
    id: "zh_male_zhuangzhou_uranus_bigtts",
    label: "庄周 2.0 · 男 · 卡通",
    hint: "游戏角色",
    group: "卡通",
    openaiVoice: "ash",
  },
  {
    id: "zh_male_zhubajie_uranus_bigtts",
    label: "猪八戒 2.0 · 男 · 卡通",
    hint: "西游记",
    group: "卡通",
    openaiVoice: "cedar",
  },
  {
    id: "zh_female_chunribu_uranus_bigtts",
    label: "春日部姐姐 2.0 · 卡通",
    hint: "动漫女声",
    group: "卡通",
    openaiVoice: "nova",
  },
  {
    id: "zh_female_nvleishen_uranus_bigtts",
    label: "女雷神 2.0 · 卡通",
    hint: "角色女声",
    group: "卡通",
    openaiVoice: "verse",
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
export const DEFAULT_MALE_CHARACTER_VOICE = "zh_male_m191_uranus_bigtts";
export const DEFAULT_FEMALE_CHARACTER_VOICE = "zh_female_xiaohe_uranus_bigtts";
export const DEFAULT_NARRATOR_VOICE = "zh_male_ruyayichen_uranus_bigtts";

export type CharacterGender = "male" | "female";

const MALE_NAME_TAIL =
  /[生哥叔伯爷父爸公郎弟仔君侯帝雄强伟军辉鹏磊浩轩宇杰峰涛刚勇斌波超飞龙凯博泽睿阳洋成德武义礼信介]$/;
const FEMALE_NAME_TAIL =
  /[姐妹姨奶妈娘姑嫂妞花芳娟婷丽娜雪梅玲雯欣悦敏静燕红霞兰满英玉珍琴萍凤娥香荷莲菊月秋佳怡妍婉慧淑芬蓉薇茜琳琪颖妮娇媚媛]$/;

export function inferCharacterGender(input: {
  gender?: string | null;
  name?: string;
  look?: string;
  role?: string;
}): CharacterGender | null {
  const explicit = `${input.gender || ""}`.trim();
  if (/^(男|male|m)$/i.test(explicit)) return "male";
  if (/^(女|female|f)$/i.test(explicit)) return "female";

  const blob = `${input.role || ""} ${input.look || ""}`.replace(/\s+/g, "");
  if (
    /女性|女声|女士|女子|女孩|少女|姑娘|女人|女主|女配|女同学|女同事|女医生|女老师|女职员|老太|老奶|婆婆|她是|一位女/.test(
      blob,
    )
  ) {
    return "female";
  }
  if (
    /男性|男声|男士|男子|男孩|少年|男人|男主|男配|大叔|老爷|大爷|老汉|老翁|老臣|公子|他是|一位男/.test(
      blob,
    )
  ) {
    return "male";
  }

  const name = (input.name || "").trim();
  if (/小姐|姑娘|女士|太太/.test(name) || FEMALE_NAME_TAIL.test(name)) {
    return "female";
  }
  if (/先生|大叔|大爷|少爷/.test(name) || MALE_NAME_TAIL.test(name)) {
    return "male";
  }
  return null;
}

function voiceFitScore(
  voice: TtsVoiceOption,
  look: string,
  name = "",
): number {
  const text = `${look} ${voice.label} ${voice.hint}`;
  const who = `${look} ${name}`;
  let score = 0;
  if (/阁老|首辅|权臣|大人|官袍/.test(who) && /幽默|大爷/.test(`${voice.label}${voice.hint}`)) {
    score -= 12;
  }
  if (/阁老|首辅|权臣/.test(who) && voice.group === "角色男" && /稳|低|配音/.test(text)) {
    score += 6;
  }
  if (
    /老年|年长|老人|长者|老太|老奶|婆婆|大爷|爷爷|奶奶|老汉|老翁|花白|白发|白须/.test(
      who,
    ) &&
    !/阁老|首辅|权臣/.test(who) &&
    voice.group === "老年人"
  ) {
    score += 8;
  }
  if (voice.group === "角色男") {
    if (/少年|年轻|小伙/.test(look) && /少年|年轻/.test(text)) score += 3;
    if (/稳|中年|大叔|沉/.test(look) && /稳|低/.test(text)) score += 2;
  }
  if (voice.group === "角色女") {
    if (/甜|软|年轻|少女/.test(look) && /甜|软|近|年轻/.test(text)) score += 3;
    if (/知性|成熟|职场/.test(look) && /知性|成熟/.test(text)) score += 2;
  }
  return score;
}

export function pickCharacterVoice(input: {
  gender?: string | null;
  name?: string;
  look?: string;
  role?: string;
  used?: Iterable<string>;
}): string {
  const gender = inferCharacterGender(input);
  const used = new Set(
    [...(input.used || [])]
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .map((id) => resolveVoiceId(id)),
  );
  const pool = TTS_VOICE_OPTIONS.filter((row) => {
    const rowGender = voiceGender(row.id);
    if (gender && rowGender && rowGender !== gender) return false;
    if (gender === "male") {
      return row.group === "角色男" || row.group === "老年人";
    }
    if (gender === "female") {
      return row.group === "角色女" || row.group === "老年人";
    }
    return (
      row.group === "角色女" ||
      row.group === "角色男" ||
      row.group === "老年人"
    );
  });
  const unused = pool.filter((row) => !used.has(row.id));
  const candidates = unused.length ? unused : pool;
  const look = input.look || "";
  const ranked = [...candidates].sort(
    (a, b) =>
      voiceFitScore(b, look, input.name) - voiceFitScore(a, look, input.name),
  );
  if (ranked[0]) return ranked[0].id;
  if (gender === "male") return DEFAULT_MALE_CHARACTER_VOICE;
  return DEFAULT_FEMALE_CHARACTER_VOICE;
}

/** ICL 说书音色演不了戏，对白出声时换成同性别的 2.0 角色声。 */
export function actingVoiceId(id?: string): string {
  const raw = id?.trim() || "";
  if (isCustomVoiceId(raw)) return raw;
  const voice = resolveVoiceId(id, DEFAULT_CHARACTER_VOICE);
  if (voice === "ICL_uranus_zh_male_youmodaye_tob") {
    return "zh_male_liufei_uranus_bigtts";
  }
  if (voice === "ICL_uranus_zh_female_heainainai_tob") {
    return "zh_female_popo_uranus_bigtts";
  }
  if (/^ICL_/i.test(voice)) {
    return voiceGender(voice) === "female"
      ? DEFAULT_FEMALE_CHARACTER_VOICE
      : DEFAULT_MALE_CHARACTER_VOICE;
  }
  return voice;
}

/** uranus/saturn 是 2.0，moon/mars 是 1.0。用错模型会合成失败，再落到 OpenAI 就不是这个声了。 */
export function ttsVoiceGeneration(id?: string): "2" | "1" {
  const raw = String(id || "").trim();
  if (/_moon_|_mars_/.test(raw)) return "1";
  if (/uranus|saturn_/i.test(raw)) return "2";
  if (/^ICL_/i.test(raw)) return "1";
  return "2";
}

export function arkTtsModelsForVoice(
  id?: string,
  preferred?: string,
): string[] {
  const gen = ttsVoiceGeneration(id);
  const models =
    gen === "1"
      ? ["doubao-seed-tts-1.0", "seed-tts-1.0"]
      : ["doubao-seed-tts-2.0", "seed-tts-2.0"];
  const raw = String(preferred || process.env.ARK_TTS_MODEL || "").trim();
  const pref = raw === "seed-tts-2.0-expressive" ? "doubao-seed-tts-2.0" : raw;
  if (!pref || /gpt-|openai/i.test(pref)) return models;
  const prefGen = /1\.0/.test(pref) ? "1" : "2";
  if (prefGen !== gen) return models;
  return [pref, ...models.filter((row) => row !== pref)];
}

export function voiceGender(id?: string): CharacterGender | null {
  const voice = TTS_VOICE_OPTIONS.find((row) => row.id === resolveVoiceId(id, ""));
  if (!voice) return null;
  if (voice.group === "角色男") return "male";
  if (voice.group === "角色女") return "female";
  if (/zh_male_|_male_|en_male_/i.test(voice.id)) return "male";
  if (/zh_female_|_female_|en_female_/i.test(voice.id)) return "female";
  if (/男|大爷|爷爷|叔/.test(voice.label)) return "male";
  if (/女|奶|婆/.test(voice.label)) return "female";
  return null;
}

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
  if (isCustomVoiceId(raw)) return raw;
  const mapped = TTS_VOICE_ALIASES[raw] || raw || fallback;
  if (TTS_VOICE_OPTIONS.some((v) => v.id === mapped)) return mapped;
  if (isCustomVoiceId(fallback)) return fallback;
  if (TTS_VOICE_OPTIONS.some((v) => v.id === fallback)) return fallback;
  return TTS_VOICE_OPTIONS[0].id;
}

export function isNarratorSpeaker(value?: string): boolean {
  const raw = (value || "").trim();
  return !raw || /^(narrator|旁白|画外音)$/i.test(raw);
}

function normalizeSpeakerName(value: string): string {
  return value.replace(/[「」『』""''（）()\s]/g, "").toLowerCase();
}

function namesMatch(a: string, b: string): boolean {
  const x = normalizeSpeakerName(a);
  const y = normalizeSpeakerName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function matchCastBySpeaker<T extends { id: string; name: string }>(
  name: string,
  cast: T[],
): T | undefined {
  const hits = cast.filter((row) => namesMatch(row.name, name));
  if (hits.length === 0) return undefined;
  if (hits.length === 1) return hits[0];
  return [...hits].sort((a, b) => b.name.length - a.name.length)[0];
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
    const hit = matchCastBySpeaker(name, cast);
    if (hit) return hit.id;
    return `name:${normalizeSpeakerName(name)}`;
  }
  if (isNarratorSpeaker(name) && name) return NARRATOR_SPEAKER_ID;
  if (speakMode === "dialogue" && cast[0]) return cast[0].id;
  return NARRATOR_SPEAKER_ID;
}

function takeCharacterVoice(
  used: Set<string>,
  hint?: { name?: string; look?: string; gender?: string | null },
): string {
  const pick = pickCharacterVoice({ ...hint, used });
  used.add(pick);
  return pick;
}

export function lockEpisodeVoices<
  T extends {
    speakerId?: string;
    speaker?: string;
    voiceId?: string;
  },
>(
  shots: T[],
  input: {
    speakMode?: string;
    narratorVoiceId?: string;
    cast?: Array<{ id: string; name: string; voice_id?: string }>;
  },
): Array<T & { speakerId: string; speaker: string; voiceId: string }> {
  const cast = input.cast || [];
  const used = new Set<string>();
  const narrator = resolveVoiceId(input.narratorVoiceId, DEFAULT_NARRATOR_VOICE);
  used.add(narrator);
  const bySpeaker = new Map<string, string>();
  bySpeaker.set(NARRATOR_SPEAKER_ID, narrator);

  for (const person of cast) {
    if (!person.voice_id?.trim()) continue;
    const voice = resolveVoiceId(person.voice_id, DEFAULT_CHARACTER_VOICE);
    bySpeaker.set(person.id, voice);
    used.add(voice);
  }

  for (const shot of shots) {
    const speakerId = resolveShotSpeakerId(shot, cast, input.speakMode);
    if (bySpeaker.has(speakerId)) continue;
    const existing = shot.voiceId?.trim();
    if (existing) {
      const voice = resolveVoiceId(existing, DEFAULT_CHARACTER_VOICE);
      bySpeaker.set(speakerId, voice);
      used.add(voice);
    }
  }

  for (const person of cast) {
    if (bySpeaker.has(person.id)) continue;
    bySpeaker.set(person.id, takeCharacterVoice(used, { name: person.name }));
  }

  return shots.map((shot) => {
    const speakerId = resolveShotSpeakerId(shot, cast, input.speakMode);
    if (!bySpeaker.has(speakerId)) {
      bySpeaker.set(
        speakerId,
        takeCharacterVoice(used, { name: shot.speaker }),
      );
    }
    const voiceId = bySpeaker.get(speakerId) || narrator;
    const speaker =
      speakerId === NARRATOR_SPEAKER_ID
        ? "旁白"
        : cast.find((c) => c.id === speakerId)?.name ||
          shot.speaker ||
          "旁白";
    return { ...shot, speakerId, speaker, voiceId };
  });
}

export function resolveShotVoiceId(
  shot: { speakerId?: string; speaker?: string; voiceId?: string },
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
  if (person?.voice_id?.trim()) {
    return resolveVoiceId(person.voice_id, DEFAULT_CHARACTER_VOICE);
  }
  if (shot.voiceId?.trim()) {
    return resolveVoiceId(shot.voiceId, DEFAULT_CHARACTER_VOICE);
  }
  return resolveVoiceId(undefined, DEFAULT_CHARACTER_VOICE);
}
