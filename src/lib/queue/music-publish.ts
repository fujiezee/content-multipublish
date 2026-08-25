import {
  createMusicPublishJob,
  failRunningMusicPublishJobs,
  getArticle,
  getMusicPublishJob,
  getVideoSeriesByArticle,
  updateMusicPublishJob,
} from "@/lib/db";
import {
  parseSeriesMusic,
  sanitizeSongTitle,
} from "@/lib/ai/video-music";
import type { JobStatus, MusicPublishJob } from "@/lib/types";
import type { MusicPublishPlatformId } from "@/lib/music-publish-platforms";
import { MUSIC_PUBLISH_PLATFORMS } from "@/lib/music-publish-platforms";

function absolutizeAudioUrl(raw: string, origin: string): string {
  const s = raw.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return `${origin.replace(/\/$/, "")}${s}`;
  return s;
}

function playableUrl(track: { url?: string; streamUrl?: string }): string {
  return String(track.url || track.streamUrl || "").trim();
}

function coverUrlOf(
  music: ReturnType<typeof parseSeriesMusic>,
  track: { coverUrl?: string },
): string {
  return String(track.coverUrl || music.coverUrl || "").trim();
}

export function prepareSeriesMusicPublish(input: {
  articleId: string;
  trackId?: string;
  platform: MusicPublishPlatformId;
  origin: string;
}): {
  job: MusicPublishJob;
  audioUrl: string;
  coverUrl: string;
  title: string;
  lyrics: string;
  message: string;
} {
  const allowed = MUSIC_PUBLISH_PLATFORMS.some(
    (row) => row.id === input.platform,
  );
  if (!allowed) {
    throw new Error("这一路目前只支持发到汽水或抖音");
  }

  failRunningMusicPublishJobs();
  const series = getVideoSeriesByArticle(input.articleId);
  if (!series) throw new Error("找不到这首歌对应的剧本");
  const music = parseSeriesMusic(series.music_json);
  const tracks = music.tracks.filter((row) => playableUrl(row));
  if (!tracks.length) throw new Error("还没有可发布的音频");

  const track =
    tracks.find((row) => row.id === input.trackId) ||
    tracks.find((row) => row.id === music.selectedTrackId) ||
    tracks[0];
  if (!track) throw new Error("找不到要发布的版本");

  const audioRaw = playableUrl(track);
  if (!audioRaw) throw new Error("这一版还没有音频地址");

  const article = getArticle(input.articleId);
  const title =
    sanitizeSongTitle(music.songTitle || track.title || "") ||
    sanitizeSongTitle(series.title || "") ||
    sanitizeSongTitle(article?.title || "") ||
    "未名曲";
  const lyrics = String(series.lyrics || "").trim().slice(0, 2000);

  const job = createMusicPublishJob({
    articleId: input.articleId,
    seriesId: series.id,
    trackId: track.id,
    platform: input.platform,
  });

  const coverRaw = coverUrlOf(music, track);
  const where =
    input.platform === "qishui" ? "汽水音乐合作平台" : "抖音音乐开放平台";
  return {
    job,
    audioUrl: absolutizeAudioUrl(audioRaw, input.origin),
    coverUrl: coverRaw ? absolutizeAudioUrl(coverRaw, input.origin) : "",
    title,
    lyrics,
    message: `正在用扩展打开${where}，请在打开的标签核对后点发布`,
  };
}

const JOB_STATUSES: readonly JobStatus[] = [
  "pending",
  "running",
  "draft_ok",
  "filled_awaiting_publish",
  "published",
  "success",
  "failed",
];

export function applyMusicPublishOutcome(input: {
  jobId: string;
  workspaceId: string;
  status?: string;
  error?: string | null;
  resultUrl?: string | null;
}): MusicPublishJob {
  const current = getMusicPublishJob(input.jobId);
  if (!current) throw new Error("找不到这条发布记录");
  const article = getArticle(current.article_id);
  if (
    article?.workspace_id &&
    article.workspace_id !== input.workspaceId &&
    input.workspaceId !== "ws_local"
  ) {
    throw new Error("找不到这条发布记录");
  }
  const status = JOB_STATUSES.includes(input.status as JobStatus)
    ? (input.status as JobStatus)
    : current.status;
  const next = updateMusicPublishJob(input.jobId, {
    status,
    error: input.error === undefined ? current.error : input.error,
    result_url:
      input.resultUrl === undefined ? current.result_url : input.resultUrl,
  });
  if (!next) throw new Error("找不到这条发布记录");
  return next;
}
