import { isLocalWorkspaceUser } from "@/lib/auth/local";
import type {
  DraftAdapter,
  DraftAdapterArticle,
  DraftAuthResult,
  DraftPublishResult,
} from "@/lib/draft-adapters/types";

function directoryUrl(): string {
  const base = (
    process.env.DIANWU_DIRECTORY_URL || "https://dianwu.ai"
  ).replace(/\/$/, "");
  return `${base}/api/directory`;
}

function directorySecret(): string {
  return (
    process.env.DIANWU_DIRECTORY_SECRET?.trim() ||
    process.env.DIRECTORY_PUBLISH_SECRET?.trim() ||
    ""
  );
}

export function createDianwuDirectoryAdapter(): DraftAdapter {
  return {
    id: "dianwu",
    async checkAuth(): Promise<DraftAuthResult> {
      if (!directorySecret()) {
        return {
          isAuthenticated: false,
          error: "未配置 DIANWU_DIRECTORY_SECRET，无法推送到点物目录",
        };
      }
      return {
        isAuthenticated: true,
        userId: "local",
        username: "本地工作区",
      };
    },
    async publishDraft(article: DraftAdapterArticle): Promise<DraftPublishResult> {
      const secret = directorySecret();
      if (!secret) {
        return { success: false, error: "未配置 DIANWU_DIRECTORY_SECRET" };
      }
      const markdown = (article.markdown ?? "").trim();
      if (!article.title.trim() || !markdown) {
        return { success: false, error: "标题和正文不能为空" };
      }

      const res = await fetch(directoryUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          title: article.title.trim(),
          markdown,
          description: article.summary?.trim() || undefined,
          sourceId: article.sourceId,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        url?: string;
        slug?: string;
      };
      if (!res.ok) {
        return {
          success: false,
          error: data.error || `点物目录返回 ${res.status}`,
        };
      }
      return {
        success: true,
        live: true,
        postUrl: data.url,
        postId: data.slug,
      };
    },
  };
}

export function assertLocalDirectoryPublisher(
  user: {
    userId?: string;
    id?: string;
    email?: string;
    workspaceId?: string;
    workspace_id?: string;
  } | null,
): string | null {
  if (!isLocalWorkspaceUser(user)) {
    return "只有本地工作区账号可以推送到点物目录";
  }
  return null;
}
