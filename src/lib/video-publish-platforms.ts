export const VIDEO_PUBLISH_PLATFORMS = [
  { id: "douyin" as const, name: "抖音" },
];

export type VideoPublishPlatformId = (typeof VIDEO_PUBLISH_PLATFORMS)[number]["id"];
