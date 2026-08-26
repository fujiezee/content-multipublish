import { randomUUID } from "node:crypto";
import { requireApiUser } from "@/lib/auth/api";
import { listTtsSpeechModels, listTtsVoices } from "@/lib/ai/ark-tts";
import { generatePodcastCover } from "@/lib/ai/cover";
import { resolveCoverImageModelId } from "@/lib/ai/image-gen-models";
import {
  DEFAULT_PODCAST_GUEST_VOICE,
  DEFAULT_PODCAST_HOST_VOICE,
  DEFAULT_PODCAST_TTS_MODEL,
  emptyPodcastRow,
  detectArticleOralCopy,
  normalizePodcastMode,
  parsePodcastTurns,
  podcastCoverBrief,
  podcastSpeakerName,
  publicPodcast,
  speakPodcastTurns,
  writePodcastScript,
  type PodcastScript,
} from "@/lib/ai/podcast";
import { listScriptLlmOptions, withScriptLlm } from "@/lib/ai/script-llm";
import {
  listHumanTalkModelOptions,
  polishPodcastScript,
  withHumanTalk,
} from "@/lib/ai/human-talk-agent";
import { resolveTtsSpeechModel } from "@/lib/ai/tts-voice-ids";
import {
  peekQuota,
  refundQuota,
  tryConsumeQuota,
} from "@/lib/billing/account";
import {
  getArticleInWorkspace,
  getArticlePodcastByArticle,
  saveArticlePodcast,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import type { Article, ArticlePodcast, PodcastMode } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

async function tryPodcastCover(input: {
  workspaceId: string;
  email: string;
  article: Article;
  script: PodcastScript;
  mode: PodcastMode;
  onProgress?: (message: string) => void;
}): Promise<{ url: string | null; detail?: string }> {
  const coverModel = resolveCoverImageModelId();
  const coverSnap = peekQuota(input.workspaceId, "images");
  const coverAllowed =
    coverSnap.kind === "images" &&
    (coverSnap.remaining === "unlimited" ||
      (typeof coverSnap.remaining === "number" && coverSnap.remaining >= 1));
  if (!coverAllowed) return { url: null, detail: "图额度不够，封面没出" };
  const gate = tryConsumeQuota(
    input.workspaceId,
    "images",
    1,
    coverModel,
    input.email,
  );
  if (!gate.ok) return { url: null, detail: gate.error || "图额度不够，封面没出" };
  try {
    input.onProgress?.("正在出封面…");
    const brief = podcastCoverBrief(input.article, input.script);
    const cover = await generatePodcastCover({
      ...brief,
      mode: input.mode,
      model: coverModel,
    });
    return { url: cover.url };
  } catch (err) {
    refundQuota(input.workspaceId, "images", 1, coverModel, input.email);
    const detail = err instanceof Error ? err.message : "封面失败";
    console.error("[podcast cover]", detail);
    return { url: null, detail: "封面没出成" };
  }
}

function payload(articleId: string, workspaceId: string) {
  const article = getArticleInWorkspace(articleId, workspaceId);
  const oral = article ? detectArticleOralCopy(article) : null;
  return {
    podcast: publicPodcast(getArticlePodcastByArticle(articleId)),
    voices: listTtsVoices(workspaceId),
    scriptModels: listScriptLlmOptions(),
    reviewModels: listHumanTalkModelOptions(),
    ttsModels: listTtsSpeechModels(),
    oralScript: oral
      ? { mode: oral.mode, turns: oral.turns.length }
      : null,
    defaults: {
      hostVoice: DEFAULT_PODCAST_HOST_VOICE,
      guestVoice: DEFAULT_PODCAST_GUEST_VOICE,
      ttsModel: DEFAULT_PODCAST_TTS_MODEL,
    },
  };
}

export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!getArticleInWorkspace(id, auth.ctx.workspaceId)) {
    return Response.json({ error: "文章不存在" }, { status: 404 });
  }
  return Response.json(payload(id, auth.ctx.workspaceId));
}

function scriptFromRow(row: ArticlePodcast): PodcastScript | null {
  const turns = parsePodcastTurns(row.turns_json);
  if (!turns.length) return null;
  return {
    title: row.title || "口播",
    turns: turns.map((turn) => ({
      speaker: turn.speaker,
      text: turn.text,
      feel: turn.feel,
    })),
  };
}

function persistScriptTurns(
  row: ArticlePodcast,
  script: PodcastScript,
  mode: PodcastMode,
) {
  row.title = script.title;
  row.mode = mode;
  row.status = "draft";
  row.error = null;
  row.audio_url = null;
  row.duration_sec = 0;
  row.turns_json = JSON.stringify(
    script.turns.map((turn, i) => ({
      index: i + 1,
      speaker: turn.speaker,
      name: podcastSpeakerName(turn.speaker, mode),
      text: turn.text,
      feel: turn.feel || "",
      audioUrl: "",
      durationSec: 0,
    })),
  );
}

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const article = getArticleInWorkspace(id, auth.ctx.workspaceId);
  if (!article) {
    return Response.json({ error: "文章不存在" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    mode?: string;
    hostVoice?: string;
    guestVoice?: string;
    model?: string;
    ttsModel?: string;
    reviewModel?: string;
    coverOnly?: boolean;
    stage?: "script" | "speak";
  };
  const bodyText = `${article.title || ""}${article.summary || ""}${article.body || ""}`.replace(
    /<[^>]+>/g,
    " ",
  );
  if (bodyText.replace(/\s+/g, "").length < 80) {
    return Response.json({ error: "先把正文写够一段，再出播客" }, { status: 400 });
  }

  if (body.coverOnly) {
    const existing = getArticlePodcastByArticle(id);
    if (!existing || existing.status !== "ready") {
      return Response.json({ error: "先生成播客，再出封面" }, { status: 400 });
    }
    const turns = parsePodcastTurns(existing.turns_json);
    if (turns.length === 0) {
      return Response.json({ error: "播客还没有对白，先生成" }, { status: 400 });
    }
    const mode = normalizePodcastMode(existing.mode);
    const cover = await tryPodcastCover({
      workspaceId: auth.ctx.workspaceId,
      email: auth.ctx.email,
      article,
      mode,
      script: {
        title: existing.title || article.title || "口播",
        turns: turns.map((turn) => ({
          speaker: turn.speaker,
          text: turn.text,
          feel: turn.feel,
        })),
      },
    });
    if (!cover.url) {
      return Response.json(
        { error: cover.detail || "封面没出成", podcast: publicPodcast(existing) },
        { status: 400 },
      );
    }
    existing.cover_url = cover.url;
    saveArticlePodcast(existing);
    await persistCloudflareDb();
    return Response.json({ podcast: publicPodcast(existing) });
  }

  const stage = body.stage === "speak" ? "speak" : "script";
  const detectedOral = detectArticleOralCopy(article);
  const existing = getArticlePodcastByArticle(id);
  const mode =
    stage === "speak"
      ? normalizePodcastMode(existing?.mode || body.mode)
      : detectedOral?.mode ?? normalizePodcastMode(body.mode);
  const hostVoice =
    String(body.hostVoice || existing?.host_voice || "").trim() ||
    DEFAULT_PODCAST_HOST_VOICE;
  const guestVoice =
    String(body.guestVoice || existing?.guest_voice || "").trim() ||
    DEFAULT_PODCAST_GUEST_VOICE;
  const ttsModel = String(body.ttsModel || existing?.tts_model || "").trim()
    ? resolveTtsSpeechModel(body.ttsModel || existing?.tts_model)
    : DEFAULT_PODCAST_TTS_MODEL;

  if (stage === "speak") {
    if (!existing) {
      return Response.json({ error: "先写出对谈，再配音" }, { status: 400 });
    }
    const script = scriptFromRow(existing);
    if (!script) {
      return Response.json({ error: "还没有对白，先写对谈" }, { status: 400 });
    }
    existing.host_voice = hostVoice;
    existing.guest_voice = guestVoice;
    existing.tts_model = ttsModel;
    existing.status = "pending";
    existing.error = null;
    saveArticlePodcast(existing);
    await persistCloudflareDb();

    const encoder = new TextEncoder();
    const writeLine = (
      controller: ReadableStreamDefaultController<Uint8Array>,
      event: Record<string, unknown>,
    ) => {
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    };
    const row = existing;
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          writeLine(controller, {
            type: "progress",
            message:
              mode === "solo"
                ? `口播已确认，共 ${script.turns.length} 段，开始按情绪配音…`
                : `对谈已确认，共 ${script.turns.length} 轮，开始按情绪配音…`,
          });
          const coverPromise = tryPodcastCover({
            workspaceId: auth.ctx.workspaceId,
            email: auth.ctx.email,
            article,
            script,
            mode,
            onProgress: (message) =>
              writeLine(controller, { type: "progress", message }),
          });
          const [spoken, cover] = await Promise.all([
            speakPodcastTurns({
              script,
              mode,
              hostVoice,
              guestVoice,
              ttsModel,
              onProgress: async (message, index, total) => {
                writeLine(controller, { type: "progress", message, index, total });
                if (index % 3 === 0) await persistCloudflareDb();
              },
            }),
            coverPromise,
          ]);
          row.title = script.title;
          row.status = "ready";
          row.error = null;
          row.audio_url = spoken.audioUrl;
          if (cover.url) row.cover_url = cover.url;
          row.duration_sec = spoken.durationSec;
          row.turns_json = JSON.stringify(spoken.turns);
          saveArticlePodcast(row);
          await persistCloudflareDb();
          if (!cover.url && cover.detail) {
            writeLine(controller, { type: "progress", message: cover.detail });
          }
          writeLine(controller, {
            type: "done",
            podcast: publicPodcast(row),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "配音失败";
          row.status = "draft";
          row.error = message;
          saveArticlePodcast(row);
          await persistCloudflareDb();
          writeLine(controller, { type: "error", error: message });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(readable, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const row: ArticlePodcast = {
    ...(existing || emptyPodcastRow(id)),
    id: existing?.id || randomUUID(),
    article_id: id,
    mode,
    host_voice: hostVoice,
    guest_voice: guestVoice,
    tts_model: ttsModel,
    status: "pending",
    error: null,
  };
  saveArticlePodcast(row);
  await persistCloudflareDb();

  const encoder = new TextEncoder();
  const writeLine = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: Record<string, unknown>,
  ) => {
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
  };

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        writeLine(controller, {
          type: "progress",
          message: detectedOral
            ? detectedOral.mode === "solo"
              ? `正文已是单人口播，共 ${detectedOral.turns.length} 段，正在过人话审核…`
              : `正文已是双人对谈，共 ${detectedOral.turns.length} 轮，正在过人话审核…`
            : mode === "solo"
              ? "正在写口播…"
              : "正在写对谈…",
        });
        const draft = await withScriptLlm(body.model, () =>
          writePodcastScript({ article, mode }),
        );
        if (!detectedOral) {
          writeLine(controller, {
            type: "progress",
            message: "正在过人话审核…",
          });
        }
        const script = await withHumanTalk(
          auth.ctx.workspaceId,
          body.reviewModel,
          () => polishPodcastScript(draft),
        );
        persistScriptTurns(row, script, mode);
        saveArticlePodcast(row);
        await persistCloudflareDb();
        writeLine(controller, {
          type: "progress",
          message:
            mode === "solo"
              ? `口播已写好，共 ${script.turns.length} 段。先改到你点头，再配音。`
              : `对谈已写好，共 ${script.turns.length} 轮。先改到你点头，再配音。`,
        });
        writeLine(controller, {
          type: "done",
          podcast: publicPodcast(row),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "生成播客失败";
        const hasTurns = parsePodcastTurns(row.turns_json).length > 0;
        row.status = hasTurns ? "draft" : "failed";
        row.error = message;
        saveArticlePodcast(row);
        await persistCloudflareDb();
        writeLine(controller, { type: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!getArticleInWorkspace(id, auth.ctx.workspaceId)) {
    return Response.json({ error: "文章不存在" }, { status: 404 });
  }
  const existing = getArticlePodcastByArticle(id);
  if (!existing) {
    return Response.json({ error: "还没有播客稿" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    hostVoice?: string;
    guestVoice?: string;
    ttsModel?: string;
    turns?: Array<{ speaker?: string; text?: string; feel?: string }>;
  };
  if (typeof body.title === "string" && body.title.trim()) {
    existing.title = body.title.trim().slice(0, 24);
  }
  if (typeof body.hostVoice === "string" && body.hostVoice.trim()) {
    existing.host_voice = body.hostVoice.trim();
  }
  if (typeof body.guestVoice === "string" && body.guestVoice.trim()) {
    existing.guest_voice = body.guestVoice.trim();
  }
  if (typeof body.ttsModel === "string" && body.ttsModel.trim()) {
    existing.tts_model = resolveTtsSpeechModel(body.ttsModel);
  }
  if (Array.isArray(body.turns)) {
    const mode = normalizePodcastMode(existing.mode);
    const turns = body.turns
      .map((turn) => ({
        speaker: turn.speaker === "guest" ? ("guest" as const) : ("host" as const),
        text: String(turn.text || "").trim(),
        feel: String(turn.feel || "").trim().slice(0, 36),
      }))
      .filter((turn) => turn.text);
    if (!turns.length) {
      return Response.json({ error: "对白不能全删掉" }, { status: 400 });
    }
    persistScriptTurns(existing, { title: existing.title, turns }, mode);
  }
  saveArticlePodcast(existing);
  await persistCloudflareDb();
  return Response.json({ podcast: publicPodcast(existing) });
}
