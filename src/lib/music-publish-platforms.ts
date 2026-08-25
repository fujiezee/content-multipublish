/** 发歌：抖音音乐开放平台一投，汽水与抖音曲库同源。 */
export const MUSIC_PUBLISH_PLATFORMS = [
  { id: "qishui" as const, name: "汽水" },
  { id: "douyin" as const, name: "抖音" },
];

export type MusicPublishPlatformId =
  (typeof MUSIC_PUBLISH_PLATFORMS)[number]["id"];

export function musicPublishPlatformName(
  id: string,
): string {
  return (
    MUSIC_PUBLISH_PLATFORMS.find((row) => row.id === id)?.name || id
  );
}
