import { createSegmentfaultDraftAdapter } from "@/lib/draft-adapters/segmentfault";
import type { DraftAdapter } from "@/lib/draft-adapters/types";
import type { PlatformId } from "@/lib/types";

export {
  API_DRAFT_PLATFORM_IDS,
  isApiDraftPlatform,
} from "@/lib/draft-adapters/platforms";
export { hasSessionFile } from "@/lib/draft-adapters/cookie-jar";
export type {
  DraftAdapter,
  DraftAdapterArticle,
  DraftAuthResult,
  DraftPublishResult,
} from "@/lib/draft-adapters/types";
export { contentToDraftArticle } from "@/lib/draft-adapters/types";

export function getDraftAdapter(platform: PlatformId): DraftAdapter | null {
  switch (platform) {
    case "segmentfault":
      return createSegmentfaultDraftAdapter();
    default:
      return null;
  }
}
