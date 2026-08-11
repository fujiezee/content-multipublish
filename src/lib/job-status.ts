import type { JobStatus, PublishResult } from "@/lib/types";

/** Terminal statuses that mean the automated sync step finished (not necessarily published). */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  "draft_ok",
  "filled_awaiting_publish",
  "published",
  "success",
  "failed",
] as const;

export function isTerminalJobStatus(status: JobStatus): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

export function isJobOkStatus(status: JobStatus): boolean {
  return (
    status === "draft_ok" ||
    status === "filled_awaiting_publish" ||
    status === "published" ||
    status === "success"
  );
}

/** Map Playwright / adapter PublishResult → job status. */
export function jobStatusFromPublishResult(result: PublishResult): JobStatus {
  if (result.outcome) return result.outcome;
  if (result.awaitingUserPublish) return "filled_awaiting_publish";
  if (!result.success) return "failed";
  if (result.draftOnly === false && result.url) return "published";
  if (result.draftOnly !== false) return "draft_ok";
  return "success";
}

type ExtLike = {
  success?: boolean;
  error?: string;
  postUrl?: string;
  url?: string;
  draftOnly?: boolean;
  awaitingUserPublish?: boolean;
  outcome?: string;
  message?: string;
  platform?: string;
};

/** Map extension sync result row → job status. */
export function jobStatusFromExtensionResult(result: ExtLike): JobStatus {
  if (
    result.outcome &&
    isTerminalJobStatus(result.outcome as JobStatus)
  ) {
    return result.outcome as JobStatus;
  }
  if (result.awaitingUserPublish) return "filled_awaiting_publish";
  if (!result.success) return "failed";

  const msg = `${result.message || ""} ${result.error || ""}`;
  if (
    /待你发布|确认后点|填入标题|填入编辑器|awaiting_user_publish|filled_awaiting/i.test(
      msg,
    )
  ) {
    return "filled_awaiting_publish";
  }
  if (result.draftOnly === false && (result.postUrl || result.url)) {
    return "published";
  }
  // Most extension adapters are draft-first
  if (result.draftOnly !== false) return "draft_ok";
  return "success";
}

export function platformPublishMode(
  platform: string,
): "draft" | "fill_confirm" | "weak" {
  const id = platform.toLowerCase();
  if (id === "xiaohongshu" || id === "douyin") return "fill_confirm";
  if (id === "x") return "weak";
  return "draft";
}
