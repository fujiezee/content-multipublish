import {
  DEFAULT_ARK_VIDEO_PRESET,
  resolveArkVideoPreset,
} from "@/lib/ai/ark-video";
import { requireApiUser } from "@/lib/auth/api";
import { consumeOrRespond, refundQuota } from "@/lib/billing/account";
import { dubEpisodeVideo, generateEpisodeVideo } from "@/lib/ai/video-gen";
import {
  mergeShotsByIndex,
  shotsFromJson,
  shotsHaveClips,
  shotsMissingFrameApproval,
  shotsMissingScenes,
  shotsToJson,
} from "@/lib/ai/video-script";
import { parseAngles } from "@/lib/ai/character-sheet";
import {
  extractSeriesWardrobe,
  parseDirectorLock,
  parseSeriesWardrobe,
  seriesWardrobeToJson,
} from "@/lib/ai/director-lock";
import {
  getArticleInWorkspace,
  getBoundStudioCharacter,
  getVideoEpisode,
  getVideoSeriesByArticle,
  listSeriesCharacters,
  setVideoEpisodeRender,
  updateVideoEpisodeFields,
  updateVideoSeriesFields,
} from "@/lib/db";
import { defaultRenderVoicePath, isShowStyle } from "@/lib/ai/video-script-styles";
import {
  parseSeriesMusic,
  selectedMusicUrl,
} from "@/lib/ai/video-music";
import {
  normalizeSpeakMode,
  resolveVoicePath,
  shotCanLipSync,
  shotIsInner,
  speakShotsMissingLock,
} from "@/lib/types";
import type { VideoShot } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 800;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!getArticleInWorkspace(id, auth.ctx.workspaceId)) {
    return Response.json({ error: "文章不存在" }, { status: 404 });
  }
  const series = getVideoSeriesByArticle(id);
  const body = await req.json().catch(() => ({}));
  const episodeId = String(body.episodeId || "");
  const episode = episodeId ? getVideoEpisode(episodeId) : undefined;
  if (!series || !episode || episode.series_id !== series.id) {
    return Response.json({ error: "分集不存在" }, { status: 404 });
  }
  const dubOnly = body.dubOnly === true;
  const composeOnly = body.composeOnly === true;
  const shotIndex = Number(body.shotIndex);
  const onlyIndexes =
    Number.isFinite(shotIndex) && shotIndex > 0 ? [shotIndex] : [];
  if (!dubOnly && episode.confirmed !== 1) {
    return Response.json({ error: "先确认本集剧本，再生成视频" }, { status: 400 });
  }
  const shots = shotsFromJson(episode.shots_json);
  if (dubOnly && !episode.video_url) {
    return Response.json(
      { error: "还没有成片，先出一版画面再补旁白" },
      { status: 400 },
    );
  }
  if (!dubOnly && composeOnly && !shotsHaveClips(shots)) {
    return Response.json(
      { error: "还有分镜没有出片，先按镜出完再合成" },
      { status: 400 },
    );
  }
  const voicePathEarly = body.voicePath
    ? resolveVoicePath(body.voicePath)
    : defaultRenderVoicePath(series.hook_style);
  if (!dubOnly && !composeOnly) {
    if (voicePathEarly === "lipsync") {
      const picked = onlyIndexes.length
        ? shots.filter((shot) => onlyIndexes.includes(shot.index))
        : shots.filter(shotCanLipSync);
      if (picked.some(shotIsInner)) {
        return Response.json(
          { error: "内心独白不用对口型" },
          { status: 400 },
        );
      }
      if (!picked.some(shotCanLipSync)) {
        return Response.json(
          { error: "先出片再对口型。内心独白不用对口型" },
          { status: 400 },
        );
      }
      const missingScenes = shotsMissingScenes(picked.filter(shotCanLipSync));
      if (missingScenes.length > 0) {
        return Response.json(
          {
            error: `第 ${missingScenes.join("、")} 镜还没有头尾关键帧，先出图再出片`,
          },
          { status: 400 },
        );
      }
    } else {
      const pending = onlyIndexes.length
        ? shots.filter((shot) => onlyIndexes.includes(shot.index))
        : shots.filter((shot) => !shot.clipUrl?.trim());
      const missingScenes = shotsMissingScenes(pending);
      if (missingScenes.length > 0) {
        return Response.json(
          {
            error: `第 ${missingScenes.join("、")} 镜还没有头尾关键帧，先出图再出片`,
          },
          { status: 400 },
        );
      }
      const missingOk = shotsMissingFrameApproval(pending);
      if (missingOk.length > 0) {
        return Response.json(
          {
            error: `第 ${missingOk.join("、")} 镜静帧还没过片，点过片后再出片`,
          },
          { status: 400 },
        );
      }
      const missingSpeech = speakShotsMissingLock(pending);
      if (missingSpeech.length > 0) {
        return Response.json(
          {
            error: `第 ${missingSpeech.join("、")} 镜还没锁声，先按对白出声再出片`,
          },
          { status: 400 },
        );
      }
    }
  }

  let chargedSeconds = 0;
  const videoMeter = resolveArkVideoPreset(
    typeof body.model === "string" ? body.model : DEFAULT_ARK_VIDEO_PRESET,
  ).id;
  if (!dubOnly && !composeOnly) {
    const picked = onlyIndexes.length
      ? shots.filter((shot) => onlyIndexes.includes(shot.index))
      : shots.filter((shot) => !shot.clipUrl?.trim());
    chargedSeconds = picked.reduce(
      (sum, shot) => sum + Math.max(1, Math.round(Number(shot.seconds) || 0)),
      0,
    );
    if (chargedSeconds > 0) {
      const denied = consumeOrRespond(
        auth.ctx.workspaceId,
        "videoSeconds",
        chargedSeconds,
        videoMeter,
        auth.ctx.email,
      );
      if (denied) return denied;
    }
  }

  setVideoEpisodeRender(episode.id, {
    video_status: "generating",
    video_error: null,
    video_url: episode.video_url,
  });

  const voiceId =
    typeof body.voiceId === "string" && body.voiceId.trim()
      ? body.voiceId.trim()
      : getBoundStudioCharacter(id)?.voice_id || series.voice_id;

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
        let latest: VideoShot[] = shots;
        const onProgress = async (event: {
          index: number;
          total: number;
          done: number;
          message: string;
          shot?: VideoShot;
        }) => {
          if (event.shot) {
            latest = latest.map((row) =>
              row.index === event.shot?.index ? event.shot : row,
            );
            updateVideoEpisodeFields(episode.id, {
              shots_json: shotsToJson(latest),
            });
          }
          writeLine(controller, { type: "progress", ...event });
        };
        const cast = listSeriesCharacters(id);
        if (dubOnly) {
          const out = await dubEpisodeVideo(
            {
              videoUrl: episode.video_url || "",
              voiceover:
                episode.voiceover ||
                shots
                  .map((s) => s.voiceover)
                  .filter(Boolean)
                  .join(""),
              voiceId,
            },
            onProgress,
          );
          const saved = setVideoEpisodeRender(episode.id, {
            video_status: "ready",
            video_url: out.url,
            video_model: out.model,
            video_error: null,
          });
          writeLine(controller, { type: "done", episode: saved, shots: latest });
          return;
        }
        const voicePath = voicePathEarly;
        const autoLipSync =
          body.autoLipSync === true &&
          voicePath === "native" &&
          isShowStyle(series.hook_style);
        const lipIndexes = (
          onlyIndexes.length
            ? onlyIndexes
            : shots
                .filter((shot) => !shot.clipUrl?.trim())
                .map((shot) => shot.index)
        );
        const common = {
          seriesTitle: series.title,
          episodeNo: episode.episode_no,
          title: episode.title,
          hook: episode.hook,
          voiceover: episode.voiceover,
          onScreen: episode.on_screen,
          durationSec: episode.duration_sec,
          aspectRatio: "9:16" as const,
          characterName: cast
            .map((row) => row.name.trim())
            .filter(Boolean)
            .join("、"),
          characterAngles: cast.flatMap((row) =>
            parseAngles(row.angles_json || "[]"),
          ),
          presetId: typeof body.model === "string" ? body.model : undefined,
          speakMode: normalizeSpeakMode(body.speakMode ?? series.speak_mode),
          innerVoice: series.inner_voice,
          voiceId,
          cast: cast.map((row) => ({
            id: row.id,
            name: row.name,
            voice_id: row.voice_id,
          })),
          stanceNotes: series.notes,
          lookStyle: series.look_style,
          hookStyle: series.hook_style,
          director: parseDirectorLock(episode.director_json),
          bedMusic: body.bedMusic === true || body.bed_music === true,
          bedSongUrl: (() => {
            const music = parseSeriesMusic(series.music_json);
            if (music.mixIntoVideo === false) return undefined;
            return selectedMusicUrl(music) || undefined;
          })(),
          onlyIndexes,
          composeOnly,
        };
        let out = await generateEpisodeVideo(
          {
            ...common,
            shots,
            voicePath,
          },
          onProgress,
        );
        if (out.shots?.length) {
          latest = mergeShotsByIndex(shots, out.shots);
          updateVideoEpisodeFields(episode.id, {
            shots_json: shotsToJson(latest),
          });
        }
        const readyLipIndexes = lipIndexes.filter((index) =>
          shotCanLipSync(latest.find((shot) => shot.index === index)),
        );
        if (autoLipSync && !composeOnly && readyLipIndexes.length > 0) {
          writeLine(controller, {
            type: "progress",
            index: readyLipIndexes[0] || 0,
            total: readyLipIndexes.length,
            done: 0,
            message: "出片后自动对口型…",
          });
          out = await generateEpisodeVideo(
            {
              ...common,
              shots: latest,
              voicePath: "lipsync",
              onlyIndexes: readyLipIndexes,
            },
            onProgress,
          );
          if (out.shots?.length) {
            latest = mergeShotsByIndex(latest, out.shots);
            updateVideoEpisodeFields(episode.id, {
              shots_json: shotsToJson(latest),
            });
          }
        }
        updateVideoSeriesFields(series.id, {
          wardrobe_json: seriesWardrobeToJson(
            extractSeriesWardrobe(
              latest,
              parseSeriesWardrobe(series.wardrobe_json),
            ),
          ),
        });
        const saved = setVideoEpisodeRender(episode.id, {
          video_status: out.composed || episode.video_url ? "ready" : "idle",
          video_url: out.url || episode.video_url,
          source_video_url:
            out.sourceUrl !== undefined
              ? out.sourceUrl
              : episode.source_video_url,
          subtitle_url:
            out.subtitleUrl !== undefined
              ? out.subtitleUrl
              : episode.subtitle_url,
          caption_cues_json: out.captionCues
            ? JSON.stringify(out.captionCues)
            : episode.caption_cues_json,
          video_model: out.model,
          video_error: null,
        });
        writeLine(controller, {
          type: "done",
          episode: saved,
          shots: latest,
          composed: out.composed,
        });
      } catch (err) {
        if (chargedSeconds > 0) {
          refundQuota(
            auth.ctx.workspaceId,
            "videoSeconds",
            chargedSeconds,
            videoMeter,
            auth.ctx.email,
          );
        }
        const message = err instanceof Error ? err.message : "生成视频失败";
        setVideoEpisodeRender(episode.id, {
          video_status: "failed",
          video_error: message,
        });
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
