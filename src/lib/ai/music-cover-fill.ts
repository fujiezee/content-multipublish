/** Client-safe: do not import video-music from UI (that module pulls sqlite). */
export function musicNeedsCoverFill(music: {
  coverWanted?: boolean;
  status: string;
  tracks: Array<{ coverUrl?: string }>;
}): boolean {
  if (music.coverWanted === false) return false;
  if (music.status !== "ready") return false;
  return music.tracks.some((row) => !row.coverUrl);
}
