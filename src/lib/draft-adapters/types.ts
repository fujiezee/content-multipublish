import type { PlatformId, PublishContent } from "@/lib/types";

export type DraftAuthResult = {
  isAuthenticated: boolean;
  userId?: string;
  username?: string;
  error?: string;
};

export type DraftPublishResult = {
  success: boolean;
  postUrl?: string;
  postId?: string;
  error?: string;
};

export type DraftAdapterArticle = {
  title: string;
  html?: string;
  markdown?: string;
  coverPath?: string | null;
};

export interface DraftAdapter {
  id: PlatformId;
  checkAuth(): Promise<DraftAuthResult>;
  publishDraft(article: DraftAdapterArticle): Promise<DraftPublishResult>;
}

export function contentToDraftArticle(
  content: PublishContent,
): DraftAdapterArticle {
  return {
    title: content.title,
    html: content.bodyHtml,
    markdown: content.bodyMarkdown,
    coverPath: content.coverPath,
  };
}
