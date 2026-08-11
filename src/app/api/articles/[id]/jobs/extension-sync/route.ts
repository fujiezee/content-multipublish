import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createJobs, listJobsByArticle, updateJob } from "@/lib/db";
import { jobStatusFromExtensionResult } from "@/lib/job-status";
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

function sameResult(a: PublishJob, status: JobStatus, url: string | null, error: string | null) {
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
  const { id: articleId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const articleTitle = normalizeTitle(body.title);
  const entries = Array.isArray(body.entries)
    ? (body.entries as IncomingEntry[])
    : [];

  if (!entries.length) {
    return NextResponse.json({ jobs: listJobsByArticle(articleId), imported: 0 });
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
  const createdOrUpdated: PublishJob[] = [];
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
      const error =
        status === "failed"
          ? String(result.error || "扩展同步失败")
          : status === "filled_awaiting_publish"
            ? String(
                result.message ||
                  result.error ||
                  "已填入，请在平台窗口确认后点发布",
              )
            : null;

      const dup = existing.find(
        (j) =>
          j.platform === platform &&
          j.engine === "extension" &&
          sameResult(j, status, resultUrl, error),
      );
      if (dup) continue;

      const running = existing.find(
        (j) =>
          j.platform === platform &&
          j.engine === "extension" &&
          (j.status === "running" || j.status === "pending"),
      );
      if (running) {
        const updated = updateJob(running.id, {
          status,
          result_url: resultUrl,
          error,
          engine: "extension",
        });
        if (updated) {
          createdOrUpdated.push(updated);
          Object.assign(running, updated);
          imported += 1;
        }
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
      createdOrUpdated.push(job);
      imported += 1;
    }
  }

  return NextResponse.json({
    jobs: listJobsByArticle(articleId),
    imported,
    matchedEntries: matched.length,
  });
}
