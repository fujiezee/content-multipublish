import {
  actingSpeechText,
  applyShotEmotionGrammar,
  ensureTalkHookVisual,
  shotSpeaksFromStart,
  applyShotEmotionPatches,
  emotionFaceLine,
  inferSoundRole,
  flowerRepeatsLine,
  isLectureAskLine,
  looksLikeReactionShot,
  normalizeShotBeat,
  parseShotCopyPatch,
  scrubShotFlowers,
  shotSpeakerLockLine,
  speechActLine,
  speechActSpeed,
  speechActTag,
  speechPerformance,
  innerNativeVoiceLine,
  innerSpeechTone,
  innerVoiceWriteRules,
  speechToneLine,
  speechToneSpeed,
  spokenForPlay,
  stripStageDirections,
} from "../src/lib/ai/emotion-beat";
import {
  actingVoiceId,
  arkTtsModelsForVoice,
  pickCharacterVoice,
  ttsVoiceGeneration,
} from "../src/lib/ai/tts-voice-ids";
import { DEFAULT_PODCAST_GUEST_VOICE } from "../src/lib/ai/podcast-shared";
import {
  inferEpisodeWardrobeLock,
  inferShotJoin,
  manhuaScenePrompt,
  shouldReusePrevStart,
  manhuaVideoStyle,
  sceneBlockingLines,
  sceneCastLines,
  sceneCutsAway,
  splitShotBeats,
  stillTalkingHead,
  stripLookClothes,
  stripPhotoLook,
} from "../src/lib/ai/manhua-look";
import {
  extractClothesPhrase,
  extractSeriesWardrobe,
} from "../src/lib/ai/director-lock";
import { normalizeLookStyle, resolveLookStyle } from "../src/lib/ai/look-styles";
import {
  collectDialogueCast,
  guessImportedEpisodeCount,
  leftoverImportedEpisodes,
  looksLikeCharacterName,
  looksLikeImportedScript,
  resolveScriptSourceKind,
} from "../src/lib/ai/script-import";
import { characterHasLook } from "../src/lib/ai/character-look";
import { scriptLlmTokenField } from "../src/lib/ai/script-llm";
import {
  defaultRenderVoicePath,
  durationBudget,
  episodePace,
  hookStyleLine,
  hookStyleLookLine,
  hookStylePremiseLine,
  hookStyleShotContract,
  isShowStyle,
  normalizeHookStyle,
  showEngineMark,
  showKickoffLine,
  videoWaitLimitMs,
  VIDEO_SCRIPT_STYLE_OPTIONS,
} from "../src/lib/ai/video-script-styles";
import { talkTimelineLines } from "../src/lib/ai/shot-constraints";
import { inferShotPlate, keepLocalShotMedia, parseShotPlate, talkHookPlate } from "../src/lib/ai/shot-plate";
import { reviewShotPullSheet } from "../src/lib/ai/shot-qa";
import {
  shotCanAudioDrive,
  shotNeedsLockedSpeech,
  speakShotsMissingLock,
} from "../src/lib/types";
import { reviewDirectedShots } from "../src/lib/ai/shot-agent";
import {
  peopleOnShot,
  planSceneRefs,
  sceneImageLeads,
  sceneRefLook,
  shotRefLoad,
} from "../src/lib/ai/video-scenes";
import { secondsFromAudio } from "../src/lib/ai/shot-speech";
import {
  bindShotsToVoiceover,
  canonicalizeVoiceover,
  endingRules,
  isHollowShot,
  mergeShotsByIndex,
  parseEpisodeList,
  parseSeries,
  repairDialogueTurns,
  rewriteIsUsable,
  scrubShowCopy,
  shotsFromJson,
  shotsHaveScenes,
  shotsMissingFrameApproval,
  splitLabeledTurns,
} from "../src/lib/ai/video-script";
import { removeShot, voiceoverFromShots } from "../src/lib/ai/shot-edit";
import {
  collectScriptCast,
  findScriptIssues,
  relabelScriptTurns,
  scriptTurns,
} from "../src/lib/ai/script-review";
import { captionSource } from "../src/lib/ai/caption-reveal";
import {
  parseInnerLevel,
  resolveInnerVoice,
  resolveVoicePath,
  shotCanLipSync,
  shotInnerLevel,
  shotIsInner,
} from "../src/lib/types";
import {
  dropCastOutlineBlock,
  embedStanceNotes,
  formatCastOutline,
  formatStanceCards,
  isCannedStanceCard,
  parseStanceCards,
  resolveStanceCards,
} from "../src/lib/ai/stance-card";
import {
  defaultRefShotIndex,
  shotEndUrl,
  shotHasKeyframes,
  shotStartUrl,
} from "../src/lib/types";
import { needsDouyinArticleTitleRewrite } from "../src/lib/ai/douyin-title";
import {
  looksLikeManualScriptTitle,
  pickScriptTitle,
} from "../src/lib/ai/copywriting";
import { polishForPlatform } from "../src/lib/content/adapt";

const FULL_VO =
  "她居然在AI里查我？客户说，他们买东西前先问AI，AI没提我们，连官网都懒得搜。你的报表里全是假的。上一世我信了它，三个月后客户全跑了。这回我先改口径，再让他当场搜一次。";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

function check(name: string, voiceover: string, shotCount: number) {
  const ok = voiceover.includes("连官网都懒得搜") && voiceover.length >= 80;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}\n  vo=${voiceover.length}字 shots=${shotCount}\n  ${voiceover.slice(0, 80)}…`,
  );
  if (!ok) {
    throw new Error(`${name}: 口播被截断 → ${voiceover}`);
  }
}

const shortFieldLongShots = {
  title: "GEO效果评估三把新尺",
  episodes: [
    {
      episode_no: 1,
      title: "她居然在AI里查我",
      hook: "她居然在AI里查我？",
      voiceover: "她居然在AI里查我？",
      on_screen: "AI没提我们",
      recap: "当场搜一次",
      next_hook: "下一刀还没砍",
      duration_sec: 90,
      shots: [
        {
          seconds: 10,
          visual: "会议室，女客户盯手机",
          speaker: "客户",
          voiceover: "她居然在AI里查我？",
        },
        {
          seconds: 12,
          visual: "同一场，客户把手机转过来",
          speaker: "客户",
          voiceover: "客户说，他们买东西前先问AI，AI没提我们，连官网都懒得搜。",
        },
        {
          seconds: 10,
          visual: "同一场，男主盯报表",
          speaker: "司马生",
          voiceover: "你的报表里全是假的。",
        },
        {
          seconds: 12,
          visual: "同一场，男主握拳",
          speaker: "司马生",
          voiceover: "上一世我信了它，三个月后客户全跑了。",
        },
        {
          seconds: 12,
          visual: "同一场，男主改口径",
          speaker: "司马生",
          voiceover: "这回我先改口径，再让他当场搜一次。",
        },
      ],
    },
  ],
};

const thinkingThenFull = `先写个钩子：{"hook":"她居然在AI里查我？","voiceover":"她居然在AI里查我？"}
完整剧本如下：
${JSON.stringify(shortFieldLongShots)}`;

const rewriteStub = {
  episode_no: 1,
  title: "第 1 集",
  hook: "你的报表里全是假的",
  voiceover: "你的报表里全是假的。",
  on_screen: "报表是假的",
  shots: [
    {
      seconds: 12,
      visual: "竖屏讲解画面，配合「你的报表里全是假的。」",
      voiceover: "你的报表里全是假的。",
      speaker: "司马生",
    },
  ],
};

const fullField = {
  title: "测试",
  episodes: [
    {
      episode_no: 1,
      title: "她居然在AI里查我",
      hook: "她居然在AI里查我？",
      voiceover: FULL_VO,
      on_screen: "AI没提我们",
      shots: shortFieldLongShots.episodes[0].shots,
    },
  ],
};

function main() {
  const a = parseSeries(JSON.stringify(shortFieldLongShots), "drama", 90);
  check("短字段+长分镜", a.episodes[0].voiceover, a.episodes[0].shots.length);

  const b = parseSeries(thinkingThenFull, "drama", 90);
  check("思考短稿+完整JSON", b.episodes[0].voiceover, b.episodes[0].shots.length);

  const c = parseSeries(JSON.stringify(fullField), "drama", 90);
  check("整集口播已写全", c.episodes[0].voiceover, c.episodes[0].shots.length);
  const withPremise = parseSeries(
    JSON.stringify({
      ...fullField,
      premise:
        "职场穿越。周扬带着上一世被栽赃的记忆回来，第一天就在会上揭穿改过的报价单，现在卡在林总要不要认。",
    }),
    "drama",
    90,
  );
  assert(
    withPremise.premise.includes("穿越") && withPremise.premise.includes("周扬"),
    "系列必须带上剧情介绍",
  );

  const stub = parseEpisodeList(JSON.stringify(rewriteStub), 1, 90)[0];
  assert(stub.voiceover.includes("报表"), "stub should parse");
  console.log(
    `INFO 重写短稿 vo=${stub.voiceover.length}字 shots=${stub.shots.length} 「${stub.voiceover}」`,
  );
  if (stub.voiceover.length < 40) {
    console.log("PASS 重写短稿会被识别成不合格（应用原口播，不能覆盖）");
  }

  const keep = !rewriteIsUsable(stub, c.episodes[0], 90);
  assert(keep, "短重写必须被拒绝，不能盖掉原文");
  console.log("PASS 短重写不会覆盖完整口播");

  const seconds = a.episodes[0].shots.map((s) => s.seconds);
  const uniqueSec = new Set(seconds);
  const sum = seconds.reduce((n, s) => n + s, 0);
  assert(uniqueSec.size >= 2, `分镜秒数必须按对白变化，不能全一样：${seconds.join(",")}`);
  assert(
    !seconds.every((s) => s === 10),
    `禁止每镜都 10 秒：${seconds.join(",")}`,
  );
  assert(
    a.episodes[0].duration_sec === sum,
    `整集秒数应等于分镜合计 ${sum}，实际 ${a.episodes[0].duration_sec}`,
  );
  assert(
    a.episodes[0].shots.length === 5,
    `应按句子分镜，不要为凑 90 秒拆成 8–9 镜，实际 ${a.episodes[0].shots.length}`,
  );
  assert(sum <= 90, `合计不应为凑满而超过预算：${sum}`);
  console.log(
    `PASS 分镜按对白计时 seconds=${seconds.join("+")}=${sum} duration_sec=${a.episodes[0].duration_sec}`,
  );

  const cutVo =
    "林小满，你那个SEO报告，现在就是废纸。客户都开始问AI了，谁还看你那排名？你懂什么？用户现在问AI，推荐谁就是谁。你那套关键词、外链，早过时了。那你说怎么评估？简单，看AI引用率。AI回答问题时，提到你几次？链接呢？还有对话提及率，就算没链接，被点名也算。你是说，以后不看点击量了？点击量是旧地图，找不到新大陆。客户问AI，你被推荐了，这才是真曝光。那…我们之前做的全白费了？不是白费，是得换尺子量。就像量体温用温度计，你非用尺子，能量出烧吗？行，我试试。但AI那玩意儿，怎么知道提没提我？这就有个工具，你按我说的做，先列50个问题，问AI，看它答什么。你教我的，我记下了。但万一AI提了，但说的是坏事呢？所以还得看上下文情感。那如果AI提了但说坏话，怎么算？——喂？什么？客户那边出事了？我马上来。我们之前做";
  const cut = parseSeries(
    JSON.stringify({
      title: "旧尺子失灵了",
      episodes: [
        {
          episode_no: 1,
          title: "旧尺子失灵了",
          hook: "林小满，你那个SEO报告，现在就是废纸。",
          voiceover: cutVo,
          on_screen: "旧尺子失灵了",
          duration_sec: 90,
          shots: [
            { seconds: 10, visual: "拍报告", speaker: "司马生", voiceover: "林小满，你那个SEO报告，现在就是废纸。" },
            { seconds: 10, visual: "反驳", speaker: "林小满", voiceover: "客户都开始问AI了，谁还看你那排名？" },
            { seconds: 10, visual: "白板", speaker: "司马生", voiceover: "你懂什么？" },
            {
              seconds: 10,
              visual: "电话响",
              speaker: "林小满",
              voiceover: "链接呢？还有对话提及率，就算没链接，被点名也算。你是说，以后不看点击量了？点击量是旧地图，找不到新大陆。客户问AI，你被推荐了，这才是真曝光。那…我们之前做",
            },
          ],
        },
      ],
    }),
    "drama",
    90,
  );
  const fixed = cut.episodes[0];
  assert(fixed.voiceover.endsWith("。"), `半截结尾必须剪掉，实际「${fixed.voiceover.slice(-12)}」`);
  assert(!fixed.voiceover.endsWith("我们之前做"), "不能把前面的半句再抄一遍当结尾");
  assert(fixed.voiceover.includes("我马上来"), "电话收束必须还在");
  assert(fixed.voiceover.includes("换尺子"), "后半段剧情不能丢");
  assert(
    fixed.shots.some((s) => s.voiceover.includes("我马上来")),
    "分镜必须覆盖到最后一句，不能停在「我们之前做」",
  );
  assert(
    fixed.shots.every((s) => /[。！？…]$/.test(s.voiceover.trim())),
    `分镜不能句中截断：${fixed.shots.map((s) => s.voiceover.slice(-8)).join(" | ")}`,
  );
  console.log(
    `PASS 半截结尾已收束 vo=${fixed.voiceover.length}字 shots=${fixed.shots.length} 尾「${fixed.voiceover.slice(-8)}」`,
  );

  const block = sceneBlockingLines({
    prevVisual: "林小满站起来，双手撑桌，皱眉反驳。",
    visual: "林小满坐在椅子上低头看手机。",
    nextVisual: "林小满走到白板前。",
  }).join("\n");
  assert(block.includes("必须画成站着"), `站起坐着必须纠偏：${block}`);
  assert(block.includes("下一镜"), "出图必须看到下一镜往哪演");
  const close = endingRules({ episodeCount: 1, hasSequel: false, show: true });
  const open = endingRules({ episodeCount: 1, hasSequel: true, show: true });
  assert(close.includes("没有后续") && close.includes("收束"), `单集默认要收束：${close}`);
  assert(open.includes("还有后续") && open.includes("缺口"), `勾了后续才留缺口：${open}`);
  console.log("PASS 单集默认收束，勾了后续才留缺口");

  console.log("PASS 分镜体态接上一镜、看下一镜");

  const ancientLock = inferEpisodeWardrobeLock([
    { visual: "司马生穿长衫站在府衙廊下" },
    { visual: "林小满坐在椅上听他说话" },
  ]);
  assert(ancientLock.includes("古代"), `古代场必须定古装：${ancientLock}`);
  const scene2 = manhuaScenePrompt({
    who: "「司马生」",
    visual: "司马生走近一步",
    prevVisual: "司马生穿长衫站在府衙廊下",
    wardrobeLock: ancientLock,
    hasPrevScene: true,
  });
  assert(scene2.includes("只认脸"), `后镜不能照搬设定图衣服：${scene2}`);
  assert(scene2.includes("定好的衣服") || scene2.includes("定装"), `后镜必须照穿：${scene2}`);
  console.log("PASS 古代场定装后不把现代便装画回来");

  assert(
    extractClothesPhrase("司马生穿深色西装，领口露出白衬衫") === "深色西装",
    `西装里的衬衫不能定成衬衫：${extractClothesPhrase("司马生穿深色西装，领口露出白衬衫")}`,
  );
  const suitLock = inferEpisodeWardrobeLock([
    { visual: "司马生穿深色西装坐在办公桌后，已经张嘴" },
    { visual: "他解开衬衫说话" },
  ]);
  assert(suitLock.includes("深色西装"), `第一镜西装必须锁住：${suitLock}`);
  assert(/禁止改成衬衫/.test(suitLock), `后镜不能改衬衫：${suitLock}`);
  const keptWardrobe = extractSeriesWardrobe(
    [
      {
        index: 1,
        seconds: 5,
        visual: "司马生穿深色西装坐着",
        onScreen: "",
        voiceover: "",
        imagePrompt: "",
      },
      {
        index: 2,
        seconds: 5,
        visual: "他穿着白衬衫走近",
        onScreen: "",
        voiceover: "",
        imagePrompt: "",
      },
    ],
    { clothes: "", set: "", lastFrameUrl: "" },
  );
  assert(keptWardrobe.clothes === "深色西装", `定装只能认第一镜：${keptWardrobe.clothes}`);
  const shirtLook = stripLookClothes("男，32岁，短发，穿白衬衫，定装：白衬衫");
  assert(
    !/衬衫|定装/.test(shirtLook) && shirtLook.includes("短发"),
    `外形里的衬衫要拿掉：${shirtLook}`,
  );
  const shirtCast = sceneCastLines([
    { name: "司马生", gender: "男", look: "短发，穿白衬衫，定装：白衬衫" },
  ]).join("\n");
  assert(
    !shirtCast.includes("衬衫") && shirtCast.includes("短发"),
    `出图外形不能带设定图衬衫：${shirtCast}`,
  );
  console.log("PASS 第一镜西装后不能改成衬衫");
  const jobCast = sceneCastLines(
    [
      { name: "写手", gender: "男" },
      { name: "上机", gender: "男" },
    ],
    2,
  ).join("\n");
  assert(
    jobCast.includes("「写手」是男的") &&
      jobCast.includes("「上机」是男的") &&
      jobCast.includes("参考图1是「写手」") &&
      jobCast.includes("禁止把男人画成女人"),
    `职位名必须锁男性：${jobCast}`,
  );
  const jobScene = manhuaScenePrompt({
    who: "「写手」、「上机」",
    cast: [
      { name: "写手", gender: "男" },
      { name: "上机", gender: "男" },
    ],
    castRefCount: 2,
    visual: "写手坐在桌前改稿，上机盯着屏幕",
  });
  assert(
    jobScene.includes("必须画成男人") && jobScene.includes("参考图2是「上机」"),
    `分镜提示词必须锁写手/上机是男的：${jobScene}`,
  );
  console.log("PASS 分镜职位名不能画成女生");

  const scriptVo =
    "司马生：你还在看点击量？那你这三个月白干了。林小满：你凭什么这么说？我们自然流量涨了15%，外链翻了一倍。司马生：那你销售线索呢？涨了吗？林小满：…没涨，还跌了。司马生：要是没用，我请客。要是用，你请。";
  const rewritten = parseSeries(
    JSON.stringify({
      title: "旧尺子",
      episodes: [
        {
          episode_no: 1,
          title: "旧尺子",
          hook: "你还在看点击量？",
          voiceover: `${scriptVo}你还在看点击量？你凭什么这么说？那你销售线索呢？要是没用，我请客。`,
          on_screen: "旧尺子",
          shots: [
            {
              seconds: 10,
              visual: "拍桌子",
              speaker: "司马生",
              voiceover: "点击量没意义，你白干了三个月。",
            },
            {
              seconds: 10,
              visual: "反驳",
              speaker: "林小满",
              voiceover: "流量和外链都涨了啊。",
            },
            {
              seconds: 10,
              visual: "追问",
              speaker: "司马生",
              voiceover: "线索涨了吗？没用我请客。",
            },
          ],
        },
      ],
    }),
    "drama",
    90,
  );
  const locked = rewritten.episodes[0];
  const labeled = locked.shots
    .map((s) => `${s.speaker}：${s.voiceover}`)
    .join("");
  assert(
    locked.voiceover === `【对话】${scriptVo}`,
    `准稿必须标明对话：${locked.voiceover}`,
  );
  assert(labeled === scriptVo, `分镜改了对话：${labeled}`);
  assert(
    locked.shots.every((s) => s.speaker === "司马生" || s.speaker === "林小满"),
    `每镜必须标出发话人：${locked.shots.map((s) => s.speaker).join(",")}`,
  );
  assert(
    locked.shots.every((s) => !s.voiceover.startsWith("司马生：") && !s.voiceover.startsWith("林小满：")),
    "分镜口播不要把名字念出来",
  );
  assert(!locked.voiceover.includes("点击量没意义"), "不能用分镜里另写的词替换准稿");
  console.log(
    `PASS 分镜锁准稿 vo=${locked.voiceover.length} shots=${locked.shots.length}`,
  );

  const clipLock = bindShotsToVoiceover(
    [
      {
        index: 1,
        seconds: 6,
        visual: "第一镜",
        onScreen: "一",
        voiceover: "第一句。",
        sceneUrl: "/s1.png",
        startUrl: "/s1.png",
        endUrl: "/e1.png",
        clipUrl: "/c1.mp4",
      },
    ],
    "第一句。第二句。第三句。第四句。",
    90,
  );
  assert(clipLock.length >= 4, `锁准稿后应拆出后镜：${clipLock.length}`);
  assert(clipLock[0]?.clipUrl === "/c1.mp4", "第一镜成片必须留下");
  assert(
    clipLock.slice(1).every((shot) => !shot.clipUrl),
    `后镜不该继承第一镜成片：${clipLock.map((s) => s.clipUrl || "-").join(",")}`,
  );
  assert(
    clipLock.slice(1).every((shot) => !shot.sceneUrl && !shot.startUrl && !shot.endUrl),
    `后镜不该继承第一镜头尾：${clipLock.map((s) => s.startUrl || s.sceneUrl || "-").join(",")}`,
  );
  assert(clipLock[0]?.startUrl === "/s1.png" && clipLock[0]?.endUrl === "/e1.png", "第一镜头尾必须留下");
  console.log("PASS 单独出第一镜后，后镜不会被标成已出片");

  const merged = mergeShotsByIndex(
    [
      { index: 1, seconds: 6, visual: "一", onScreen: "", voiceover: "1", clipUrl: "/c1.mp4" },
      { index: 2, seconds: 6, visual: "二", onScreen: "", voiceover: "2" },
      { index: 3, seconds: 6, visual: "三", onScreen: "", voiceover: "3" },
      { index: 4, seconds: 6, visual: "四", onScreen: "", voiceover: "4" },
    ],
    [
      {
        index: 4,
        seconds: 6,
        visual: "四",
        onScreen: "",
        voiceover: "4",
        clipUrl: "/c4.mp4",
      },
    ],
  );
  assert(merged.map((s) => s.index).join(",") === "1,2,3,4", "合并必须按镜号");
  assert(!merged[1]?.clipUrl && !merged[2]?.clipUrl, "2、3 镜不该被写成已出片");
  assert(merged[3]?.clipUrl === "/c4.mp4", "第 4 镜应写入成片");
  console.log("PASS 按镜号合并成片，不会冲掉中间镜");

  const kept = keepLocalShotMedia(
    [
      { index: 1, seconds: 6, visual: "一", onScreen: "", voiceover: "1", startUrl: "/s1.png", endUrl: "/e1.png" },
      { index: 2, seconds: 6, visual: "二", onScreen: "", voiceover: "2" },
    ],
    [
      { index: 1, seconds: 6, visual: "一", onScreen: "", voiceover: "1" },
      { index: 2, seconds: 6, visual: "二", onScreen: "", voiceover: "2", startUrl: "/s2.png" },
    ],
  );
  assert(kept[0]?.startUrl === "/s1.png" && kept[0]?.endUrl === "/e1.png", "服务端还没图时要留下本地头尾");
  assert(kept[1]?.startUrl === "/s2.png", "服务端已有的图要收下");
  console.log("PASS 本地已出的头尾不会被空快照盖掉");

  const parsed = shotsFromJson(
    JSON.stringify([
      { index: 4, visual: "四", voiceover: "四", seconds: 6 },
      { index: 1, visual: "一", voiceover: "一", seconds: 6, clipUrl: "/c1.mp4" },
      { index: 2, visual: "二", voiceover: "二", seconds: 6 },
      { index: 3, visual: "三", voiceover: "三", seconds: 6 },
    ]),
  );
  assert(
    parsed.map((s) => s.index).join(",") === "1,2,3,4",
    `读盘必须按镜号排：${parsed.map((s) => s.index)}`,
  );
  assert(parsed[0]?.clipUrl === "/c1.mp4", "乱序读盘不能把成片安到别的镜上");
  assert(
    parsed.slice(1).every((s) => !s.clipUrl),
    "乱序读盘不能把成片摊到后镜",
  );
  console.log("PASS 乱序分镜读盘按镜号对齐");

  const keyed = shotsFromJson(
    JSON.stringify([
      {
        index: 1,
        visual: "一",
        voiceover: "一",
        seconds: 6,
        startUrl: "/a.png",
        endUrl: "/b.png",
      },
      {
        index: 2,
        visual: "从客厅到门外",
        voiceover: "二",
        seconds: 6,
        sceneUrl: "/old.png",
      },
    ]),
  );
  assert(shotStartUrl(keyed[0]) === "/a.png", "开头帧必须读出来");
  assert(shotEndUrl(keyed[0]) === "/b.png", "结尾帧必须读出来");
  assert(shotHasKeyframes(keyed[0]), "有头尾才算出图齐");
  assert(shotStartUrl(keyed[1]) === "/old.png", "旧 sceneUrl 当开头");
  assert(!shotHasKeyframes(keyed[1]), "只有旧场景图不算头尾齐");
  assert(!shotsHaveScenes(keyed), "整集必须每镜头尾都齐");
  assert(sceneCutsAway(keyed[1]), "换场必须从画面里认出来");
  assert(!sceneCutsAway(keyed[0]), "同场不要误判成换场");
  assert(
    !sceneCutsAway({ visual: "切到被压的脸，特写反应镜" }),
    "切到脸是切镜，不是换场",
  );
  assert(
    inferShotJoin({ visual: "切到被压的脸", beat: "停", look: "挨打的人" }, { look: "说话的人" }) ===
      "cut",
    "反应镜必须认成硬切",
  );
  assert(
    !shouldReusePrevStart(
      { visual: "切到被压的脸", beat: "停", look: "挨打的人" },
      { look: "说话的人" },
    ),
    "硬切不能复用上一镜尾帧当开头",
  );
  assert(
    inferShotJoin({ visual: "从客厅到门外", voiceover: "二" }) === "away",
    "换地方必须认成换场",
  );
  const cutStartPrompt = manhuaScenePrompt({
    who: "「沈砚」",
    visual: "切到被压的脸",
    prevVisual: "徐奉冷着脸近景",
    hasPrevScene: true,
    phase: "start",
    join: "cut",
  });
  assert(
    cutStartPrompt.includes("硬切开头") && cutStartPrompt.includes("构图必须换"),
    `切镜开头必须换构图：${cutStartPrompt.slice(0, 120)}`,
  );
  const endPrompt = manhuaScenePrompt({
    who: "「司马生」",
    visual: "司马生走近一步",
    prevVisual: "司马生穿长衫站在府衙廊下",
    hasPrevScene: true,
    phase: "end",
    seconds: 8,
    camera: "固定",
  });
  assert(endPrompt.includes("结束帧"), `结尾提示必须锁结束状态：${endPrompt.slice(0, 80)}`);
  assert(
    endPrompt.includes("禁止和开头几乎同一张") &&
      !endPrompt.includes("必须接着上一镜的结束状态"),
    `结尾不能再按开头接戏来画：${endPrompt.slice(0, 180)}`,
  );
  const split = splitShotBeats("林小满坐在椅上听 → 她站起来撑桌");
  assert(
    split.start.includes("坐在椅上") && split.end.includes("站起来"),
    `头尾调度必须拆开：${JSON.stringify(split)}`,
  );
  assert(
    stillTalkingHead({
      visual: "对着镜头说，坐在书桌前",
      camera: "固定",
      plate: { size: "近景", angle: "平视", framing: "", light: "", grade: "", motion: "已在说" },
    }) &&
      !stillTalkingHead({
        visual: "林小满坐在椅上听 → 她站起来撑桌",
        camera: "固定",
      }),
    "只有坐着口播才算头尾可以同机位",
  );
  console.log("PASS 头尾关键帧读写、同场复用、换场识别");

  const mixedVo =
    "【对话】老臣：你的折子，圣上连第二行都没看，就扔了。司马生：为何？老臣：我引了兵部旧例，又列了粮道图。司马生：圣上问的是粮草几时到，你倒先讲起二十年前的故事。老臣：粮草三月初七必到，写在第三页。司马生：第三页？老臣：圣上只看第一行。司马生：你的答案，藏得太深。老臣：那要如何写？老臣：把结论放在最前头，一句说清。老臣：粮草三月初七到，出处、时限，都摆明。老臣：这岂不是把军报写成了短笺？老臣：短笺，才是圣上如今看得进的东西。老臣：你的折子，不是写得不好，是写错了地方。";
  const fixedVo = canonicalizeVoiceover(mixedVo, "dialogue");
  assert(
    fixedVo.includes("老臣：那要如何写？司马生：把结论放在最前头"),
    `问完必须换人答：${fixedVo}`,
  );
  assert(
    fixedVo.includes("老臣：这岂不是把军报写成了短笺？司马生：短笺"),
    `反问后必须换人：${fixedVo}`,
  );
  assert(
    !/老臣：那要如何写？老臣：/.test(fixedVo),
    `不能自问自答：${fixedVo}`,
  );
  const mixedEp = parseSeries(
    JSON.stringify({
      title: "折子",
      episodes: [
        {
          episode_no: 1,
          title: "折子写错了地方",
          hook: "你的折子，圣上连第二行都没看，就扔了。",
          voiceover: mixedVo,
          on_screen: "结论放最前",
          duration_sec: 90,
          shots: [{ seconds: 8, visual: "殿上", speaker: "老臣", voiceover: "你的折子，圣上连第二行都没看，就扔了。" }],
        },
      ],
    }),
    "drama",
    90,
    "dialogue",
  );
  const mixedShots = mixedEp.episodes[0].shots.map((s) => `${s.speaker}：${s.voiceover}`);
  assert(
    mixedShots.some((s) => s.startsWith("司马生：把结论")),
    `分镜必须把教写法还给司马生：${mixedShots.join(" | ")}`,
  );
  assert(
    mixedShots.some((s) => s.startsWith("老臣：这岂不是")),
    `反问必须还给老臣：${mixedShots.join(" | ")}`,
  );
  assert(
    repairDialogueTurns(fixedVo) === fixedVo,
    "修好的对白再修一次不能变",
  );
  console.log("PASS 对话后半段不会全署成同一个人");

  const trioVo =
    "【对话】甲：把门关上。乙：关上了。丙：等等。丙：外面还有人。丙：先别锁。甲：听他的。";
  assert(
    repairDialogueTurns(trioVo) === trioVo,
    `三人稿不能按两人对打乱切：${repairDialogueTurns(trioVo)}`,
  );
  const cast = collectScriptCast(
    {
      voiceover: trioVo,
      shots: [
        {
          index: 1,
          seconds: 4,
          visual: "",
          onScreen: "",
          voiceover: "",
          imagePrompt: "",
          speaker: "丁",
        },
      ],
    },
    ["司马生"],
  );
  assert(
    cast.includes("甲") &&
      cast.includes("丙") &&
      cast.includes("丁") &&
      cast.includes("司马生"),
    `审稿必须收齐场上所有人：${cast.join(",")}`,
  );
  const remapped = relabelScriptTurns(
    trioVo,
    ["甲", "乙", "丙", "乙", "丙", "甲"],
    ["甲", "乙", "丙"],
  );
  assert(Boolean(remapped), "审稿改署名必须成功");
  assert(
    remapped?.includes("乙：外面还有人") && remapped.includes("先别锁"),
    `只改谁说的，不改原话：${remapped}`,
  );
  assert(
    scriptTurns(remapped || "").map((t) => t.line).join("") ===
      scriptTurns(trioVo).map((t) => t.line).join(""),
    "原话一句都不能动",
  );
  console.log("PASS 审稿按场上所有人改署名，不按两人对打");

  const cards = parseStanceCards(
    embedStanceNotes("连载注意", [
      {
        name: "司马生",
        role: "拿主意的人",
        stance: "压老臣改写法",
        knows: "圣上只看第一行",
        wants: "结论放最前",
        address: "对老臣直说",
        never: "向老臣请示怎么写",
        intro: "司马生是当值学士，要老臣把结论放到第一行。",
      },
      {
        name: "老臣",
        role: "被压的人",
        stance: "被司马生压，会问会顶",
        knows: "旧例和粮道图",
        wants: "问清楚",
        address: "对司马生按身份称呼",
        never: "给司马生下命令",
        intro: "老臣守旧例，粮道图还在他手里。",
      },
    ]),
  );
  assert(cards.length === 2 && cards[0]?.name === "司马生", "人设卡必须能存能读");
  const cardText = formatStanceCards(cards);
  assert(cardText.includes("绝不说") && cardText.includes("不能对调"), `人设卡必须锁立场：${cardText}`);
  assert(!cardText.includes("交替署名"), "人设卡不要写成两人对打");
  console.log("PASS 人设卡锁立场，不按轮流说话");

  const parsedCopy = parseShotCopyPatch(
    '说明一下 {"beat":"钩","look":"特写握笔的手","visual":"画面从眉眼下摇到折子，笔尖悬着欲滴。","onScreen":"这一笔写下去就完了"}',
  );
  assert(
    parsedCopy?.beat === "钩" &&
      parsedCopy.look?.includes("握笔") &&
      (parsedCopy.visual || "").includes("下摇"),
    "单镜重写必须读出画面和情绪",
  );
  assert(normalizeShotBeat("反应") === "停", "反应镜要归到停");
  assert(normalizeShotBeat("打脸") === "打", "打脸要归到打");
  assert(flowerRepeatsLine("圣上只看第一行", "老臣：圣上只看第一行。"), "花字复述对白必须认出来");
  assert(
    flowerRepeatsLine(
      "沈探花，新科入阁，总要有个投帖的规矩，你可明白？",
      "沈探花,新科入阁,总要有个投帖的规矩,你可明白?",
    ),
    "花字复述对白不能被中英文逗号骗过",
  );
  assert(!flowerRepeatsLine("答案藏太深", "老臣：圣上只看第一行。"), "花字替观众说话不算复述");
  const reacted = applyShotEmotionPatches(
    [
      {
        index: 1,
        seconds: 6,
        visual: "老臣站着说话",
        onScreen: "圣上只看第一行",
        voiceover: "圣上只看第一行。",
        imagePrompt: "",
      },
      {
        index: 2,
        seconds: 5,
        visual: "司马生站着说话",
        onScreen: "那要如何写",
        voiceover: "那要如何写？",
        imagePrompt: "",
      },
    ],
    [
      {
        index: 2,
        beat: "停",
        look: "挨打的人",
        visual: "特写司马生愣住，折子还在手里",
        onScreen: "答案藏太深",
      },
    ],
  );
  assert(reacted[0]?.visual === "老臣站着说话", "没改的镜不能动");
  assert(reacted[1]?.beat === "停" && reacted[1]?.look === "挨打的人", "情绪补丁必须写上节拍和看谁");
  assert(looksLikeReactionShot(reacted[1]!), "反应镜必须能认出来");
  const reactPrompt = manhuaScenePrompt({
    who: "「司马生」",
    visual: "特写司马生愣住",
    beat: "停",
    look: "挨打的人",
  });
  assert(reactPrompt.includes("反应镜") && reactPrompt.includes("挨打的人"), `反应镜出图不能画成聊天脸：${reactPrompt}`);
  const keyedEmotion = shotsFromJson(
    JSON.stringify([
      {
        index: 1,
        seconds: 6,
        beat: "钩",
        look: "特写被扔的折子",
        visual: "折子落地",
        onScreen: "连第二行都没看",
        voiceover: "扔了。",
        speechUrl: "/a.mp3",
      },
    ]),
  );
  assert(keyedEmotion[0]?.beat === "钩" && keyedEmotion[0]?.look === "特写被扔的折子", "分镜情绪字段必须能存能读");
  assert(keyedEmotion[0]?.speechUrl === "/a.mp3", "对白音轨地址必须能跟着分镜走");
  assert(
    speechToneLine({ beat: "顶", voiceover: "那要如何写？" }).includes("质问"),
    "顶回去的问句必须带火",
  );
  assert(
    spokenForPlay("徐奉：（冷）你这是不肯？") === "你这是不肯？",
    "演法括号不能念出声",
  );
  assert(
    stripStageDirections("（盯着他,冷笑）…这一笔账，老夫记下了。").includes("这一笔账"),
    "冷笑括号要剥掉",
  );
  assert(
    isLectureAskLine("沈探花,新科入阁,总要有个投帖的规矩,你可明白?"),
    "投帖规矩问懂不懂必须认成讲课钩",
  );
  const courtTone = speechToneLine({
    beat: "钩",
    voiceover: "沈探花,新科入阁,总要有个投帖的规矩,你可明白?",
  });
  assert(
    courtTone.includes("压人") &&
      courtTone.includes("冷") &&
      !courtTone.includes("胸腔有力") &&
      !courtTone.includes("当众揭穿"),
    `投帖规矩不能用播音揭穿：${courtTone}`,
  );
  assert(
    speechActLine({
      beat: "钩",
      voiceover: "总要有个投帖的规矩,你可明白?",
    }).includes("拿规矩压人"),
    "模型出声也不能把规矩问句念成讲解",
  );
  const talkHookTone = speechToneLine({
    beat: "钩",
    voiceover: "那根本不叫内容营销，那叫偶尔写点东西。",
    talk: true,
  });
  assert(
    talkHookTone.includes("当面") &&
      !talkHookTone.includes("当众揭穿") &&
      !talkHookTone.includes("身体一紧"),
    `口播钩不能用短剧揭穿腔：${talkHookTone}`,
  );
  const talkHookAct = speechActLine({
    beat: "钩",
    voiceover: "那根本不叫内容营销，那叫偶尔写点东西。",
    talk: true,
  });
  assert(
    talkHookAct.includes("当面第一句") && !talkHookAct.includes("像短剧开场"),
    `口播出声第一镜不能念成短剧开场：${talkHookAct}`,
  );
  const scrubbedFlower = scrubShotFlowers([
    {
      index: 1,
      seconds: 6,
      visual: "两人端坐",
      onScreen: "沈探花，新科入阁，总要有个投帖的规矩，你可明白？",
      voiceover: "沈探花,新科入阁,总要有个投帖的规矩,你可明白?",
      imagePrompt: "",
    },
  ]);
  assert(!scrubbedFlower[0]?.onScreen, "花字复述整句对白必须清掉");
  assert(
    emotionFaceLine("顶", "说话的人").includes("禁止端坐讲解脸"),
    "顶的脸不能画成讲课",
  );
  assert(
    captionSource({ voiceover: "徐奉：（冷）你这是不肯？" }) === "你这是不肯？",
    "花字不能把冷笑括号打上屏",
  );
  assert(
    findScriptIssues({
      title: "那张门生帖",
      voiceover: "【对话】徐奉：沈探花,新科入阁,总要有个投帖的规矩,你可明白?",
      shots: [
        {
          index: 1,
          seconds: 6,
          visual: "书房",
          onScreen: "",
          voiceover: "沈探花,新科入阁,总要有个投帖的规矩,你可明白?",
          imagePrompt: "",
        },
      ],
    }).some((row) => row.code === "lecture"),
    "开场讲投帖规矩必须被审出来",
  );
  assert(
    actingVoiceId("ICL_uranus_zh_male_youmodaye_tob") ===
      "zh_male_liufei_uranus_bigtts",
    "幽默大爷演不了阁老，对白必须换角色声",
  );
  assert(
    ttsVoiceGeneration("zh_female_mizai_uranus_bigtts") === "2" &&
      !arkTtsModelsForVoice("zh_female_mizai_uranus_bigtts").some((id) =>
        /1\.0/.test(id),
      ),
    "咪仔是 2.0 音色，不能拿 1.0 模型出",
  );
  assert(
    ttsVoiceGeneration("zh_female_wanwanxiaohe_moon_bigtts") === "1" &&
      !arkTtsModelsForVoice("zh_female_wanwanxiaohe_moon_bigtts").some((id) =>
        /2\.0/.test(id),
      ),
    "moon 音色必须走 1.0",
  );
  assert(
    DEFAULT_PODCAST_GUEST_VOICE === "zh_female_xiaohe_uranus_bigtts",
    "播客默认嘉宾不能再用卡通咪仔",
  );
  assert(
    !pickCharacterVoice({
      name: "徐奉",
      look: "内阁首辅，白须，深紫阁老官袍",
      role: "首辅",
    }).includes("youmodaye"),
    "首辅不能自动分到幽默大爷",
  );
  const tagged = actingSpeechText({
    beat: "钩",
    voiceover: "沈探花,新科入阁,总要有个投帖的规矩,你可明白?",
  });
  assert(
    tagged === "沈探花,新科入阁,总要有个投帖的规矩,你可明白?" &&
      !tagged.startsWith("[") &&
      speechActTag({
        beat: "钩",
        voiceover: "总要有个投帖的规矩,你可明白?",
      }).includes("压人"),
    `对白配音不能把演法标签念出声：${tagged}`,
  );
  assert(
    speechActSpeed("钩", "总要有个投帖的规矩,你可明白?") >= 1.2 &&
      speechActSpeed("顶", "你凭什么？") >= 1.2 &&
      speechToneSpeed("钩") >= 1.24 &&
      !courtTone.includes("冷、慢") &&
      courtTone.includes("短"),
    "压人句要短，口播和短剧语速都要快，不能慢慢悠悠",
  );
  const innerTurns = scriptTurns(
    "【对话】徐奉：你可明白？沈砚（内心）：这一帖，签了就是烙印。",
  );
  assert(
    innerTurns[1]?.who === "沈砚" &&
      innerTurns[1]?.line.includes("烙印"),
    "内心独白必须认成角色心里的话，不要另立一个人",
  );
  const innerShot = shotsFromJson(
    JSON.stringify([
      {
        index: 1,
        seconds: 4,
        speaker: "沈砚（内心）",
        voiceover: "这一帖，签了就是烙印。",
        visual: "特写沈砚闭嘴的眼睛",
        onScreen: "签了就是烙印",
        imagePrompt: "",
      },
    ]),
  )[0];
  assert(
    innerShot?.speaker === "沈砚" &&
      innerShot.delivery === "inner" &&
      shotIsInner(innerShot),
    "内心镜必须闭嘴出声",
  );
  const innerEp = parseEpisodeList(
    JSON.stringify([
      {
        episode_no: 1,
        title: "那张门生帖",
        voiceover: "【对话】徐奉：你可明白？沈砚（内心）：这一帖，签了就是烙印。",
        shots: [
          {
            index: 1,
            seconds: 5,
            speaker: "徐奉",
            voiceover: "你可明白？",
            visual: "帖拍在案上",
            onScreen: "",
          },
          {
            index: 2,
            seconds: 4,
            speaker: "沈砚",
            delivery: "inner",
            voiceover: "这一帖，签了就是烙印。",
            visual: "沈砚闭嘴",
            onScreen: "签了就是烙印",
          },
        ],
      },
    ]),
    1,
    40,
    "dialogue",
  )[0];
  assert(
    innerEp?.voiceover.includes("沈砚（内心）") &&
      innerEp.shots[1]?.delivery === "inner",
    `准稿必须能写出内心独白：${innerEp?.voiceover}`,
  );
  assert(
    speechToneLine({ beat: "停", voiceover: "……" }).includes("咽"),
    "反应镜配音必须压着说",
  );
  const acted = speechPerformance({
    beat: "顶",
    speaker: "赵琳",
    role: "被冤枉的下属",
    stance: "顶回去，不要请示",
    voiceover: "你胡说什么？林总怎么可能——",
  });
  assert(
    acted.includes("演戏") &&
      acted.includes("赵琳") &&
      acted.includes("掐住") &&
      acted.includes("你胡说什么") &&
      !acted.includes("抖音短视频口播"),
    `对白先出的音频必须按这句演：${acted}`,
  );
  const lastLock = shotSpeakerLockLine({
    speaker: "老臣",
    voiceover: "算法一改，你那些功夫全废。",
  });
  assert(
    lastLock.includes("只有「老臣」张嘴") && lastLock.includes("不要把这句拆成两个人说"),
    `两人同框不能把一句拆给两张嘴：${lastLock}`,
  );
  console.log("PASS 漫剧情绪节拍、反应镜、花字不复述对白");

  assert(sceneRefLook(undefined) === "forward", "批量出图必须向前参考");
  assert(sceneRefLook([]) === "forward", "没指定分镜仍算批量，向前参考");
  assert(sceneRefLook([3]) === "backward", "单镜出图必须向后参考");
  const batchStart = sceneImageLeads({
    phase: "start",
    refLook: "forward",
    prevTail: "/prev-end.png",
    nextHead: "/next-start.png",
  });
  assert(
    batchStart.anchor === "prev" &&
      batchStart.urls[0] === "/prev-end.png" &&
      !batchStart.urls.includes("/next-start.png"),
    `批量开头只能看上一镜：${batchStart.urls.join(",")}`,
  );
  const batchEnd = sceneImageLeads({
    phase: "end",
    refLook: "forward",
    startUrl: "/this-start.png",
    nextHead: "/next-start.png",
  });
  assert(
    batchEnd.anchor === "self" &&
      batchEnd.urls[0] === "/this-start.png" &&
      !batchEnd.urls.includes("/next-start.png"),
    `批量结尾只能看本镜开头：${batchEnd.urls.join(",")}`,
  );
  const singleEnd = sceneImageLeads({
    phase: "end",
    refLook: "backward",
    startUrl: "/this-start.png",
    refStart: "/next-start.png",
    refEnd: "/next-end.png",
  });
  assert(
    singleEnd.anchor === "self" && singleEnd.urls[0] === "/this-start.png",
    `单镜重出结尾先锁本镜开头，不能先抄下一镜：${singleEnd.urls.join(",")}`,
  );
  assert(
    singleEnd.urls.includes("/next-start.png") &&
      singleEnd.urls.includes("/this-start.png"),
    "单镜重出结尾仍带着指定参考镜，但排在本镜开头后面",
  );
  const singleStart = sceneImageLeads({
    phase: "start",
    refLook: "backward",
    prevTail: "/prev-end.png",
    endUrl: "/this-end.png",
    refStart: "/next-start.png",
    refEnd: "/next-end.png",
  });
  assert(
    singleStart.anchor === "prev" && singleStart.urls[0] === "/prev-end.png",
    `单镜重出开头先接上一镜，不能先抄下一镜开头：${singleStart.urls.join(",")}`,
  );
  assert(
    singleStart.urls.includes("/next-start.png"),
    "单镜重出开头仍带着指定参考镜认人装",
  );
  const cutEnd = sceneImageLeads({
    phase: "end",
    refLook: "backward",
    startUrl: "/this-start.png",
    refStart: "/next-start.png",
    nextCutsAway: true,
  });
  assert(
    cutEnd.urls[0] === "/this-start.png" && cutEnd.urls[1] === "/next-start.png",
    `参考镜换场时本镜结尾先锁本场：${cutEnd.urls.join(",")}`,
  );
  const hardCutStart = sceneImageLeads({
    phase: "start",
    refLook: "forward",
    prevTail: "/prev-end.png",
    join: "cut",
  });
  assert(
    hardCutStart.anchor === "none" && !hardCutStart.urls.includes("/prev-end.png"),
    `切镜开头不能拿上一镜尾帧锁构图：${hardCutStart.urls.join(",")}`,
  );
  const names3 = ["霍北辰", "罪妻", "官差"];
  assert(
    peopleOnShot(
      {
        speaker: "罪妻",
        voiceover: "罪妻：大人，这纸上的字我看不懂。",
        visual: "霍北辰按住文书，官差的手被迫松开，罪妻把边角抽出来。",
        look: "",
        onScreen: "指腹擦墨",
        imagePrompt: "",
      },
      names3,
    ).join(",") === "罪妻,霍北辰,官差",
    "这一镜出场的人要从画面和对白里认齐",
  );
  const laterPlan = planSceneRefs({
    shot: {
      index: 2,
      seconds: 8,
      speaker: "罪妻",
      voiceover: "罪妻：大人，这纸上的字我看不懂。",
      visual: "霍北辰、罪妻、官差都在堂上。罪妻抽出文书。",
      onScreen: "指腹擦墨",
      imagePrompt: "",
      props: ["文书"],
    },
    anchor: {
      index: 1,
      seconds: 6,
      speaker: "霍北辰",
      voiceover: "霍北辰：按。",
      visual: "霍北辰独自站在堂上。",
      onScreen: "",
      imagePrompt: "",
    },
    names: names3,
    props: [{ id: "p1", name: "文书", look: "边角起毛的官文", url: "/doc.png" }],
    leadUrls: ["/1-end.png"],
    maxRefs: 4,
  });
  assert(
    laterPlan.map((row) => (row.kind === "scene" ? "scene" : row.name)).join(",") ===
      "罪妻,官差,文书,scene",
    `后镜要补上新出场的人和道具，不要只拿上一镜那一张脸：${laterPlan.map((row) => row.kind + ":" + (row.kind === "scene" ? "frame" : row.name)).join(",")}`,
  );
  const crowdShot = {
    index: 2,
    seconds: 8,
    speaker: "罪妻",
    voiceover: "罪妻：大人，这纸上的字我看不懂。",
    visual: "霍北辰、罪妻、官差都在堂上。罪妻抽出文书。",
    onScreen: "指腹擦墨",
    imagePrompt: "",
    props: ["文书"],
  };
  const crowdNames = names3;
  const crowdProps = [{ id: "p1", name: "文书", look: "边角起毛的官文", url: "/doc.png" }];
  const crowdTight = planSceneRefs({
    shot: crowdShot,
    names: crowdNames,
    props: crowdProps,
    leadUrls: ["/1-end.png"],
    maxRefs: 4,
  });
  assert(
    crowdTight.map((row) => (row.kind === "scene" ? "scene" : row.name)).join(",") ===
      "罪妻,霍北辰,官差,scene",
    `四人名额时三人同框要保住脸和尾帧，道具改写进提示词：${crowdTight.map((row) => row.kind + ":" + (row.kind === "scene" ? "frame" : row.name)).join(",")}`,
  );
  const crowdWide = planSceneRefs({
    shot: crowdShot,
    names: crowdNames,
    props: crowdProps,
    leadUrls: ["/1-end.png"],
    maxRefs: 10,
  });
  assert(
    crowdWide.map((row) => (row.kind === "scene" ? "scene" : row.name)).join(",") ===
      "罪妻,霍北辰,官差,文书,scene",
    `Seedream 名额够时人、道具、尾帧要一起进：${crowdWide.map((row) => row.kind + ":" + (row.kind === "scene" ? "frame" : row.name)).join(",")}`,
  );
  const laterWide = planSceneRefs({
    shot: crowdShot,
    anchor: {
      index: 1,
      seconds: 6,
      speaker: "霍北辰",
      voiceover: "霍北辰：按。",
      visual: "霍北辰独自站在堂上。",
      onScreen: "",
      imagePrompt: "",
    },
    names: names3,
    props: crowdProps,
    leadUrls: ["/1-end.png"],
    maxRefs: 10,
  });
  assert(
    laterWide.map((row) => (row.kind === "scene" ? "scene" : row.name)).join(",") ===
      "罪妻,官差,文书,scene,霍北辰",
    `名额够时上一镜已经露过的人也要补设定图：${laterWide.map((row) => row.kind + ":" + (row.kind === "scene" ? "frame" : row.name)).join(",")}`,
  );
  const endPlan = planSceneRefs({
    shot: crowdShot,
    names: crowdNames,
    props: crowdProps,
    leadUrls: ["/2-start.png", "/1-end.png"],
    maxRefs: 10,
    leadAfterCast: true,
  });
  assert(
    endPlan[0]?.kind === "scene",
    `结尾第一张参考必须是定装帧，不能先放角色设定：${endPlan.map((row) => row.kind).join(",")}`,
  );
  console.log("PASS 结尾参考图先钉定装再放角色设定");
  const crowdNames10 = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
  const crowdLoad = shotRefLoad({
    shot: {
      speaker: "甲",
      voiceover: "甲：都跪下。",
      visual: "甲乙丙丁戊己庚辛壬癸都站在堂上，文书和玉佩摊开。",
      look: "",
      onScreen: "",
      imagePrompt: "",
      props: ["文书", "玉佩"],
    },
    names: crowdNames10,
  });
  assert(
    crowdLoad.people === 10 && crowdLoad.props === 2 && crowdLoad.total === 13,
    `十人两道具加衔接帧要算超预算：${JSON.stringify(crowdLoad)}`,
  );
  const crowdReview = reviewDirectedShots(
    {
      episode_no: 1,
      title: "堂审",
      hook: "帖拍上桌",
      voiceover: "甲：都跪下。",
      shots: [
        {
          index: 1,
          seconds: 3,
          beat: "钩",
          camera: "特写",
          speaker: "甲",
          voiceover: "甲：都跪下。",
          visual: "特写手把帖拍上桌，甲乙丙丁戊己庚辛壬癸都在堂上，文书玉佩摊开。",
          look: "手",
          onScreen: "都来了",
          imagePrompt: "",
          props: ["文书", "玉佩"],
        },
      ],
    },
    crowdNames10,
  );
  assert(
    crowdReview.issues.some((row) => row.includes("超过 10 张参考")),
    `超员群戏要打回拆镜：${crowdReview.issues.join("；")}`,
  );
  console.log("PASS 超员群戏按参考图预算拆镜");
  assert(secondsFromAudio(3.2) === 4 && secondsFromAudio(6.1) === 7, "对白时长要向上取整并夹在 4–15");
  const framed = shotsFromJson(
    JSON.stringify([
      {
        index: 1,
        seconds: 5,
        visual: "特写手",
        voiceover: "甲：跪下。",
        onScreen: "",
        imagePrompt: "",
        startUrl: "/s.png",
        endUrl: "/e.png",
        framesOk: true,
        clipAltUrl: "/b.mp4",
        speechUrl: "/a.mp3",
      },
    ]),
  );
  assert(
    framed[0]?.framesOk === true && framed[0]?.clipAltUrl === "/b.mp4",
    "过片和备选成片要能读回来",
  );
  assert(
    shotsMissingFrameApproval([
      {
        index: 2,
        seconds: 4,
        visual: "近景",
        voiceover: "",
        onScreen: "",
        imagePrompt: "",
        startUrl: "/2s.png",
        endUrl: "/2e.png",
      },
    ]).join(",") === "2",
    "有头尾但没过片要拦出片",
  );
  const rebound = bindShotsToVoiceover(
    framed,
    "【对话】甲：给我起来，听见没有。",
    90,
  );
  assert(
    !rebound[0]?.speechUrl,
    `对白改了不能沿用旧配音：${rebound[0]?.speechUrl || ""}`,
  );
  console.log("PASS 静帧过片、备选成片、对白改了重出声");
  const namedCast = sceneCastLines(
    [
      { name: "霍北辰", gender: "男" },
      { name: "罪妻", gender: "女" },
      { name: "官差", gender: "男" },
    ],
    [
      { name: "罪妻", refIndex: 1 },
      { name: "官差", refIndex: 2 },
    ],
  ).join("\n");
  assert(
    namedCast.includes("参考图1是「罪妻」") &&
      namedCast.includes("参考图2是「官差」") &&
      !namedCast.includes("参考图1是「霍北辰」"),
    `提示词必须对上这一镜补进去的设定图：${namedCast}`,
  );
  console.log("PASS 后镜补新出场角色和道具设定图");
  const picked = [
    { index: 2, startUrl: "/2s.png", endUrl: "/2e.png" },
    { index: 3 },
    { index: 4, startUrl: "/4s.png", endUrl: "/4e.png" },
    { index: 5, startUrl: "/5s.png", endUrl: "/5e.png" },
  ];
  assert(defaultRefShotIndex(picked, 3) === 4, "点第3镜默认参考第4镜");
  assert(defaultRefShotIndex(picked, 5) === 4, "最后一镜没有后面的图，才回头参考");
  const backPrompt = manhuaScenePrompt({
    who: "「司马生」",
    visual: "司马生走近一步",
    nextVisual: "林小满愣住",
    hasRefScene: true,
    refLook: "backward",
    refShotNo: 4,
    phase: "end",
  });
  assert(
    backPrompt.includes("第 4 镜已经定好") && backPrompt.includes("必须和那一镜一致"),
    `指定参考镜必须写进提示：${backPrompt.slice(0, 160)}`,
  );
  const fwdPrompt = manhuaScenePrompt({
    who: "「司马生」",
    visual: "司马生走近一步",
    hasPrevScene: true,
    prevVisual: "司马生穿长衫站在府衙廊下",
    phase: "end",
  });
  assert(
    !fwdPrompt.includes("第 4 镜已经定好"),
    "批量向前参考不要改成盯着指定镜",
  );
  console.log("PASS 单镜可指定参考镜，默认下一镜");

  const systemKick = showKickoffLine("system");
  assert(
    systemKick.includes("任务") &&
      systemKick.includes("系统") &&
      !systemKick.includes("上一世"),
    `选系统不能写成重生开场：${systemKick}`,
  );
  assert(
    hookStylePremiseLine("system").includes("系统") &&
      hookStylePremiseLine("system").includes("任务"),
    "系统剧情介绍必须写出任务",
  );
  const systemMark = showEngineMark("system");
  assert(systemMark?.test("系统弹窗：三小时内揭穿报价单") === true, "系统介绍要认弹窗任务");
  assert(systemMark?.test("把这件事做完就散会") === false, "普通「做完」不能冒充系统");
  console.log("PASS 选系统必须在剧情里看见系统");

  const romanceKick = showKickoffLine("romance");
  assert(
    /甜|酸|吃醋|居然/.test(romanceKick) &&
      !romanceKick.includes("上一世") &&
      !romanceKick.includes("任务"),
    `选甜宠不能写成重生或系统：${romanceKick}`,
  );
  const rebirthKick = showKickoffLine("rebirth");
  assert(
    rebirthKick.includes("上一世") && !rebirthKick.includes("弹窗"),
    `选重生必须锁上一世：${rebirthKick}`,
  );
  const systemEngine = hookStyleLine("system");
  assert(
    systemEngine.includes("弹窗") &&
      systemEngine.includes("感到") &&
      !systemEngine.includes("上一世栽"),
    `系统发动机必须独立：${systemEngine.slice(0, 120)}`,
  );
  const workplaceHook = hookStyleShotContract("workplace").hook;
  assert(
    workplaceHook.includes("怎么回事") && workplaceHook.includes("禁止"),
    `职场第一镜必须禁案情问询：${workplaceHook}`,
  );
  const romanceEngine = hookStyleLine("romance");
  assert(
    romanceEngine.includes("甜") &&
      !romanceEngine.includes("上一世") &&
      !romanceEngine.includes("弹窗"),
    `甜宠发动机不能串重生/系统：${romanceEngine.slice(0, 120)}`,
  );
  const isekaiEngine = hookStyleLine("isekai");
  assert(
    isekaiEngine.includes("穿越") && isekaiEngine.includes("禁止写成同一世界重生"),
    `穿越发动机必须禁重生：${isekaiEngine.slice(0, 120)}`,
  );
  assert(
    hookStyleShotContract("isekai").visual.includes("哪来的") &&
      hookStyleShotContract("tycoon").visual.includes("上桌") &&
      hookStyleShotContract("revenge").visual.includes("易手") &&
      hookStyleShotContract("workplace").visual.includes("开除") &&
      hookStyleShotContract("court").visual.includes("宣读") &&
      hookStyleLine("court").includes("你可明白"),
    "各题材第一镜必须是能拍的那一下，不能只写抽象冲突",
  );
  const talkIds = VIDEO_SCRIPT_STYLE_OPTIONS.filter((s) => s.group === "口播讲法").map((s) => s.id);
  const showIds = VIDEO_SCRIPT_STYLE_OPTIONS.filter((s) => s.group === "短剧题材").map((s) => s.id);
  assert(
    talkIds.join(",") === "talk,roast,confess,argue,expose,contrast",
    `口播讲法必须是 6 项：${talkIds.join(",")}`,
  );
  assert(
    showIds.join(",") === "isekai,rebirth,system,tycoon,revenge,romance,workplace,court",
    `短剧题材必须是 8 项、不能有剧情短剧：${showIds.join(",")}`,
  );
  assert(
    !VIDEO_SCRIPT_STYLE_OPTIONS.some((s) => s.id === "drama" || s.label === "剧情短剧"),
    "下拉不能再出现剧情短剧兜底",
  );
  assert(
    normalizeHookStyle("drama") === "drama" && isShowStyle("drama") && !isShowStyle("roast"),
    "旧系列 hook_style=drama 仍按短剧读，打脸反转仍是口播讲法",
  );
  assert(
    hookStyleLookLine("isekai").includes("时代") &&
      hookStyleLookLine("court").includes("禁止现代便装") &&
      hookStyleLookLine("talk").includes("现代日常"),
    "角色定装必须跟题材走，不能再两分成剧情短剧/科普口播",
  );
  assert(
    isekaiEngine.includes("不要求每集讲一个知识点") &&
      isekaiEngine.includes("禁止每集重复同一句设定"),
    `短剧规则必须丢掉知识点节奏：${isekaiEngine.slice(0, 160)}`,
  );
  console.log("PASS 各短剧题材发动机互不串题");
  assert(
    dropCastOutlineBlock(
      "角色大纲\n沈探花（内阁）：照抄票拟。知道折子会贬他。\n\n内阁已经把贬谪折子递到桌上。",
    ) === "内阁已经把贬谪折子递到桌上。",
    "剧情介绍不再保留角色大纲那段",
  );

  const scrubbed = scrubShowCopy({
    episode_no: 1,
    title: "AI没提她",
    hook: "晚晚，AI没提你。",
    voiceover: "【对话】周扬：晚晚，AI没提你。苏晚：…别家。",
    on_screen: "他心里装的是她",
    recap: "她没点头，那句「先叫你名字」落进心里了。",
    next_hook: "那句「先叫你名字」落进她心里了。",
    duration_sec: 15,
    shots: [
      {
        index: 1,
        seconds: 4,
        visual: "观众先替周扬捏汗：报价单推过来。林总坐主位。",
        onScreen: "这锅钉死了",
        voiceover: "晚晚，AI没提你。",
        imagePrompt: "",
      },
    ],
  });
  assert(
    !scrubbed.next_hook.includes("先叫你名字") &&
      !scrubbed.recap.includes("先叫你名字"),
    `收束不能留准稿没有的编词：${scrubbed.next_hook} / ${scrubbed.recap}`,
  );
  assert(
    !scrubbed.shots[0]?.visual.includes("观众先替"),
    `分镜不能留观众说明书：${scrubbed.shots[0]?.visual}`,
  );
  console.log("PASS 收束编词和观众说明书会被清掉");

  assert(durationBudget(15) === 15 && durationBudget(12) === 15, "15秒预算不能被对白加总认成90");
  assert(durationBudget(90) === 90 && durationBudget(undefined) === 90, "90秒预算保持90");

  const longTitle =
    "中小企业做GEO为什么总是白忙一场，流量看起来很好，算法一改却全废了";
  const sample = {
    title: longTitle,
    bodyHtml: "<p>正文</p>",
    bodyMarkdown: "正文",
    bodyText: "正文",
    summary: "摘要",
    coverPath: null,
  };
  const baijia = polishForPlatform("baijiahao", sample);
  assert(
    baijia.title === longTitle,
    `百家号不能按抖音30字截标题：${baijia.title}`,
  );
  const douyinPolished = polishForPlatform("douyin", sample);
  assert(
    douyinPolished.title === longTitle,
    `抖音文章预览不能先截断标题：${douyinPolished.title}`,
  );
  assert(
    needsDouyinArticleTitleRewrite(longTitle) &&
      !needsDouyinArticleTitleRewrite("算法一改功夫全废"),
    "只有超过30字的抖音文章标题才需要重写",
  );
  console.log("PASS 抖音文章标题重写不连坐百家号、不截断");
  assert(
    scriptLlmTokenField("gpt-5.6-luna") === "max_completion_tokens" &&
      scriptLlmTokenField("deepseek-reasoner") === "max_tokens" &&
      scriptLlmTokenField("claude-sonnet-5") === "max_tokens",
    "GPT-5.6 Luna 必须用 max_completion_tokens，DeepSeek/Claude 仍用 max_tokens",
  );
  console.log("PASS GPT-5.6 Luna 用 max_completion_tokens");
  assert(
    characterHasLook({ angles: [{ url: "/a.png" }] }) &&
      characterHasLook({ photos_json: '[{"url":"/p.jpg"}]' }) &&
      !characterHasLook({ name: "沈探花" } as { photos_json?: string }),
    "有角色图才算已有外形",
  );
  console.log("PASS 已有角色图不再生成外形");
  assert(
    resolveVoicePath(undefined) === "native" &&
      resolveVoicePath("") === "native" &&
      resolveVoicePath("lipsync") === "lipsync" &&
      resolveVoicePath("tts") === "tts",
    "出片默认模型直接出声，对口型要显式点",
  );
  assert(
    shotCanLipSync({
      clipUrl: "/uploads/a.mp4",
      delivery: "line",
      speaker: "徐奉",
      voiceover: "你可明白？",
    }) &&
      !shotCanLipSync({
        clipUrl: "/uploads/a.mp4",
        delivery: "inner",
        speaker: "沈砚",
        voiceover: "这一帖，签了就是烙印。",
      }) &&
      !shotCanLipSync({
        delivery: "line",
        speaker: "徐奉",
        voiceover: "你可明白？",
      }),
    "对口型必须先有成片，内心独白跳过",
  );
  console.log("PASS 出片默认模型出声，对口型要成片且不是内心");
  assert(
    resolveInnerVoice("炸") === "high" &&
      parseInnerLevel("沈砚（内心·炸）") === "high" &&
      parseInnerLevel("沈砚（内心）") === "" &&
      shotInnerLevel({
        delivery: "inner",
        speaker: "沈砚",
        voiceover: "卧槽",
        innerLevel: "high",
      }) === "high",
    "内心强烈度要能从（内心·炸）读出来",
  );
  assert(
    innerSpeechTone("high").includes("夸张") &&
      !innerSpeechTone("high").includes("咽") &&
      innerVoiceWriteRules("off").includes("不要写内心独白") &&
      innerVoiceWriteRules("high").includes("内心·炸") &&
      innerNativeVoiceLine({
        speaker: "沈砚",
        voiceover: "卧槽",
        level: "high",
      }).includes("模型自己生成") &&
      innerNativeVoiceLine({
        speaker: "沈砚",
        voiceover: "卧槽",
        level: "high",
      }).includes("闭嘴"),
    "炸级独白必须夸张出声，写稿开关关掉就不写内心",
  );
  const boomShot = shotsFromJson(
    JSON.stringify([
      {
        index: 2,
        seconds: 4,
        speaker: "沈砚（内心·炸）",
        voiceover: "卧槽",
        visual: "特写沈砚闭嘴",
        onScreen: "卧槽",
        imagePrompt: "",
      },
    ]),
  )[0];
  assert(
    boomShot?.delivery === "inner" &&
      boomShot.innerLevel === "high" &&
      boomShot.speaker === "沈砚",
    "准稿（内心·炸）必须落成强烈内心镜",
  );
  console.log("PASS 内心独白分关/压/震/炸，炸级要夸张");
  assert(
    looksLikeManualScriptTitle("职场新人五步蜕变指南") &&
      looksLikeManualScriptTitle("从0到1实操攻略") &&
      !looksLikeManualScriptTitle("那张门生帖") &&
      !looksLikeManualScriptTitle("新人第一年别硬熬"),
    "剧本名不能起成指南/五步/攻略",
  );
  assert(
    pickScriptTitle("职场新人五步蜕变指南", "那张门生帖") === "那张门生帖" &&
      pickScriptTitle("那张门生帖", "职场新人五步蜕变指南") ===
        "那张门生帖" &&
      pickScriptTitle("指南", "攻略") === "",
    "合集名要跳过说明书，留下能用的剧名",
  );
  console.log("PASS 剧本名不能起成说明书");
  assert(
    stripPhotoLook("电影静帧 像拍戏 现场光") === "半写实插画 半写实插画 半写实插画" &&
      stripPhotoLook("写实风格") === "半写实插画" &&
      !/二次元|赛璐璐/.test(
        stripPhotoLook("插画短剧 二次元 赛璐璐 现场光"),
      ) &&
      !/真人实拍|照片级/.test(stripPhotoLook("真人实拍 照片级 现场光")),
    "默认半写实要把电影静帧和实拍词清掉",
  );
  assert(
    normalizeLookStyle("dark") === "dark" &&
      normalizeLookStyle("cel") === "cel" &&
      normalizeLookStyle("nope") === "semi" &&
      resolveLookStyle("gongbi").stillAlias === "工笔重彩" &&
      resolveLookStyle("cinema").id === "cinema",
    "合集画风要认目录里的档，生词回半写实",
  );
  assert(
    manhuaScenePrompt({
      who: "「徐奉」",
      visual: "徐奉按住红帖",
      lookStyle: "dark",
    }).includes("暗黑厚涂") &&
      manhuaScenePrompt({
        who: "「徐奉」",
        visual: "徐奉按住红帖",
        lookStyle: "cinema",
      }).includes("电影静帧") &&
      manhuaScenePrompt({
        who: "「徐奉」",
        visual: "徐奉按住红帖",
        lookStyle: "cel",
      }).includes("赛璐璐") &&
      stripPhotoLook("电影静帧 像拍戏", "cinema").includes("电影静帧") &&
      stripPhotoLook("电影静帧 大白天", "dark").includes("暗黑厚涂") &&
      manhuaVideoStyle("dark").includes("黑金") &&
      manhuaVideoStyle("semi").includes("和参考图一致") &&
      manhuaVideoStyle("cinema").includes("和参考图一致"),
    "画风要跟合集走，出片不要中途改风",
  );
  console.log("PASS 合集画风认目录并跟静帧走");
  assert(
    looksLikeImportedScript("徐奉：把帖子按住。\n沈砚：门生帖不是这么递的。") &&
      looksLikeImportedScript("【对话】\n第一集") &&
      !looksLikeImportedScript("GEO 是让大模型在答案里提到你的品牌。") &&
      resolveScriptSourceKind("script") === "script" &&
      resolveScriptSourceKind(undefined, "旁白：今夜府里没人睡。") === "script",
    "贴进来的对本要按原作改写，不要当成科普文",
  );
  console.log("PASS 导入剧本按原作改写");
  assert(
    guessImportedEpisodeCount("第1集\n徐奉：按住。\n第8集\n沈砚：门生帖不是这么递的。") === 8 &&
      guessImportedEpisodeCount("徐奉：按住。") === 1 &&
      leftoverImportedEpisodes("第1集\n\n第6集\n后面还有戏", 1) === 5 &&
      leftoverImportedEpisodes("x".repeat(2700), 1) === 2,
    "导入长本要认出还有几集，方便接着写续集",
  );
  console.log("PASS 导入长本能估续集");
  assert(
    looksLikeCharacterName("徐奉") &&
      looksLikeCharacterName("沈砚") &&
      looksLikeCharacterName("司马生") &&
      !looksLikeCharacterName("官差扔过签子") &&
      !looksLikeCharacterName("目光像刀") &&
      !looksLikeCharacterName("把衣裳甩进她怀里") &&
      !looksLikeCharacterName("居然笑了") &&
      !looksLikeCharacterName("她按住玉佩") &&
      collectDialogueCast(
        "官差扔过签子：徐奉把签子扔过去。\n徐奉：把帖子按住。\n目光像刀：\n沈砚：门生帖不是这么递的。\n居然笑了：她没接。",
      ).join(",") === "徐奉,沈砚" &&
      parseStanceCards([
        {
          name: "目光像刀",
          role: "被压的人",
          stance: "被压",
          knows: "旧套",
          wants: "面子",
          address: "称呼",
          never: "不要",
        },
        {
          name: "徐奉",
          role: "拿主意的人",
          stance: "压人",
          knows: "判断",
          wants: "改口径",
          address: "直说",
          never: "请示",
        },
      ]).map((c) => c.name).join(",") === "徐奉" &&
      resolveStanceCards(
        embedStanceNotes("", [
          {
            name: "又立刻摸土",
            role: "在场的人",
            stance: "插一句",
            knows: "看见的",
            wants: "说完",
            address: "称呼",
            never: "抢拍板",
            intro: "",
          },
          {
            name: "霍北辰",
            role: "边关守将",
            stance: "认定罪妻通敌",
            knows: "边关失守的口供",
            wants: "让她按自己的口径认",
            address: "直呼罪妻",
            never: "把通敌写成误会",
            intro: "霍北辰是边关守将，认定罪妻通敌，要她按自己的口径认。",
          },
        ]),
        ["霍北辰", "沈清禾"],
      )
        .map((c) => c.name)
        .join(",") === "霍北辰",
    "认角色只收对白里的人名，不收镜头动作",
  );
  console.log("PASS 认角色只收人名");

  const canned = {
    name: "霍北辰",
    role: "拿主意的人",
    stance: "压「罪妻」改一件事，不要反过来请示",
    knows: "关键判断在他这边",
    wants: "让对方按他的口径改",
    address: "对「罪妻」可以直说、可以顶",
    never: "不要向「罪妻」请教自己早该知道的事，不要把拍板权让出去",
    intro: "",
  };
  assert(isCannedStanceCard(canned), "压/被压模板必须能认出来");
  assert(
    resolveStanceCards(embedStanceNotes("", [canned]), ["霍北辰"]).length === 0,
    "角色大纲不能用压/被压模板顶上去",
  );
  assert(
    formatCastOutline([
      {
        name: "霍北辰",
        role: "边关守将",
        stance: "认定罪妻通敌",
        knows: "边关失守的口供",
        wants: "让她按自己的口径认",
        address: "直呼罪妻",
        never: "把通敌写成误会",
        intro: "霍北辰是边关守将，认定罪妻通敌，要她按自己的口径认。",
      },
    ]).includes("边关守将") &&
      !formatCastOutline([canned]).includes("拿主意的人"),
    "角色大纲要写准稿里的身份，不要套拿主意的人",
  );
  console.log("PASS 角色大纲用准稿介绍，不用压/被压模板");

  const hollowTurns = splitLabeledTurns(
    "【对话】司马生：今天就说这一句。普通人：普通人：",
  );
  assert(
    hollowTurns.length === 1 && hollowTurns[0].includes("今天就说这一句"),
    `空的说话人标签不该单独成句：${hollowTurns.join("|")}`,
  );
  const hollowEp = parseEpisodeList(
    JSON.stringify([
      {
        episode_no: 1,
        title: "空镜应丢掉",
        hook: "今天就说这一句。",
        voiceover: "【对话】司马生：今天就说这一句。普通人：",
        shots: [
          {
            visual: "办公室对峙",
            speaker: "司马生",
            voiceover: "今天就说这一句。",
          },
          {
            visual: "竖屏讲解画面，配合「普通人：」",
            speaker: "普通人",
            voiceover: "普通人：",
            onScreen: "普通人：这个",
          },
        ],
      },
    ]),
    1,
    90,
    "dialogue",
  )[0];
  assert(
    hollowEp.shots.length === 1 && !hollowEp.shots.some((s) => isHollowShot(s)),
    `空镜应丢掉：${hollowEp.shots.map((s) => `${s.index}:${s.voiceover}`).join("|")}`,
  );
  assert(
    !hollowEp.voiceover.includes("普通人"),
    `准稿不该留空说话人：${hollowEp.voiceover}`,
  );
  const afterDelete = removeShot(
    [
      { index: 1, seconds: 6, visual: "一", onScreen: "", voiceover: "第一句。" },
      { index: 2, seconds: 6, visual: "二", onScreen: "", voiceover: "第二句。" },
      { index: 3, seconds: 6, visual: "三", onScreen: "", voiceover: "第三句。" },
    ],
    2,
  );
  assert(
    afterDelete.length === 2 &&
      afterDelete[0].index === 1 &&
      afterDelete[1].index === 2 &&
      afterDelete[1].voiceover === "第三句。",
    "删中间镜后要重排并留下后镜",
  );
  assert(
    voiceoverFromShots(afterDelete, "dialogue").includes("第三句"),
    `删镜后准稿：${voiceoverFromShots(afterDelete, "dialogue")}`,
  );
  console.log("PASS 空镜丢掉，单镜可删并重排");

  const grammar = applyShotEmotionGrammar(
    [
      {
        index: 1,
        seconds: 5,
        visual: "两人端坐全景讲规矩",
        onScreen: "",
        voiceover: "帖已经在桌上。",
        imagePrompt: "",
        speaker: "徐奉",
        beat: "钩",
      },
      {
        index: 2,
        seconds: 5,
        visual: "徐奉冷着脸",
        onScreen: "",
        voiceover: "你可明白？",
        imagePrompt: "",
        speaker: "徐奉",
        beat: "顶",
      },
      {
        index: 3,
        seconds: 5,
        visual: "沈砚抬头",
        onScreen: "签了就是死",
        voiceover: "我签。",
        imagePrompt: "",
        speaker: "沈砚",
        beat: "打",
      },
    ],
    { insert: true, mutateVisual: true, shotMax: 8, show: true },
  );
  assert(grammar[0]?.beat === "钩", "第一镜必须是钩");
  assert(
    /特写/.test(grammar[0]?.visual || "") && !/端坐全景/.test(grammar[0]?.visual || ""),
    `第一镜必须改成特写：${grammar[0]?.visual}`,
  );
  assert(
    grammar.some((s) => s.beat === "停" && inferSoundRole(s) !== "speak"),
    `顶之后必须有留白/内心，不能接着开口：${grammar.map((s) => `${s.beat}:${inferSoundRole(s)}`).join("|")}`,
  );
  assert(
    grammar.some((s) => s.beat === "打" && s.voiceover.includes("我签")),
    "打的对白不能被反应镜吃掉",
  );
  const hold = grammar.find((s) => s.beat === "停");
  assert(
    hold && inferSoundRole(hold) === "hold" && !hold.voiceover,
    `停必须是留白：${hold?.soundRole} ${hold?.voiceover}`,
  );
  assert(hold?.join === "cut" && hold.camera === "特写", "停必须切到反应特写");
  const stopTalk = applyShotEmotionGrammar(
    [
      {
        index: 1,
        seconds: 4,
        visual: "特写脸",
        onScreen: "凭什么",
        voiceover: "凭什么。",
        imagePrompt: "",
        speaker: "沈砚",
        beat: "停",
      },
    ],
    { insert: false, mutateVisual: false },
  )[0];
  assert(
    inferSoundRole(stopTalk) === "inner" && stopTalk.delivery === "inner",
    `停有词要收成内心：${stopTalk.soundRole} ${stopTalk.delivery}`,
  );
  console.log("PASS 节拍语法补反应镜，声音分开口/内心/一声/留白");

  const talkHook = applyShotEmotionGrammar(
    [
      {
        index: 1,
        seconds: 4,
        visual:
          "司马生坐着，表情冷峻，直视镜头，手里无物。结束时嘴角微动，要开口",
        onScreen: "",
        voiceover: "那根本不叫内容营销，那叫偶尔写点东西。",
        imagePrompt: "",
        speaker: "司马生",
        beat: "钩",
        look: "说话的人",
      },
    ],
    { insert: true, mutateVisual: true, show: false },
  )[0];
  assert(
    !/要开口|嘴角微动/.test(talkHook.visual) &&
      /已经张嘴|正在说/.test(talkHook.visual),
    `口播第一镜必须已经开口：${talkHook.visual}`,
  );
  assert(
    shotSpeaksFromStart(talkHook) && talkHook.look === "说话的人",
    "口播钩是说话的人，第一帧出声",
  );
  assert(
    /已经张嘴/.test(ensureTalkHookVisual("结束时嘴角微动，要开口")),
    "酝酿词要改成已经开口",
  );
  console.log("PASS 口播第一镜语言钩子，不先酝酿");

  assert(defaultRenderVoicePath("talk") === "tts", "口播默认 TTS 对口型");
  assert(defaultRenderVoicePath("isekai") === "native", "短剧默认模型出声");
  assert(episodePace(15, 30).shotSecMax === 8, "15 秒集仍钳 8 秒");
  assert(episodePace(90, 15).shotSecMax === 15, "2.0 的 90 秒集钳 15");
  assert(episodePace(90, 30).shotSecMax === 30, "2.5 的 90 秒集可到 30");
  assert(secondsFromAudio(20, { maxSec: 15 }) === 15, "锁声跟 2.0 钳 15");
  assert(secondsFromAudio(20, { maxSec: 30 }) === 21, "锁声跟 2.5 可过 15");
  assert(videoWaitLimitMs(30) === 600_000, "30 秒片等待按 duration*20");
  assert(videoWaitLimitMs(8) === 180_000, "短片等待至少 180 秒");

  const talkDrive = {
    index: 1,
    seconds: 5,
    visual: "近景已经张嘴",
    onScreen: "",
    voiceover: "那根本不叫内容营销。",
    imagePrompt: "",
    soundRole: "speak" as const,
    speechUrl: "/api/uploads/a.mp3",
    startUrl: "/api/uploads/s.jpg",
    endUrl: "/api/uploads/e.jpg",
    framesOk: true,
  };
  assert(shotNeedsLockedSpeech(talkDrive), "开口镜要锁声");
  assert(shotCanAudioDrive(talkDrive), "过片+锁声且无成片才能 TTS 对口型");
  assert(
    !shotCanAudioDrive({ ...talkDrive, clipUrl: "/api/uploads/c.mp4" }),
    "已有成片不要走 audio-drive",
  );
  assert(
    speakShotsMissingLock([{ ...talkDrive, speechUrl: undefined }]).join() === "1",
    "缺 speechUrl 要拦",
  );
  assert(
    talkTimelineLines({ durationSec: 5, first: true, talk: true })[0].includes(
      "0-0.3s",
    ),
    "口播时间轴第一段必须 0-0.3s 已在说",
  );
  const plate = parseShotPlate({
    size: "近景",
    angle: "平视",
    framing: "说话的人",
    light: "面光",
    grade: "暗",
    motion: "已在说",
  });
  assert(plate?.size === "近景" && plate.motion === "已在说", "plate 能读回来");
  assert(talkHookPlate().size === "近景" && talkHookPlate().motion === "已在说", "口播钩板");
  assert(
    inferShotPlate({ camera: "特写", visual: "手", beat: "钩" }).size === "特写",
    "旧 camera 景别要认回 plate",
  );
  assert(
    inferShotPlate({
      visual: "司马生穿西装坐着已经张嘴正在说",
      beat: "钩",
    }).framing === "",
    "没写 plate 时构图不要把画面整段塞进去",
  );
  assert(
    inferShotPlate({
      visual: "司马生穿西装坐着已经张嘴正在说",
      plate: {
        size: "近景",
        angle: "平视",
        framing: "司马生穿西装坐着已经张嘴",
        light: "面光",
        grade: "跟本剧画风",
        motion: "已在说",
      },
    }).framing === "",
    "构图抄了 visual 要清掉",
  );

  const judged = reviewDirectedShots(
    {
      episode_no: 1,
      title: "测",
      hook: "那根本不叫。",
      voiceover: "那根本不叫。",
      shots: [
        {
          index: 1,
          seconds: 4,
          visual: "近景已经张嘴正在说",
          onScreen: "",
          voiceover: "那根本不叫。",
          imagePrompt: "",
          beat: "钩",
          join: "cut",
          plate: talkHookPlate(),
          soundRole: "speak",
        },
        {
          index: 2,
          seconds: 4,
          visual: "还是近景",
          onScreen: "",
          voiceover: "",
          imagePrompt: "",
          beat: "共",
          join: "cut",
          plate: { ...talkHookPlate(), motion: "停" },
          soundRole: "hold",
        },
      ],
    },
    [],
    false,
  );
  assert(
    judged.issues.some((row) => /景别没换/.test(row)),
    `切镜同景别要打回：${judged.issues.join("；")}`,
  );

  const qa = reviewShotPullSheet([
    {
      index: 1,
      seconds: 5,
      visual: "近景",
      onScreen: "",
      voiceover: "第一句。",
      imagePrompt: "",
      soundRole: "speak",
      join: "cut",
      plate: talkHookPlate(),
      clipUrl: "/api/uploads/a.mp4",
      speechOnsetSec: 1.6,
    },
    {
      index: 2,
      seconds: 4,
      visual: "近景",
      onScreen: "",
      voiceover: "第二句。",
      imagePrompt: "",
      soundRole: "speak",
      join: "cut",
      plate: talkHookPlate(),
      speaker: "司马生",
      voiceId: "b",
    },
  ]);
  assert(
    qa[0].flags.includes("late-open") && qa[0].flags.includes("no-speech"),
    `第一镜要标开口晚和没锁声：${qa[0].flags.join(",")}`,
  );
  assert(
    qa[1].flags.includes("same-size") && qa[1].flags.includes("no-speech"),
    `第二镜要标景别没换：${qa[1].flags.join(",")}`,
  );
  console.log("PASS 闸门、plate、2.5 clamp、口播 voicePath、拉片");

  console.log("ALL PARSE TESTS PASSED");
}

main();
