import {
  hasSunoReady,
  resolveSunoApiBase,
  resolveSunoApiKey,
} from "@/lib/ai/model-catalog/music-seed";

export type SunoTrack = {
  id: string;
  audioUrl: string;
  streamAudioUrl?: string;
  title?: string;
  duration?: number;
};

export type SunoTaskState = {
  status: "pending" | "processing" | "ready" | "failed";
  error?: string;
  tracks: SunoTrack[];
};

function mapSunoError(code?: number, msg?: string): string {
  const text = String(msg || "").trim();
  const lower = text.toLowerCase();
  if (
    code === 429 ||
    /insufficient|top up|credits?/.test(lower)
  ) {
    return "音乐通道积分不够了。请到 sunoapi.org 给当前 Key 充值后再出歌。";
  }
  if (code === 401 || /unauthorized|invalid.*key/.test(lower)) {
    return "音乐通道 Key 无效，请检查 SUNO_API_KEY。";
  }
  if (code === 405 || /rate limit|too frequent|frequency/.test(lower)) {
    return "出歌太频繁，稍等再试。";
  }
  if (code === 413 || /too long/.test(lower)) {
    return "歌词或曲风太长，缩短后再出歌。";
  }
  return text || "音乐生成任务创建失败";
}

function siteOrigin() {
  return (process.env.SITE_URL || "https://dianwu.tech").replace(/\/$/, "");
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`音乐服务没有返回内容（${res.status}）`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `音乐服务响应无效（${res.status}）${text.slice(0, 80)}`,
    );
  }
}

export async function startSunoGeneration(input: {
  jobId: string;
  prompt: string;
  title: string;
  style: string;
  model: string;
  vocalGender?: "m" | "f";
  instrumental?: boolean;
  /**
   * 可选目标时长。V5_5 + customMode 时上游会硬切到这个秒数，
   * 容易被汽水判「末尾截断」；默认不传，靠歌词结构和曲风说明自然收尾。
   */
  durationSec?: number;
}): Promise<{ taskId: string }> {
  if (!hasSunoReady()) throw new Error("还没配音乐生成。环境里写 SUNO_API_KEY");
  const apiKey = resolveSunoApiKey();
  const instrumental = input.instrumental === true;
  const customMode = !instrumental && Boolean(input.prompt.trim());
  const model = input.model || process.env.SUNO_MODEL || "V5";
  const rawDuration = Number(input.durationSec);
  const wantsHardDuration =
    Number.isFinite(rawDuration) && rawDuration > 0;
  const durationSec = wantsHardDuration
    ? Math.min(360, Math.max(60, Math.round(rawDuration)))
    : 0;
  // sunoapi：duration 仅 customMode + V5_5 生效，且是硬切，默认不要传
  const supportsDuration =
    wantsHardDuration && customMode && /^V5_5$/i.test(model);
  try {
    const res = await fetch(`${resolveSunoApiBase()}/api/v1/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customMode,
        instrumental,
        prompt: customMode
          ? input.prompt
          : input.style || input.prompt || input.title,
        ...(customMode
          ? { style: input.style, title: input.title }
          : {}),
        model,
        vocalGender: input.vocalGender || "m",
        negativeTags:
          "abrupt ending, cut off mid phrase, truncated ending, sudden stop",
        ...(supportsDuration ? { duration: durationSec } : {}),
        callBackUrl: `${siteOrigin()}/api/music/callback?jobId=${encodeURIComponent(input.jobId)}`,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const data = await parseJson<{
      code?: number;
      msg?: string;
      data?: { taskId?: string };
    }>(res);
    if (!res.ok || data.code !== 200 || !data.data?.taskId) {
      throw new Error(mapSunoError(data.code, data.msg));
    }
    return { taskId: data.data.taskId };
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error("音乐服务超时，请再试一次");
    }
    throw err;
  }
}

function mapStatus(raw?: string): SunoTaskState["status"] {
  switch (raw) {
    case "SUCCESS":
    case "FIRST_SUCCESS":
      return "ready";
    case "CREATE_TASK_FAILED":
    case "GENERATE_AUDIO_FAILED":
    case "SENSITIVE_WORD_ERROR":
    case "CALLBACK_EXCEPTION":
      return "failed";
    default:
      return "processing";
  }
}

export async function fetchSunoTask(taskId: string): Promise<SunoTaskState> {
  if (!hasSunoReady()) throw new Error("还没配音乐生成。环境里写 SUNO_API_KEY");
  const apiKey = resolveSunoApiKey();
  const res = await fetch(
    `${resolveSunoApiBase()}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  const data = await parseJson<{
    code?: number;
    msg?: string;
    data?: {
      status?: string;
      errorMessage?: string;
      response?: {
        sunoData?: Array<{
          id?: string;
          audioUrl?: string;
          streamAudioUrl?: string;
          title?: string;
          duration?: number;
        }>;
      };
    };
  }>(res);
  if (!res.ok || data.code !== 200) {
    throw new Error(mapSunoError(data.code, data.msg) || "查询生成任务失败");
  }
  const status = mapStatus(data.data?.status);
  const tracks = (data.data?.response?.sunoData || [])
    .map((row) => ({
      id: String(row.id || ""),
      audioUrl: String(row.audioUrl || "").trim(),
      streamAudioUrl: String(row.streamAudioUrl || "").trim() || undefined,
      title: row.title,
      duration: row.duration,
    }))
    .filter((row) => row.id && (row.audioUrl || row.streamAudioUrl));
  const ready = tracks.some((row) => row.audioUrl);
  if (status === "failed") {
    return {
      status: "failed",
      error: data.data?.errorMessage || data.msg || "生成失败",
      tracks,
    };
  }
  if (ready) return { status: "ready", tracks };
  return { status: "processing", tracks };
}
