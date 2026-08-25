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

export function isBenignExtensionError(error?: string | null): boolean {
  if (!error?.trim()) return false;
  return /-32000|cannot attach to the target|debugger is already attached|another debugger|detached while handling|target closed|message port closed/i.test(
    error,
  );
}

/** User-facing job tip from an extension sync row — hide CDP noise when sync succeeded. */
export function extensionResultTip(
  result: ExtLike,
  status: JobStatus,
): string | null {
  if (status === "failed") {
    const err = result.error || "扩展同步失败";
    if (isBenignExtensionError(err) && result.message) return result.message;
    return err;
  }
  if (status === "filled_awaiting_publish") {
    return (
      result.message ||
      (isBenignExtensionError(result.error)
        ? "已填入，请在平台窗口确认后点发布"
        : result.error) ||
      "已填入，请在平台窗口确认后点发布"
    );
  }
  return null;
}

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

export function isExtensionTimeoutError(error?: string | null): boolean {
  if (!error) return false;
  return /超时|未返回该平台结果|还停在同步中|没有新进度|扩展无响应|扩展未返回/.test(
    error,
  );
}

/** Do not regress a later status (e.g. published) back to「待你发布」或误报超时. */
export function shouldReplaceJobStatus(
  from: JobStatus | undefined,
  to: JobStatus,
): boolean {
  if (!from) return true;
  if (from === to) return false;
  if (from === "published") return false;
  if (isJobOkStatus(from) && to === "failed") return false;
  if (
    to === "filled_awaiting_publish" &&
    (from === "draft_ok" || from === "success")
  ) {
    return false;
  }
  return true;
}

/** Editor / 填稿页 URL — not a live article, so don't label it「查看文章」. */
export function isPlatformEditorUrl(
  platform: string,
  url?: string | null,
): boolean {
  if (!url) return false;
  const id = platform.toLowerCase();
  if (id === "shunqi") return /news_add/i.test(url);
  if (id === "shunqi_product") return /product_add/i.test(url);
  if (id === "bafang") return /pg=Supply|pg=Product/i.test(url);
  if (id === "xiaohongshu") {
    return /edith\.xiaohongshu|creator\.xiaohongshu/i.test(url);
  }
  if (id === "douyin") {
    return /creator-micro\/content\/(upload|post\/image|post\/video|post\/article)/i.test(
      url || "",
    );
  }
  if (id === "weixin") {
    return (
      /mp\.weixin\.qq\.com\/cgi-bin\/appmsg/i.test(url) &&
      /action=edit|appmsg_edit/i.test(url)
    );
  }
  return false;
}

export function platformPublishMode(
  platform: string,
): "draft" | "fill_confirm" | "weak" {
  const id = platform.toLowerCase();
  if (
    id === "xiaohongshu" ||
    id === "douyin" ||
    id === "weixin" ||
    id === "shunqi" ||
    id === "shunqi_product" ||
    id === "bafang"
  ) {
    return "fill_confirm";
  }
  if (id === "x") return "weak";
  return "draft";
}
