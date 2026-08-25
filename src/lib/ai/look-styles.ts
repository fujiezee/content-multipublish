export type LookStyleId = string;

export type LookStyle = {
  id: LookStyleId;
  label: string;
  hint: string;
  group: string;
  preview: string;
  tested?: boolean;
  still: string;
  video: string;
  visualHint: string;
  stillAlias: string;
  roleWord: string;
};

const PAINT =
  "皮肤是画的：没有毛孔、没有照片噪点、没有相机实拍。有参考图就跟参考图的人，不要另起一张脸。";

function look(input: {
  id: string;
  label: string;
  hint: string;
  group: string;
  stillAlias: string;
  still: string;
  visualHint: string;
  videoExtra?: string;
  tested?: boolean;
}): LookStyle {
  return {
    id: input.id,
    label: input.label,
    hint: input.hint,
    group: input.group,
    preview: `/look-styles/${input.id}.jpg`,
    tested: input.tested,
    stillAlias: input.stillAlias,
    roleWord: `${input.stillAlias}角色`,
    still: `${input.still}${PAINT}`,
    video: [
      `竖屏 9:16 ${input.stillAlias}短剧。画风必须和参考图一致${input.videoExtra ? `：${input.videoExtra}` : ""}，不要改成实拍，不要换脸，不要另起一张脸。`,
      "人、衣服、场跟参考图是同一套。",
    ].join(""),
    visualHint: input.visualHint,
  };
}

export const LOOK_STYLE_GROUPS = [
  "已测过审",
  "流量王炸",
  "治愈美学",
  "东方意境",
  "电影叙事",
] as const;

export const LOOK_STYLES: LookStyle[] = [
  look({
    id: "semi",
    label: "精致半写实",
    hint: "锁脸也稳",
    group: "已测过审",
    stillAlias: "半写实插画",
    tested: true,
    still:
      "精致半写实商业插画，真人比例，五官清楚，像个活人。柔和数字绘画光影，不是二次元大眼睛，不是赛璐璐平涂，不是卡通变形。",
    visualHint:
      "画面按半写实插画写：写清谁在哪、穿什么、什么表情、什么光。像个活人，但是画的，不要写成实拍，也不要写成动画片。",
  }),
  look({
    id: "dark",
    label: "暗黑厚涂",
    hint: "黑金硬光",
    group: "已测过审",
    stillAlias: "暗黑厚涂",
    videoExtra: "黑金、硬光、底近黑",
    tested: true,
    still:
      "暗黑厚涂漫剧，黑金风。底近黑，一束硬光打在脸和手上，饱和度低。颜色偏墨黑、暗紫、暗金，不要画成大白天。精致半写实，真人比例，五官清楚，像个活人。不是二次元大眼睛，不是赛璐璐平涂，不是卡通变形。",
    visualHint:
      "画面按暗黑厚涂写：夜或硬光，底近黑，写清谁在哪、穿什么、什么表情。像个活人，但是画的，不要写成大白天，不要写成实拍。",
  }),
  look({
    id: "cinema",
    label: "电影静帧",
    hint: "像拍戏；不要锁旧写实脸",
    group: "已测过审",
    stillAlias: "电影静帧",
    tested: true,
    still:
      "电影静帧，现场光，浅景深，像拍戏。真人比例，骨骼清楚，五官准，脸和手有体积，布料有褶皱和重量。不是二次元大眼睛，不是赛璐璐平涂，不是卡通变形。",
    visualHint:
      "画面按电影静帧写：现场光、浅景深，像拍戏，但是画的。写清谁在哪、穿什么、什么表情。不要写成实拍照片，也不要写成动画片。",
  }),
  look({
    id: "cel",
    label: "赛璐璐日漫",
    hint: "描线平涂，热血冒险",
    group: "流量王炸",
    stillAlias: "赛璐璐日漫",
    still:
      "赛璐璐日漫，2D 清晰描线，平涂色块，少量赛璐璐高光。热血少年漫剧，像火影、海贼王的电视动画帧，不是厚涂，不是写实。",
    visualHint:
      "画面按赛璐璐日漫写：清晰描线、平涂色块。写清谁在哪、穿什么、什么表情。不要写成厚涂，不要写成实拍。",
  }),
  look({
    id: "cyber",
    label: "赛博朋克",
    hint: "霓虹义体，科幻悬疑",
    group: "流量王炸",
    stillAlias: "赛博朋克",
    still:
      "赛博朋克，霓虹品红与青，高对比硬光，雨湿反光，义体和全息边光。科幻悬疑漫剧，像攻壳、边缘行者，不是白天古装。",
    visualHint:
      "画面按赛博朋克写：霓虹、湿地面、义体边光。写清谁在哪、穿什么、什么表情。不要写成大白天，不要写成实拍。",
  }),
  look({
    id: "chibi",
    label: "Q版超变形",
    hint: "大头小身，搞笑日常",
    group: "流量王炸",
    stillAlias: "Q版超变形",
    still:
      "Q版超变形，大头小身，2到3头身，五官简化，表情夸张。搞笑日常漫剧，可爱变形，不是真人比例。",
    visualHint:
      "画面按Q版写：大头小身，表情夸张。写清谁在哪、穿什么。不要写成真人比例，不要写成实拍。",
  }),
  look({
    id: "arcane",
    label: "美漫厚涂",
    hint: "硬朗体积，暗黑热血",
    group: "流量王炸",
    stillAlias: "美漫厚涂",
    still:
      "美漫厚涂，硬朗描边，3D体积光影，暗金与深紫，哥特细节。暗黑热血漫剧，像双城之战，不是二次元大眼睛，不是照片。",
    visualHint:
      "画面按美漫厚涂写：硬边、体积光、暗金。写清谁在哪、穿什么、什么表情。不要写成二次元，不要写成实拍。",
  }),
  look({
    id: "spider",
    label: "波普美漫",
    hint: "粗线撞色，潮酷少年",
    group: "流量王炸",
    stillAlias: "波普美漫",
    still:
      "波普美漫，粗墨线，半调网点，高饱和撞色拼贴，偏移套印。潮酷少年漫剧，像蜘蛛侠平行宇宙，不是写实。",
    visualHint:
      "画面按波普美漫写：粗线、撞色、网点。写清谁在哪、穿什么、什么表情。不要写成写实，不要写成实拍。",
  }),
  look({
    id: "magical",
    label: "魔法少女",
    hint: "星光缎带，变身漫剧",
    group: "流量王炸",
    stillAlias: "魔法少女",
    still:
      "魔法少女，梦幻粉紫，星光闪光特效，缎带与水晶。少女变身漫剧，像美少女战士，明亮可爱，不是暗黑。",
    visualHint:
      "画面按魔法少女写：粉紫、星光、缎带。写清谁在哪、穿什么、什么表情。不要写成暗黑，不要写成实拍。",
  }),
  look({
    id: "vhs",
    label: "90年代复古",
    hint: "暖黄录像带",
    group: "流量王炸",
    stillAlias: "90年代复古",
    still:
      "90年代复古，暖黄偏色，轻微VHS扫描线和柔焦，旧动画录像带质感。怀旧青春漫剧，不是高清写实。",
    visualHint:
      "画面按90年代复古写：暖黄、柔焦、旧录像带。写清谁在哪、穿什么、什么表情。不要写成高清写实。",
  }),
  look({
    id: "meme",
    label: "沙雕表情包",
    hint: "夸张简笔吐槽",
    group: "流量王炸",
    stillAlias: "沙雕表情包",
    still:
      "沙雕表情包，火柴人夸张变形，头顶冒烟，简笔加巨大表情。搞笑吐槽漫剧，像网络梗图，不是精致插画。",
    visualHint:
      "画面按沙雕表情包写：简笔、夸张表情。写清谁在做啥。不要写成精致插画，不要写成实拍。",
  }),
  look({
    id: "ghibli",
    label: "吉卜力",
    hint: "手绘水彩，治愈日常",
    group: "治愈美学",
    stillAlias: "吉卜力手绘",
    still:
      "吉卜力手绘，自然水彩晕染，温柔空气感，手绘背景。治愈日常漫剧，像龙猫、千与千寻，不是赛璐璐平涂，不是照片。",
    visualHint:
      "画面按吉卜力手绘写：温柔水彩、空气感。写清谁在哪、穿什么、什么光。不要写成赛璐璐，不要写成实拍。",
  }),
  look({
    id: "shinkai",
    label: "新海诚",
    hint: "通透光影，青春恋爱",
    group: "治愈美学",
    stillAlias: "新海诚电影风",
    still:
      "新海诚电影风，光影通透，丁达尔光柱，壁纸级天空和反射。青春恋爱漫剧，像你的名字，仍然是画，不是实拍。",
    visualHint:
      "画面按新海诚风写：通透光、丁达尔、反射。写清谁在哪、穿什么、什么表情。仍然是画，不要写成实拍。",
  }),
  look({
    id: "ln",
    label: "轻小说插画",
    hint: "俊美柔色，校园恋爱",
    group: "治愈美学",
    stillAlias: "轻小说插画",
    still:
      "轻小说插画，人物俊美，色彩柔和，背景虚化，精致二次元商业插画。校园恋爱漫剧，像刀剑神域封面，不是照片。",
    visualHint:
      "画面按轻小说插画写：人物俊美、背景虚化。写清谁在哪、穿什么、什么表情。不要写成实拍。",
  }),
  look({
    id: "felt",
    label: "羊毛毡定格",
    hint: "毛绒针扎，萌宠亲子",
    group: "治愈美学",
    stillAlias: "羊毛毡定格",
    still:
      "羊毛毡定格，手工毛绒纤维质感，柔软针扎痕迹，微缩场景。萌宠亲子漫剧，明显是毡出来的，不是真人。",
    visualHint:
      "画面按羊毛毡定格写：毛绒、针扎、微缩。写清谁在哪。明显是毡的，不要写成真人。",
  }),
  look({
    id: "paper",
    label: "立体纸雕",
    hint: "层纸镂空，童话回忆",
    group: "治愈美学",
    stillAlias: "立体纸雕",
    still:
      "立体纸雕，层层彩纸镂空，边缘清晰，光从层缝穿透。童话回忆漫剧，像小王子纸剧场，不是厚涂。",
    visualHint:
      "画面按立体纸雕写：层纸、镂空、透光。写清谁在哪。不要写成厚涂，不要写成实拍。",
  }),
  look({
    id: "watercolor",
    label: "水彩",
    hint: "晕染留白，文艺诗意",
    group: "治愈美学",
    stillAlias: "水彩画",
    still:
      "水彩画，透明晕染，轻盈湿笔，自然留白。文艺诗意漫剧，纸上水彩，不是数码厚涂，不是照片。",
    visualHint:
      "画面按水彩写：晕染、湿笔、留白。写清谁在哪、穿什么。不要写成厚涂，不要写成实拍。",
  }),
  look({
    id: "shangmei",
    label: "上美水墨",
    hint: "晕染留白，国风武侠",
    group: "东方意境",
    stillAlias: "上美水墨",
    still:
      "上海美影水墨动画，水墨晕染，留白写意，略带戏曲造型。国风武侠漫剧，像大闹天宫、山水情，不是工笔，不是写实。",
    visualHint:
      "画面按上美水墨写：晕染、留白、戏曲造型。写清谁在哪、穿什么。不要写成工笔细描，不要写成实拍。",
  }),
  look({
    id: "gongbi",
    label: "工笔重彩",
    hint: "游丝描，朱砂石青",
    group: "东方意境",
    stillAlias: "工笔重彩",
    still:
      "国风工笔重彩，精细游丝描，朱砂、石青、金箔薄色。古风神话漫剧，像故宫藏画，平面装饰，不是油画。",
    visualHint:
      "画面按工笔重彩写：游丝描、朱砂石青金。写清谁在哪、穿什么、什么表情。不要写成油画，不要写成实拍。",
  }),
  look({
    id: "xieyi",
    label: "水墨写意",
    hint: "留白焦墨，文人哲理",
    group: "东方意境",
    stillAlias: "水墨写意",
    still:
      "中式水墨写意，大面积留白，焦墨枯笔，一点朱砂。文人哲理漫剧，传统山水人物，抽象写意，不是工笔细描。",
    visualHint:
      "画面按水墨写意写：留白、焦墨、一点朱砂。写清谁在哪。不要写成工笔，不要写成实拍。",
  }),
  look({
    id: "cyber-guo",
    label: "赛博国风",
    hint: "汉服霓虹，国潮科幻",
    group: "东方意境",
    stillAlias: "赛博国风",
    still:
      "赛博朋克国风，汉服轮廓加霓虹全息，机械义肢边光。国潮科幻漫剧，古装和未来叠在一起，不是纯古风，不是实拍。",
    visualHint:
      "画面按赛博国风写：汉服轮廓、霓虹全息。写清谁在哪、穿什么、什么表情。不要写成纯古风，不要写成实拍。",
  }),
  look({
    id: "fantasy",
    label: "厚涂幻想",
    hint: "饱和体积，奇幻史诗",
    group: "电影叙事",
    stillAlias: "厚涂幻想",
    still:
      "厚涂幻想，笔触厚重，光影对比强，色彩饱和。奇幻史诗漫剧，像原神CG，体积扎实但是画的，不是相机实拍。",
    visualHint:
      "画面按厚涂幻想写：厚笔触、强光影、饱和色。写清谁在哪、穿什么、什么表情。是画，不要写成实拍。",
  }),
  look({
    id: "gothic",
    label: "暗黑哥特",
    hint: "尖拱血光，黑暗童话",
    group: "电影叙事",
    stillAlias: "暗黑哥特",
    still:
      "暗黑哥特，深暗色调，尖拱与玫瑰窗，一束血色或冷光。黑暗童话漫剧，像黑执事，不是大白天，不是照片。",
    visualHint:
      "画面按暗黑哥特写：深暗、尖拱、一束冷光或血光。写清谁在哪、穿什么、什么表情。不要写成大白天，不要写成实拍。",
  }),
  look({
    id: "steampunk",
    label: "蒸汽朋克",
    hint: "黄铜齿轮，机械冒险",
    group: "电影叙事",
    stillAlias: "蒸汽朋克",
    still:
      "蒸汽朋克，黄铜齿轮，蒸汽管道，维多利亚皮革与护目镜。冒险机械漫剧，像蒸汽男孩，暖铜光，不是赛博霓虹。",
    visualHint:
      "画面按蒸汽朋克写：黄铜、齿轮、蒸汽。写清谁在哪、穿什么、什么表情。不要写成赛博霓虹，不要写成实拍。",
  }),
  look({
    id: "pixar",
    label: "皮克斯迪士尼",
    hint: "圆润3D，家庭童话",
    group: "电影叙事",
    stillAlias: "皮克斯卡通",
    still:
      "皮克斯迪士尼3D卡通，圆润造型，皮下散射，童话色彩。全年龄家庭漫剧，像冰雪奇缘，明显卡通，不是真人。",
    visualHint:
      "画面按皮克斯卡通写：圆润、童话色。写清谁在哪、穿什么、什么表情。明显卡通，不要写成真人。",
  }),
  look({
    id: "clay",
    label: "黏土定格",
    hint: "手捏指纹，儿童搞笑",
    group: "电影叙事",
    stillAlias: "黏土定格",
    still:
      "黏土定格，手工捏造指纹和接缝，笨拙复古。搞笑儿童漫剧，像小羊肖恩，明显是橡皮泥，不是真人。",
    visualHint:
      "画面按黏土定格写：手捏痕迹、接缝。写清谁在哪。明显是泥，不要写成真人。",
  }),
];

export const DEFAULT_LOOK_STYLE: LookStyleId = "semi";

export function normalizeLookStyle(raw?: string | null): LookStyleId {
  const id = String(raw || "").trim();
  return LOOK_STYLES.some((row) => row.id === id) ? id : DEFAULT_LOOK_STYLE;
}

export function resolveLookStyle(raw?: string | null): LookStyle {
  const id = normalizeLookStyle(raw);
  return LOOK_STYLES.find((row) => row.id === id) || LOOK_STYLES[0];
}

export function lookStyleLabel(raw?: string | null): string {
  return resolveLookStyle(raw).label;
}
