import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import {
  createJobs,
  getArticleInWorkspace,
  listJobsByArticle,
  updateJob,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import {
  isExtensionTimeoutError,
  isJobOkStatus,
  jobStatusFromExtensionResult,
  extensionResultTip,
} from "@/lib/job-status";
import {
  ALL_PLATFORM_IDS,
  type JobStatus,
  type PlatformId,
  type PublishJob,
} from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

type IncomingResult = {
  platform?: string;
  success?: boolean;
  error?: string;
  postUrl?: string;
  url?: string;
  draftOnly?: boolean;
  awaitingUserPublish?: boolean;
  outcome?: JobStatus;
  message?: string;
};

type IncomingEntry = {
  id?: string;
  title?: string;
  timestamp?: number;
  results?: IncomingResult[];
};

const PLATFORM_SET = new Set<string>(ALL_PLATFORM_IDS);

function normalizeTitle(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function sameResult(
  a: PublishJob,
  status: JobStatus,
  url: string | null,
  error: string | null,
) {
  if (a.status !== status) return false;
  if ((a.result_url || null) !== (url || null)) return false;
  if (status === "failed") {
    return (a.error || "") === (error || "");
  }
  return true;
}

/**
 * Import extension popup syncHistory rows into this article's publish_jobs.
 * Body: { title?: string, entries?: IncomingEntry[] }
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id: articleId } = await ctx.params;
  if (!getArticleInWorkspace(articleId, auth.ctx.workspaceId)) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const articleTitle = normalizeTitle(body.title);
  const entries = Array.isArray(body.entries)
    ? (body.entries as IncomingEntry[])
    : [];

  if (!entries.length) {
    return NextResponse.json({
      jobs: listJobsByArticle(articleId),
      imported: 0,
    });
  }

  const matched = entries.filter((entry) => {
    if (!articleTitle) return false;
    const entryTitle = normalizeTitle(entry.title);
    if (!entryTitle) return false;
    return (
      entryTitle === articleTitle ||
      entryTitle.includes(articleTitle) ||
      articleTitle.includes(entryTitle)
    );
  });

  const existing = listJobsByArticle(articleId);
  let imported = 0;

  for (const entry of matched) {
    const results = Array.isArray(entry.results) ? entry.results : [];
    const ts =
      typeof entry.timestamp === "number" && entry.timestamp > 0
        ? new Date(entry.timestamp).toISOString()
        : new Date().toISOString();

    for (const result of results) {
      const platformRaw = String(result.platform || "").trim();
      if (!PLATFORM_SET.has(platformRaw)) continue;
      const platform = platformRaw as PlatformId;
      const status = jobStatusFromExtensionResult(result);
      const resultUrl = (result.postUrl || result.url || null) as string | null;
      const error = extensionResultTip(result, status);

      const dup = existing.find(
        (j) =>
          j.platform === platform &&
          j.engine === "extension" &&
          sameResult(j, status, resultUrl, error),
      );
      if (dup) continue;

      const latest = existing.find(
        (j) => j.platform === platform && j.engine === "extension",
      );
      const inflight =
        latest &&
        (latest.status === "running" ||
          latest.status === "pending" ||
          (latest.status === "failed" &&
            (isJobOkStatus(status) ||
              isExtensionTimeoutError(latest.error))));
      if (inflight && latest) {
        const updated = updateJob(latest.id, {
          status,
          result_url: resultUrl,
          error,
          engine: "extension",
        });
        if (updated) {
          Object.assign(latest, updated);
          imported += 1;
        }
        continue;
      }
      if (latest && isJobOkStatus(latest.status)) {
        continue;
      }

      const job: PublishJob = {
        id: randomUUID(),
        article_id: articleId,
        platform,
        status,
        result_url: resultUrl,
        error,
        screenshot_path: null,
        engine: "extension",
        created_at: ts,
        updated_at: ts,
      };
      createJobs([job]);
      existing.unshift(job);
      imported += 1;
    }
  }

  if (imported > 0) {
    await persistCloudflareDb();
  }

  return NextResponse.json({
    jobs: listJobsByArticle(articleId),
    imported,
    matchedEntries: matched.length,
  });
}
