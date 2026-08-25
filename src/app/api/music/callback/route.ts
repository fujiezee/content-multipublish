import { NextResponse } from "next/server";
import {
  getVideoSeries,
  getVideoSeriesByMusicTask,
  updateVideoSeriesFields,
} from "@/lib/db";
import { fetchSunoTask } from "@/lib/ai/suno";
import {
  mergeMusicTracks,
  parseSeriesMusic,
  stringifySeriesMusic,
  syncSelectedTrackCover,
} from "@/lib/ai/video-music";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId") || "";
  try {
    await req.json().catch(() => ({}));
  } catch {
    // ignore
  }
  const series = jobId ? getVideoSeries(jobId) : undefined;
  const taskSeries = series || null;
  if (!taskSeries) return NextResponse.json({ ok: true });
  const music = parseSeriesMusic(taskSeries.music_json);
  if (!music.taskId) return NextResponse.json({ ok: true });
  try {
    const suno = await fetchSunoTask(music.taskId);
    const tracks = mergeMusicTracks(
      music.tracks,
      suno.tracks.map((track) => ({
        id: track.id,
        url: track.audioUrl,
        streamUrl: track.streamAudioUrl,
        title: track.title,
        duration: track.duration,
      })),
    );
    updateVideoSeriesFields(taskSeries.id, {
      music_json: stringifySeriesMusic(
        syncSelectedTrackCover({
          ...music,
          status: suno.status,
          error: suno.error || "",
          tracks,
          selectedTrackId:
            tracks.some((row) => row.id === music.selectedTrackId)
              ? music.selectedTrackId
              : tracks[0]?.id || "",
        }),
      ),
    });
  } catch {
    // poll will retry
  }
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const taskId = url.searchParams.get("taskId") || "";
  if (taskId) {
    const series = getVideoSeriesByMusicTask(taskId);
    if (series) {
      const music = parseSeriesMusic(series.music_json);
      try {
        const suno = await fetchSunoTask(music.taskId || taskId);
        const tracks = mergeMusicTracks(
          music.tracks,
          suno.tracks.map((track) => ({
            id: track.id,
            url: track.audioUrl,
            streamUrl: track.streamAudioUrl,
            title: track.title,
            duration: track.duration,
          })),
        );
        updateVideoSeriesFields(series.id, {
          music_json: stringifySeriesMusic(
            syncSelectedTrackCover({
              ...music,
              status: suno.status,
              error: suno.error || "",
              tracks,
              selectedTrackId:
                tracks.some((row) => row.id === music.selectedTrackId)
                  ? music.selectedTrackId
                  : tracks[0]?.id || "",
            }),
          ),
        });
      } catch {
        // ignore
      }
    }
  }
  return NextResponse.json({ ok: true });
}
