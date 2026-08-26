/** 播客发布：小宇宙主播后台，填稿后等人点发布。 */
export const PODCAST_PUBLISH_PLATFORMS = [
  { id: "xiaoyuzhou" as const, name: "小宇宙" },
];

export type PodcastPublishPlatformId =
  (typeof PODCAST_PUBLISH_PLATFORMS)[number]["id"];

export function podcastPublishPlatformName(id: string): string {
  return (
    PODCAST_PUBLISH_PLATFORMS.find((row) => row.id === id)?.name || id
  );
}
