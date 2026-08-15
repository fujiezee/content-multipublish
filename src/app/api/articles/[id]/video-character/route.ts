import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api";
import {
  describeCharactersFromScript,
  generateCharacterAngles,
  parseAngles,
  parsePhotos,
  type ScriptCharacterBrief,
} from "@/lib/ai/character-sheet";
import {
  appendSeriesCast,
  createStudioCharacter,
  getArticleInWorkspace,
  getVideoCharacter,
  getVideoSeriesByArticle,
  listCharacterCatalog,
  listSeriesCharacters,
  listVideoEpisodes,
  parseCastIds,
  upsertVideoCharacter,
} from "@/lib/db";
import type { VideoCharacterPhoto } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

function publicCharacter(articleId: string) {
  const row = getVideoCharacter(articleId);
  if (!row) {
    return {
      id: "",
      name: "",
      photos: [] as VideoCharacterPhoto[],
      angles: [],
    };
  }
  return {
    id: row.id,
    name: row.name,
    photos: parsePhotos(row.photos_json),
    angles: parseAngles(row.angles_json),
    updated_at: row.updated_at,
  };
}

function characterOptions(workspaceId: string) {
  return listCharacterCatalog(workspaceId).map((c) => ({
    id: c.id,
    name: c.name || "未命名角色",
    thumb: c.angles[0]?.url || c.photos[0]?.url || "",
    voice_id: c.voice_id || "",
    angles: c.angles,
    photos: c.photos,
  }));
}

function payload(articleId: string, workspaceId: string) {
  const series = getVideoSeriesByArticle(articleId);
  const library = characterOptions(workspaceId);
  const castIds = series
    ? parseCastIds(series.cast_json, series.character_id)
    : [];
  return {
    ...publicCharacter(articleId),
    cast: castIds
      .map((id) => library.find((c) => c.id === id))
      .filter((c): c is (typeof library)[number] => Boolean(c)),
    characters: library,
  };
}

export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!getArticleInWorkspace(id, auth.ctx.workspaceId)) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  return NextResponse.json(payload(id, auth.ctx.workspaceId));
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!getArticleInWorkspace(id, auth.ctx.workspaceId)) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const photos = Array.isArray(body.photos)
    ? (body.photos as VideoCharacterPhoto[])
        .map((p) => ({ url: String(p?.url || "").trim() }))
        .filter((p) => p.url)
        .slice(0, 6)
    : undefined;
  upsertVideoCharacter({
    articleId: id,
    name: typeof body.name === "string" ? body.name : undefined,
    photos_json: photos ? JSON.stringify(photos) : undefined,
  });
  return NextResponse.json(payload(id, auth.ctx.workspaceId));
}

async function extractBriefs(articleId: string): Promise<ScriptCharacterBrief[]> {
  const series = getVideoSeriesByArticle(articleId);
  const episodes = series ? listVideoEpisodes(series.id) : [];
  const named = listSeriesCharacters(articleId)
    .map((row) => row.name.trim())
    .filter(Boolean)
    .join("、");
  return describeCharactersFromScript({
    seriesTitle: series?.title,
    genre: series?.genre,
    nameHint: named,
    episodes: episodes.map((ep) => ({
      title: ep.title,
      hook: ep.hook,
      voiceover: ep.voiceover,
      on_screen: ep.on_screen,
    })),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!getArticleInWorkspace(id, auth.ctx.workspaceId)) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const action =
    typeof body.action === "string" ? body.action : body.from === "script"
      ? "generate"
      : body.from === "photos"
        ? "generate"
        : "";

  try {
    if (action === "extract") {
      const briefs = await extractBriefs(id);
      return NextResponse.json({
        briefs,
        ...payload(id, auth.ctx.workspaceId),
      });
    }

    if (action !== "generate" && body.from !== "script" && body.from !== "photos") {
      return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
    }

    let name =
      typeof body.name === "string" ? body.name.trim().slice(0, 16) : "";
    let look = typeof body.look === "string" ? body.look.trim() : "";
    const photos = Array.isArray(body.photos)
      ? (body.photos as VideoCharacterPhoto[])
          .map((p) => ({ url: String(p?.url || "").trim() }))
          .filter((p) => p.url)
          .slice(0, 6)
      : [];

    if (body.from === "script" || (!name && !look && !photos.length)) {
      const briefs = await extractBriefs(id);
      const existingNames = new Set(
        listSeriesCharacters(id).map((row) => row.name.trim()),
      );
      const brief =
        briefs.find((item) => item.name && !existingNames.has(item.name)) ||
        briefs[0];
      if (!brief) {
        return NextResponse.json(
          { error: "没从剧本里看出角色" },
          { status: 400 },
        );
      }
      name = name || brief.name;
      look = look || brief.look;
    } else if (photos.length === 0 && !look) {
      return NextResponse.json(
        { error: "先写角色外形，或改用「按剧本识别角色」" },
        { status: 400 },
      );
    }

    const angles = await generateCharacterAngles({
      name,
      look,
      photos,
    });
    const saved = createStudioCharacter({
      workspaceId: auth.ctx.workspaceId,
      name,
      photos_json: JSON.stringify(photos),
      angles_json: JSON.stringify(angles),
      source: photos.length ? "photo" : "script",
      articleId: id,
    });
    const series = getVideoSeriesByArticle(id);
    if (series) {
      appendSeriesCast(series.id, saved.id);
    }
    return NextResponse.json({
      ...payload(id, auth.ctx.workspaceId),
      id: saved.id,
      name: saved.name,
      photos: parsePhotos(saved.photos_json),
      angles: parseAngles(saved.angles_json),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "生成角色失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
