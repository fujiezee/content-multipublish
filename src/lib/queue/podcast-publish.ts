import {
  createPodcastPublishJob,
  failRunningPodcastPublishJobs,
  getArticle,
  getArticlePodcastByArticle,
  getPodcastPublishJob,
  updatePodcastPublishJob,
} from "@/lib/db";
import { parsePodcastTurns } from "@/lib/ai/podcast-shared";
import {
  rewritePublicMediaUrl,
  toAbsoluteMediaUrl,
} from "@/lib/content/media-urls";
import type { JobStatus, PodcastPublishJob } from "@/lib/types";
import type { PodcastPublishPlatformId } from "@/lib/podcast-publish-platforms";
import { PODCAST_PUBLISH_PLATFORMS } from "@/lib/podcast-publish-platforms";

function publicUrl(raw: string, origin: string): string {
  const rewritten = rewritePublicMediaUrl(String(raw || "").trim());
  if (!rewritten) return "";
  return toAbsoluteMediaUrl(rewritten, origin);
}

function stripHtml(html: string): string {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function shownotesOf(input: {
  title: string;
  summary: string;
  turnsText: string;
}): string {
  const parts = [input.title, input.summary, input.turnsText].filter(Boolean);
  return parts.join("\n\n").slice(0, 4000);
}

export function preparePodcastPublish(input: {
  articleId: string;
  platform: PodcastPublishPlatformId;
  origin: string;
}): {
  job: PodcastPublishJob;
  audioUrl: string;
  coverUrl: string;
  title: string;
  shownotes: string;
  message: string;
} {
  const allowed = PODCAST_PUBLISH_PLATFORMS.some(
    (row) => row.id === input.platform,
  );
  if (!allowed) {
    throw new Error("这一路目前只支持发到小宇宙");
  }

  failRunningPodcastPublishJobs();
  const podcast = getArticlePodcastByArticle(input.articleId);
  if (!podcast) throw new Error("这篇还没有播客");
  if (podcast.status !== "ready") throw new Error("播客还没生成完");
  const audioRaw = String(podcast.audio_url || "").trim();
  if (!audioRaw) throw new Error("还没有可发布的音频，请先生成播客");

  const article = getArticle(input.articleId);
  const title =
    String(podcast.title || "").trim() ||
    String(article?.title || "").trim() ||
    "未命名单集";
  const turns = parsePodcastTurns(podcast.turns_json);
  const turnsText = turns
    .map((row) => `${row.name}：${row.text}`.trim())
    .filter(Boolean)
    .join("\n\n");
  const summary =
    String(article?.summary || "").trim() ||
    stripHtml(article?.body || "").slice(0, 400);

  const job = createPodcastPublishJob({
    articleId: input.articleId,
    podcastId: podcast.id,
    platform: input.platform,
  });

  const coverRaw = String(podcast.cover_url || article?.cover_path || "").trim();
  return {
    job,
    audioUrl: publicUrl(audioRaw, input.origin),
    coverUrl: coverRaw ? publicUrl(coverRaw, input.origin) : "",
    title: title.slice(0, 80),
    shownotes: shownotesOf({ title, summary, turnsText }),
    message: "正在用扩展打开小宇宙主播后台，请在打开的标签核对后点发布",
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

export function applyPodcastPublishOutcome(input: {
  jobId: string;
  workspaceId: string;
  status?: string;
  error?: string | null;
  resultUrl?: string | null;
}): PodcastPublishJob {
  const current = getPodcastPublishJob(input.jobId);
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
  const next = updatePodcastPublishJob(input.jobId, {
    status,
    error: input.error === undefined ? current.error : input.error,
    result_url:
      input.resultUrl === undefined ? current.result_url : input.resultUrl,
  });
  if (!next) throw new Error("找不到这条发布记录");
  return next;
}
