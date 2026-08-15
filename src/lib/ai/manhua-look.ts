/**
 * Seedance 2.0 过审用的统一画风。
 * 角色设定、分镜配图、出片提示共用这一套。
 *
 * 2.0 自己从写实设定画出的半写实插画更像人：真人比例、五官清楚。
 * 赛璐璐/二次元会把脸画飘。实拍照片又会被拒。
 * 目标就卡在中间：精致半写实商业插画，像个人，但明显是画的。
 */
export const MANHUA_STYLE = [
  "精致半写实商业插画，真人比例，五官清楚，像个活人。",
  "柔和数字绘画光影，不是二次元大眼睛，不是赛璐璐平涂，不是卡通变形。",
  "皮肤是画的：没有毛孔、没有照片噪点、没有相机实拍。",
].join("");

export const MANHUA_NO_MARK = "无水印、无文字、无 logo、无网址、无字幕。";

/** 旧剧本常带「写实风格」，会把分镜拉回真人脸。出图前先清掉。 */
export function stripPhotoLook(text: string): string {
  return text
    .replace(/写实风格|写实风|超写实|照片级|真人实拍|实拍风格/g, "半写实插画")
    .replace(/\bphotoreal(?:istic)?\b/gi, "semi-realistic illustration")
    .replace(/赛璐璐|二次元|卡通变形/g, "半写实插画")
    .replace(/电影人像|皮肤毛孔|皮肤纹理/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function manhuaCharacterPrompt(input: {
  who: string;
  look?: string;
  view: string;
  phase: "from-photo" | "from-lock" | "from-text";
}): string {
  const who = input.who.trim() || "这个人";
  const look = input.look?.trim() || "";
  const head =
    input.phase === "from-photo"
      ? `根据参考照片画同一个人的精致半写实商业插画，${input.view}。五官按真人比例，脸要清楚、能认出来就是照片里的这个人。眼镜、胡子、发型、衣服、围巾必须留下，不要换脸、不要换装。照片只用来认人，不要复刻成照片。`
      : input.phase === "from-lock"
        ? `根据角色设定图生成同一个人，${input.view}。必须和参考图是同一个人，衣服发型不能换，画风保持半写实插画。`
        : `根据文字设定画一个精致半写实商业插画角色，${input.view}。`;
  return [
    head,
    `角色叫「${who}」。`,
    look ? `外形：${look}` : "",
    MANHUA_STYLE,
    "竖版 3:4，干净浅底。表情自然，不要僵硬站桩。",
    MANHUA_NO_MARK,
    "只出一张图。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function manhuaScenePrompt(input: {
  who?: string;
  visual: string;
  imagePrompt?: string;
  voiceover?: string;
}): string {
  const who = input.who?.trim() || "";
  const visual = stripPhotoLook(input.visual || "");
  const imagePrompt = stripPhotoLook(input.imagePrompt || "");
  return [
    "竖屏 9:16 半写实插画分镜，后面要拿去给 Seedance 2.0 出片。",
    MANHUA_STYLE,
    "人物上半身和脸必须看清，表情自然，像在跟人说话。",
    "参考图只用来认人（眼镜、围巾、发型、衣服、脸型），画风跟设定图走，不要复刻成照片。",
    MANHUA_NO_MARK,
    who
      ? `出镜的人是${who}，必须和角色设定图是同一些人，不要换脸、不要加新人。`
      : "出镜用一个稳定的半写实插画角色，五官清楚，像个人。",
    visual ? `画面：${visual}` : "",
    imagePrompt ? `构图：${imagePrompt}` : "",
    input.voiceover ? `这镜在讲：${input.voiceover.slice(0, 60)}` : "",
    MANHUA_STYLE,
    "只出一张图。",
  ]
    .filter(Boolean)
    .join("\n");
}

export const MANHUA_VIDEO_STYLE = [
  "竖屏 9:16 半写实商业插画短剧，画风必须和参考图一致：真人比例、五官清楚，不要改成实拍，也不要改成二次元。",
  "必须按参考图出人：场景构图跟场景参考图走，人物脸和衣服跟角色参考图是同一个人，不要换脸、不要另造一张脸。",
  "不要水印，不要 logo，不要屏幕字幕。",
].join("\n");
