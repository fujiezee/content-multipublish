import type { AiModelInput } from "@/lib/ai/model-catalog/types";
import { CLOUDFLARE_AI_MODEL_SEED } from "@/lib/ai/model-catalog/cloudflare-seed";
import { MUSIC_AI_MODEL_SEED } from "@/lib/ai/model-catalog/music-seed";
import { PROXY_AI_MODEL_SEED } from "@/lib/ai/model-catalog/proxy-seed";
import { QWEN_AI_MODEL_SEED } from "@/lib/ai/model-catalog/qwen-seed";
import { CURSOR_AI_MODEL_SEED } from "@/lib/ai/model-catalog/cursor-seed";

/** 直连通道 + 代理站精选 + 百炼千问 + 点悟 Suno + Workers AI。之后以 Admin 为准；migrate 会补种缺失 slug。 */
export const DEFAULT_AI_MODEL_SEED: AiModelInput[] = [
  // —— 文本：DeepSeek 直连（slug 兼容旧名，上游走 V4）——
  {
    slug: "deepseek-reasoner",
    label: "DeepSeek 思考",
    hint: "写剧本默认。先想再写 JSON",
    modality: "text",
    uses: ["script", "shot", "copywriting", "review"],
    provider: "deepseek",
    providerModel: "deepseek-v4-pro",
    costHint: "约 ¥0.02/集",
    sortOrder: 10,
    fallbackSlug: "deepseek-chat",
    badges: ["recommended"],
  },
  {
    slug: "deepseek-chat",
    label: "DeepSeek 对话",
    hint: "更快，适合改一集",
    modality: "text",
    uses: ["script", "shot", "copywriting", "review"],
    provider: "deepseek",
    providerModel: "deepseek-v4-flash",
    costHint: "约 ¥0.01/集",
    sortOrder: 20,
    badges: ["recommended"],
  },
  // —— 文本：Cursor API（Composer / Grok）——
  ...CURSOR_AI_MODEL_SEED,
  // —— 文本 / 出图：openai-proxy 精选 ——
  ...PROXY_AI_MODEL_SEED,
  // —— 文本 / 出图：阿里云百炼千问 ——
  ...QWEN_AI_MODEL_SEED,
  // —— 文本：方舟豆包（可选） ——
  {
    slug: "doubao-seed",
    label: "豆包 Seed",
    hint: "国内延迟低，适合写稿",
    modality: "text",
    uses: ["copywriting", "script", "review"],
    provider: "doubao",
    providerModel: "doubao-seed-2-0-lite-260428",
    costHint: "国内",
    sortOrder: 50,
    enabled: false,
  },
  // —— 图片：方舟 Seedream ——
  {
    slug: "seedream-5.0",
    label: "Seedream-5.0",
    hint: "画质细，适合角色图",
    modality: "image",
    uses: ["character"],
    provider: "ark",
    providerModel: "doubao-seedream-5-0-260128",
    sortOrder: 10,
  },
  {
    slug: "seedream-4.5",
    label: "Seedream-4.5",
    hint: "更跟指令，适合精细角色图",
    modality: "image",
    uses: ["character"],
    provider: "ark",
    providerModel: "doubao-seedream-4-5-251128",
    sortOrder: 20,
  },
  {
    slug: "seedream-4.0",
    label: "Seedream-4.0",
    hint: "构图稳，适合角色图",
    modality: "image",
    uses: ["character"],
    provider: "ark",
    providerModel: "doubao-seedream-4-0-250828",
    sortOrder: 30,
  },
  // —— 视频 ——
  {
    slug: "seedance-2-mini",
    label: "Seedance-2.0-mini",
    hint: "能直接出声，适合短片试看",
    modality: "video",
    uses: ["video"],
    provider: "ark",
    providerModel: "doubao-seedance-2-0-mini-260615",
    config: {
      resolutions: ["480p", "720p"],
      maxSec: 15,
      generateAudio: true,
    },
    sortOrder: 10,
  },
  {
    slug: "seedance-2-fast",
    label: "Seedance-2.0-fast",
    hint: "比 mini 更清，出片更快",
    modality: "video",
    uses: ["video"],
    provider: "ark",
    providerModel: "doubao-seedance-2-0-fast-260128",
    config: {
      resolutions: ["480p", "720p"],
      maxSec: 15,
      generateAudio: true,
    },
    sortOrder: 20,
  },
  {
    slug: "seedance-2-0",
    label: "Seedance-2.0",
    hint: "动作自然，能跟参考",
    modality: "video",
    uses: ["video"],
    provider: "ark",
    providerModel: "doubao-seedance-2-0-260128",
    config: {
      resolutions: ["480p", "720p"],
      maxSec: 15,
      generateAudio: true,
    },
    sortOrder: 30,
  },
  {
    slug: "seedance-2-5",
    label: "Seedance-2.5",
    hint: "单镜能到 30 秒，动作更稳",
    modality: "video",
    uses: ["video"],
    provider: "ark",
    providerModel: "doubao-seedance-2-5-260628",
    config: {
      resolutions: ["480p", "720p"],
      maxSec: 30,
      generateAudio: true,
    },
    sortOrder: 40,
  },
  // —— 语音 ——
  {
    slug: "ark-tts-default",
    label: "方舟 TTS",
    hint: "中文配音稳，适合分镜",
    modality: "audio",
    uses: ["tts"],
    provider: "ark",
    providerModel: "default",
    sortOrder: 10,
    enabled: true,
  },
  // —— 音乐：点悟 music 同款 Suno ——
  ...MUSIC_AI_MODEL_SEED,
  // —— 文本：Cloudflare Workers AI ——
  ...CLOUDFLARE_AI_MODEL_SEED,
];
