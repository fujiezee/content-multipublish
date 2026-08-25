import type { PlatformId } from "@/lib/types";

/** Platforms with a Node draft-API adapter (needs Playwright session cookie). */
export const API_DRAFT_PLATFORM_IDS: readonly PlatformId[] = [
  "segmentfault",
  "dianwu",
] as const;

const API_DRAFT_SET = new Set<PlatformId>(API_DRAFT_PLATFORM_IDS);

export function isApiDraftPlatform(id: PlatformId): boolean {
  return API_DRAFT_SET.has(id);
}
