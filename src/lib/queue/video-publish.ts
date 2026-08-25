import {
  createVideoPublishJob,
  failRunningVideoPublishJobs,
  getArticle,
  getVideoEpisode,
  getVideoPublishJob,
  getVideoSeries,
  updateVideoPublishJob,
} from "@/lib/db";
import type { JobStatus, VideoPublishJob } from "@/lib/types";
import type { VideoPublishPlatformId } from "@/lib/video-publish-platforms";

function stripDialogue(text: string): string {
  return String(text || "")
    .replace(/【对话】|【旁白】/g, " ")
    .replace(/^[^\n：:]{1,16}（内心[^）]*）：[^\n]*/gm, " ")
    .replace(/^[^\n：:]{1,16}：[^\n]*/gm, " ")
    .replace(/[「」""][^「」""]{0,40}[」""]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function videoPlotIntro(input: {
  seriesTitle?: string;
  episodeTitle?: string;
  logline?: string;
  premise?: string;
  recap?: string;
}): string {
  const logline = stripDialogue(input.logline || "");
  const recap = stripDialogue(input.recap || "");
  const premise = stripDialogue(input.premise || "").slice(0, 120);
  const plot = [logline, recap || premise].filter(Boolean).join(" ").trim();
  if (plot) return plot.slice(0, 300);
  return [input.seriesTitle, input.episodeTitle]
    .map((row) => String(row || "").trim())
    .filter(Boolean)
    .join(" · ")
    .slice(0, 80);
}

function absolutizeVideoUrl(raw: string, origin: string): string {
  const s = raw.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return `${origin.replace(/\/$/, "")}${s}`;
  return s;
}

export function prepareEpisodeVideoPublish(input: {
  episodeId: string;
  platform: VideoPublishPlatformId;
  origin: string;
}): {
  job: VideoPublishJob;
  videoUrl: string;
  title: string;
  description: string;
  message: string;
} {
  if (input.platform !== "douyin") {
    throw new Error("这一路目前只支持发到抖音");
  }
  failRunningVideoPublishJobs();
  const episode = getVideoEpisode(input.episodeId);
  if (!episode) throw new Error("找不到这一集");
  if (!episode.video_url?.trim()) throw new Error("这一集还没有成片");

  const series = getVideoSeries(episode.series_id);
  if (!series?.article_id) throw new Error("找不到这一集的剧本");
  const article = getArticle(series.article_id);
  const title = (episode.title || series.title || article?.title || "成片").trim();
  const description = videoPlotIntro({
    seriesTitle: series.title,
    episodeTitle: episode.title,
    logline: series.logline,
    premise: series.premise,
    recap: episode.recap,
  });

  const job = createVideoPublishJob({
    episodeId: episode.id,
    articleId: series.article_id,
    platform: "douyin",
  });
  return {
    job,
    videoUrl: absolutizeVideoUrl(episode.video_url, input.origin),
    title,
    description,
    message: "正在用扩展打开抖音上传成片，请在打开的标签里核对后点发布",
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

export function applyVideoPublishOutcome(input: {
  jobId: string;
  workspaceId: string;
  status?: string;
  error?: string | null;
  resultUrl?: string | null;
}): VideoPublishJob {
  const current = getVideoPublishJob(input.jobId);
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
  const next = updateVideoPublishJob(input.jobId, {
    status,
    error: input.error === undefined ? current.error : input.error,
    result_url:
      input.resultUrl === undefined ? current.result_url : input.resultUrl,
  });
  if (!next) throw new Error("找不到这条发布记录");
  return next;
}
