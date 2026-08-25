import type Database from "better-sqlite3";
import { getCloudflareDb } from "@/lib/db/cloudflare-sql";
import { randomUUID } from "crypto";
import { randomToken, sha256 } from "@/lib/auth/password";
import { DB_PATH, ensureDataDirs } from "@/lib/paths";
import { MAX_SERIES_CAST } from "@/lib/ai/video-script-styles";
import { parseAngles, parsePhotos } from "@/lib/ai/character-look";
import { parsePodcastTurns } from "@/lib/ai/podcast-shared";
import { DEFAULT_TTS_SPEECH_MODEL, resolveTtsSpeechModel } from "@/lib/ai/tts-voice-ids";
import {
  ALL_PLATFORM_IDS,
  type Article,
  type ArticleInfographic,
  type ArticlePodcast,
  type ArticleVideoEpisode,
  type ArticleVideoCharacter,
  type ArticleVideoSeries,
  type VideoSpeakMode,
  normalizeSpeakMode,
  resolveInnerVoice,
  type CharacterCatalogItem,
  type CharacterSource,
  type StudioCharacter,
  type StudioVoice,
  type VideoCatalogItem,
  type MusicCatalogItem,
  type PodcastCatalogItem,
  type VideoCharacterAngle,
  type VideoCharacterPhoto,
  type VideoPublishJob,
  type MusicPublishJob,
  type ArticleVariant,
  type VideoEpisodeStatus,
  type VideoScriptGenre,
  type CorpusItem,
  type WriterAgent,
  type GeoKeyword,
  type GeoKeywordArticle,
  type GeoKeywordArticleWithTitle,
  type GeoKeywordMine,
  type JobStatus,
  type MentionResult,
  type MentionRun,
  type MentionSettings,
  type MentionSource,
  type PlatformFamily,
  type PlatformId,
  type PlatformSession,
  type PublishEngine,
  type PublishJob,
  type SessionStatus,
  type VariantSource,
  normalizePublishEngine,
} from "@/lib/types";
import { shouldReplaceJobStatus } from "@/lib/job-status";
import type { PaidOrder, PaidOrderItem, PaidOrderStatus } from "@/lib/paid-media";
import { getPaidMediaSku } from "@/lib/paid-media";
import type { PaidAdOrder, PaidAdOrderItem, PaidAdOrderStatus } from "@/lib/paid-ads";
import { getPaidAdSku } from "@/lib/paid-ads";
import {
  parseCorpusAssets,
  serializeCorpusAssets,
} from "@/lib/corpus-assets";
import {
  countAiModels,
  insertAiModelRow,
  migrateAiModelCatalog,
} from "@/lib/db/model-catalog";
import { DEFAULT_AI_MODEL_SEED } from "@/lib/ai/model-catalog/seed";
import {
  createCatalogModel,
  getCatalogModelById,
  listCatalogModels,
  removeCatalogModel,
  seedAiModelCatalog,
  syncProxyModelsIntoCatalog,
  syncQwenModelsIntoCatalog,
  syncArkModelsIntoCatalog,
  syncCloudflareModelsIntoCatalog,
  syncOfficialPricingIntoCatalog,
  updateCatalogModel,
} from "@/lib/ai/model-catalog/index";
import type { AiModelInput, ListAiModelsQuery } from "@/lib/ai/model-catalog/types";

let db: Database.Database | null = null;
let cloudMigrated = false;

function getDb() {
  if (process.env.CLOUDFLARE === "1") {
    const cloud = getCloudflareDb() as unknown as Database.Database;
    if (!cloudMigrated) {
      migrate(cloud);
      cloudMigrated = true;
    }
    return cloud;
  }
  if (db) return db;
  ensureDataDirs();
  // Native module is local-only; Cloudflare uses sql.js.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite = require("better-sqlite3") as typeof import("better-sqlite3");
  db = new BetterSqlite(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      cover_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platform_sessions (
      platform TEXT PRIMARY KEY,
      storage_path TEXT NOT NULL,
      display_name TEXT,
      connected_at TEXT,
      last_checked_at TEXT,
      status TEXT NOT NULL DEFAULT 'disconnected'
    );

    CREATE TABLE IF NOT EXISTS publish_jobs (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result_url TEXT,
      error TEXT,
      screenshot_path TEXT,
      engine TEXT NOT NULL DEFAULT 'playwright',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_article ON publish_jobs(article_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON publish_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_article_created ON publish_jobs(article_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS corpus_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      tags TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      assets_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_corpus_category ON corpus_items(category);
    CREATE INDEX IF NOT EXISTS idx_corpus_updated ON corpus_items(updated_at);

    CREATE TABLE IF NOT EXISTS geo_keyword_mines (
      id TEXT PRIMARY KEY,
      seed TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS geo_keywords (
      id TEXT PRIMARY KEY,
      mine_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      title TEXT NOT NULL,
      intent TEXT NOT NULL DEFAULT 'informational',
      angle TEXT NOT NULL DEFAULT '',
      norm_key TEXT NOT NULL,
      article_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (mine_id) REFERENCES geo_keyword_mines(id) ON DELETE CASCADE,
      UNIQUE(norm_key)
    );

    CREATE INDEX IF NOT EXISTS idx_geo_keywords_mine ON geo_keywords(mine_id);
    CREATE INDEX IF NOT EXISTS idx_geo_keywords_norm ON geo_keywords(norm_key);

    CREATE TABLE IF NOT EXISTS geo_keyword_articles (
      id TEXT PRIMARY KEY,
      keyword_id TEXT NOT NULL,
      article_id TEXT NOT NULL,
      brief TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (keyword_id) REFERENCES geo_keywords(id) ON DELETE CASCADE,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
      UNIQUE(keyword_id, article_id)
    );

    CREATE INDEX IF NOT EXISTS idx_geo_kw_articles_keyword ON geo_keyword_articles(keyword_id);

    CREATE TABLE IF NOT EXISTS article_variants (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      family TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'adapted',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
      UNIQUE(article_id, family)
    );

    CREATE INDEX IF NOT EXISTS idx_article_variants_article
      ON article_variants(article_id);
  `);

  migrateGeoKeywordArticleLinks(database);
  migratePublishJobEngine(database);
  migrateAuthAndWorkspace(database);
  migrateWorkspaceBilling(database);
  migrateArticleInfographics(database);
  migrateArticlePodcasts(database);
  migrateArticleScriptTitle(database);
  migrateArticleVideoScripts(database);
  migrateVideoEpisodeSubtitle(database);
  migrateVideoEpisodeCaptions(database);
  migrateVideoSeriesCharacter(database);
  migrateVideoSeriesSpeak(database);
  migrateVideoSeriesHookStyle(database);
  migrateVideoSeriesLookStyle(database);
  migrateVideoSeriesProps(database);
  migrateVideoSeriesWardrobe(database);
  migrateVideoEpisodeDirector(database);
  migrateVideoSeriesCast(database);
  migrateVideoSeriesPremise(database);
  migrateVideoSeriesDuration(database);
  migrateVideoSeriesMusic(database);
  migrateArticleVideoCharacters(database);
  migrateStudioCharacters(database);
  migrateStudioCharacterVoice(database);
  migrateStudioCharacterLook(database);
  migrateStudioVoices(database);
  migrateSeriesCharacterShare(database);
  migrateMentionTables(database);
  migratePaidPublish(database);
  migratePaidAds(database);
  migrateAgentDevices(database);
  migrateVideoPublishJobs(database);
  migrateMusicPublishJobs(database);
  migrateCorpusAssets(database);
  migrateWriterAgents(database);
  migrateAiModelCatalog(database);
  if (countAiModels(database) === 0) {
    for (const item of DEFAULT_AI_MODEL_SEED) {
      insertAiModelRow(database, item);
    }
  } else {
    // 已有库：只补缺失 slug，不覆盖 Admin 改过的项
    for (const item of DEFAULT_AI_MODEL_SEED) {
      const existing = database
        .prepare("SELECT id FROM ai_models WHERE slug = ?")
        .get(item.slug) as { id?: string } | undefined;
      if (existing?.id) continue;
      insertAiModelRow(database, item);
    }
  }
  for (const table of [
    "corpus_items",
    "geo_keyword_mines",
    "mention_runs",
    "mention_settings",
  ] as const) {
    ensureOwnedByWorkspace(database, table);
  }

  try {
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_articles_ws_updated
        ON articles(workspace_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_corpus_ws_updated
        ON corpus_items(workspace_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_geo_mines_ws_updated
        ON geo_keyword_mines(workspace_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mention_runs_ws_created
        ON mention_runs(workspace_id, created_at DESC);
    `);
  } catch (err) {
    console.warn("[db] migrate workspace indexes:", err);
  }

  for (const platform of ALL_PLATFORM_IDS) {
    database
      .prepare(
        `INSERT OR IGNORE INTO platform_sessions (platform, storage_path, status)
         VALUES (?, ?, 'disconnected')`,
      )
      .run(platform, `data/sessions/${platform}.json`);
  }
}

export function listArticles(workspaceId?: string | null): Article[] {
  if (workspaceId) {
    return getDb()
      .prepare(
        `SELECT * FROM articles
         WHERE workspace_id = ?
         ORDER BY updated_at DESC`,
      )
      .all(workspaceId) as Article[];
  }
  return getDb()
    .prepare("SELECT * FROM articles ORDER BY updated_at DESC")
    .all() as Article[];
}

/** 列表用：不含 body；支持 limit/offset 分页（多取 1 条判断 hasMore） */
export function listArticleSummaries(
  workspaceId?: string | null,
  limit?: number,
  offset = 0,
): Article[] {
  const capped =
    typeof limit === "number" && limit > 0
      ? Math.min(500, Math.floor(limit))
      : null;
  const off = Math.max(0, Math.floor(offset) || 0);
  const sql = workspaceId
    ? `SELECT id, title, summary, cover_path, script_title, workspace_id, created_at, updated_at
       FROM articles
       WHERE workspace_id = ?
       ORDER BY updated_at DESC${capped != null ? " LIMIT ? OFFSET ?" : ""}`
    : `SELECT id, title, summary, cover_path, script_title, workspace_id, created_at, updated_at
       FROM articles
       ORDER BY updated_at DESC${capped != null ? " LIMIT ? OFFSET ?" : ""}`;
  const rows = (
    workspaceId
      ? capped != null
        ? getDb().prepare(sql).all(workspaceId, capped, off)
        : getDb().prepare(sql).all(workspaceId)
      : capped != null
        ? getDb().prepare(sql).all(capped, off)
        : getDb().prepare(sql).all()
  ) as Array<Omit<Article, "body">>;
  return rows.map((row) => ({ ...row, body: "" }));
}

export function countArticles(workspaceId?: string | null): number {
  if (workspaceId) {
    const row = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM articles WHERE workspace_id = ?`)
      .get(workspaceId) as { c: number };
    return Number(row?.c) || 0;
  }
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM articles`)
    .get() as { c: number };
  return Number(row?.c) || 0;
}

export function getArticle(id: string): Article | undefined {
  return getDb().prepare("SELECT * FROM articles WHERE id = ?").get(id) as
    | Article
    | undefined;
}

export function getArticleInWorkspace(
  id: string,
  workspaceId: string,
): Article | undefined {
  const article = getArticle(id);
  if (!article) return undefined;
  const owner = article.workspace_id || "ws_local";
  return owner === workspaceId ? article : undefined;
}

export function createArticle(article: Article) {
  getDb()
    .prepare(
      `INSERT INTO articles (id, title, body, summary, cover_path, script_title, workspace_id, created_at, updated_at)
       VALUES (@id, @title, @body, @summary, @cover_path, @script_title, @workspace_id, @created_at, @updated_at)`,
    )
    .run({
      ...article,
      script_title: article.script_title?.trim() || "",
      workspace_id: article.workspace_id ?? null,
    });
}

export function updateArticle(
  id: string,
  patch: Partial<
    Pick<Article, "title" | "body" | "summary" | "cover_path" | "script_title">
  >,
) {
  const existing = getArticle(id);
  if (!existing) return null;
  const next: Article = {
    ...existing,
    updated_at: new Date().toISOString(),
  };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.body !== undefined) next.body = patch.body;
  if (patch.summary !== undefined) next.summary = patch.summary;
  if (patch.cover_path !== undefined) next.cover_path = patch.cover_path;
  if (patch.script_title !== undefined) {
    next.script_title = patch.script_title.trim().slice(0, 16);
  }
  getDb()
    .prepare(
      `UPDATE articles
       SET title = @title, body = @body, summary = @summary,
           cover_path = @cover_path, script_title = @script_title,
           updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      ...next,
      script_title: next.script_title?.trim() || "",
    });
  return next;
}

export function listVariants(articleId: string): ArticleVariant[] {
  return getDb()
    .prepare(
      `SELECT * FROM article_variants
       WHERE article_id = ?
       ORDER BY family ASC`,
    )
    .all(articleId) as ArticleVariant[];
}

export function getVariant(
  articleId: string,
  family: PlatformFamily,
): ArticleVariant | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM article_variants WHERE article_id = ? AND family = ?`,
    )
    .get(articleId, family) as ArticleVariant | undefined;
}

export function upsertVariant(input: {
  articleId: string;
  family: PlatformFamily;
  title: string;
  body: string;
  summary?: string;
  source: VariantSource;
}): ArticleVariant {
  const existing = getVariant(input.articleId, input.family);
  const now = new Date().toISOString();
  if (existing) {
    const next: ArticleVariant = {
      ...existing,
      title: input.title,
      body: input.body,
      summary: input.summary ?? "",
      source: input.source,
      updated_at: now,
    };
    getDb()
      .prepare(
        `UPDATE article_variants
         SET title = @title, body = @body, summary = @summary,
             source = @source, updated_at = @updated_at
         WHERE id = @id`,
      )
      .run(next);
    return next;
  }
  const created: ArticleVariant = {
    id: randomUUID(),
    article_id: input.articleId,
    family: input.family,
    title: input.title,
    body: input.body,
    summary: input.summary ?? "",
    source: input.source,
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO article_variants
       (id, article_id, family, title, body, summary, source, created_at, updated_at)
       VALUES (@id, @article_id, @family, @title, @body, @summary, @source, @created_at, @updated_at)`,
    )
    .run(created);
  return created;
}

export function deleteVariant(articleId: string, family: PlatformFamily) {
  getDb()
    .prepare(`DELETE FROM article_variants WHERE article_id = ? AND family = ?`)
    .run(articleId, family);
}

/** 主稿改过后清空平台变体，避免同步仍发出旧变体。 */
export function deleteArticleVariants(articleId: string) {
  getDb()
    .prepare(`DELETE FROM article_variants WHERE article_id = ?`)
    .run(articleId);
}

export function deleteArticle(id: string) {
  getDb().prepare("DELETE FROM articles WHERE id = ?").run(id);
}

export function listSessions(): PlatformSession[] {
  return getDb()
    .prepare("SELECT * FROM platform_sessions ORDER BY platform")
    .all() as PlatformSession[];
}

export function getSession(platform: PlatformId): PlatformSession | undefined {
  return getDb()
    .prepare("SELECT * FROM platform_sessions WHERE platform = ?")
    .get(platform) as PlatformSession | undefined;
}

export function upsertSession(
  platform: PlatformId,
  patch: Partial<
    Pick<
      PlatformSession,
      "storage_path" | "display_name" | "connected_at" | "last_checked_at" | "status"
    >
  >,
) {
  const existing = getSession(platform);
  const next: PlatformSession = {
    platform,
    storage_path: patch.storage_path ?? existing?.storage_path ?? `data/sessions/${platform}.json`,
    display_name: patch.display_name ?? existing?.display_name ?? null,
    connected_at: patch.connected_at ?? existing?.connected_at ?? null,
    last_checked_at: patch.last_checked_at ?? existing?.last_checked_at ?? null,
    status: (patch.status ?? existing?.status ?? "disconnected") as SessionStatus,
  };
  getDb()
    .prepare(
      `INSERT INTO platform_sessions (platform, storage_path, display_name, connected_at, last_checked_at, status)
       VALUES (@platform, @storage_path, @display_name, @connected_at, @last_checked_at, @status)
       ON CONFLICT(platform) DO UPDATE SET
         storage_path = excluded.storage_path,
         display_name = excluded.display_name,
         connected_at = excluded.connected_at,
         last_checked_at = excluded.last_checked_at,
         status = excluded.status`,
    )
    .run(next);
  return next;
}

export function createJobs(jobs: PublishJob[]) {
  const stmt = getDb().prepare(
    `INSERT INTO publish_jobs
     (id, article_id, platform, status, result_url, error, screenshot_path, engine, created_at, updated_at)
     VALUES (@id, @article_id, @platform, @status, @result_url, @error, @screenshot_path, @engine, @created_at, @updated_at)`,
  );
  const tx = getDb().transaction((rows: PublishJob[]) => {
    for (const row of rows) {
      stmt.run({
        ...row,
        engine: normalizePublishEngine(row.engine),
      });
    }
  });
  tx(jobs);
}

export function getJob(id: string): PublishJob | undefined {
  return normalizeJob(
    getDb().prepare("SELECT * FROM publish_jobs WHERE id = ?").get(id) as
      | PublishJob
      | undefined,
  );
}

export function listJobs(limit = 100): PublishJob[] {
  const rows = getDb()
    .prepare("SELECT * FROM publish_jobs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as PublishJob[];
  return rows.flatMap((row) => {
    const n = normalizeJob(row);
    return n ? [n] : [];
  });
}

export function listJobsInWorkspace(
  workspaceId: string,
  limit = 100,
  offset = 0,
): PublishJob[] {
  const rows = getDb()
    .prepare(
      `SELECT j.*
       FROM publish_jobs j
       INNER JOIN articles a ON a.id = j.article_id
       WHERE a.workspace_id = ?
       ORDER BY j.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(workspaceId, limit, Math.max(0, offset)) as PublishJob[];
  return rows.flatMap((row) => {
    const n = normalizeJob(row);
    return n ? [n] : [];
  });
}

export function countJobsByStatusInWorkspace(
  workspaceId: string,
): Record<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT j.status AS status, COUNT(*) AS c
       FROM publish_jobs j
       INNER JOIN articles a ON a.id = j.article_id
       WHERE a.workspace_id = ?
       GROUP BY j.status`,
    )
    .all(workspaceId) as Array<{ status: string; c: number }>;
  const out: Record<string, number> = {};
  for (const row of rows) out[row.status] = Number(row.c) || 0;
  return out;
}

export function getJobInWorkspace(
  id: string,
  workspaceId: string,
): PublishJob | undefined {
  const job = getJob(id);
  if (!job) return undefined;
  return getArticleInWorkspace(job.article_id, workspaceId) ? job : undefined;
}

export function listJobsByArticle(articleId: string): PublishJob[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM publish_jobs WHERE article_id = ? ORDER BY created_at DESC",
    )
    .all(articleId) as PublishJob[];
  return rows.flatMap((row) => {
    const n = normalizeJob(row);
    return n ? [n] : [];
  });
}

export function updateJob(
  id: string,
  patch: Partial<
    Pick<
      PublishJob,
      "status" | "result_url" | "error" | "screenshot_path" | "engine"
    >
  >,
) {
  const existing = getJob(id);
  if (!existing) return null;
  if (
    patch.status &&
    !shouldReplaceJobStatus(existing.status, patch.status as JobStatus)
  ) {
    return existing;
  }
  const next: PublishJob = {
    ...existing,
    ...patch,
    status: (patch.status ?? existing.status) as JobStatus,
    engine: normalizePublishEngine(patch.engine ?? existing.engine),
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE publish_jobs
       SET status = @status, result_url = @result_url, error = @error,
           screenshot_path = @screenshot_path, engine = @engine,
           updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(next);
  return next;
}

/** Playwright + Node API jobs — extension jobs are driven by the browser bridge. */
export function listPendingJobs(): PublishJob[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM publish_jobs
       WHERE (
           status = 'pending'
           AND (engine IS NULL OR engine = '' OR engine = 'playwright' OR engine = 'api')
         )
         OR (status = 'running' AND engine = 'api')
       ORDER BY created_at ASC`,
    )
    .all() as PublishJob[];
  return rows.flatMap((row) => {
    const n = normalizeJob(row);
    return n ? [n] : [];
  });
}

export function listCorpusItems(
  workspaceId?: string | null,
  limit?: number,
  offset = 0,
): CorpusItem[] {
  const capped =
    typeof limit === "number" && limit > 0
      ? Math.min(500, Math.floor(limit))
      : null;
  const off = Math.max(0, Math.floor(offset) || 0);
  if (workspaceId) {
    const sql =
      capped != null
        ? `SELECT * FROM corpus_items
           WHERE workspace_id = ?
           ORDER BY updated_at DESC
           LIMIT ? OFFSET ?`
        : `SELECT * FROM corpus_items
           WHERE workspace_id = ?
           ORDER BY updated_at DESC`;
    const rows = (
      capped != null
        ? getDb().prepare(sql).all(workspaceId, capped, off)
        : getDb().prepare(sql).all(workspaceId)
    ) as Array<CorpusItem & { assets_json?: string }>;
    return rows.map(normalizeCorpusItem);
  }
  const sql =
    capped != null
      ? `SELECT * FROM corpus_items ORDER BY updated_at DESC LIMIT ? OFFSET ?`
      : `SELECT * FROM corpus_items ORDER BY updated_at DESC`;
  const rows = (
    capped != null
      ? getDb().prepare(sql).all(capped, off)
      : getDb().prepare(sql).all()
  ) as Array<CorpusItem & { assets_json?: string }>;
  return rows.map(normalizeCorpusItem);
}

export function getCorpusItem(id: string): CorpusItem | undefined {
  const row = getDb()
    .prepare("SELECT * FROM corpus_items WHERE id = ?")
    .get(id) as (CorpusItem & { assets_json?: string }) | undefined;
  return row ? normalizeCorpusItem(row) : undefined;
}

export function createCorpusItem(item: CorpusItem, workspaceId = "ws_local") {
  getDb()
    .prepare(
      `INSERT INTO corpus_items
       (id, title, category, tags, content, assets_json, created_at, updated_at, workspace_id)
       VALUES (@id, @title, @category, @tags, @content, @assets_json, @created_at, @updated_at, @workspace_id)`,
    )
    .run({
      ...item,
      assets_json: serializeCorpusAssets(item.assets),
      workspace_id: workspaceId,
    });
}

export function updateCorpusItem(
  id: string,
  patch: Partial<
    Pick<CorpusItem, "title" | "category" | "tags" | "content" | "assets">
  >,
) {
  const existing = getCorpusItem(id);
  if (!existing) return null;
  const next: CorpusItem = {
    ...existing,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE corpus_items
       SET title = @title, category = @category, tags = @tags,
           content = @content, assets_json = @assets_json, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      ...next,
      assets_json: serializeCorpusAssets(next.assets),
    });
  return next;
}

export function deleteCorpusItem(id: string) {
  getDb().prepare("DELETE FROM corpus_items WHERE id = ?").run(id);
}

export function listWriterAgents(workspaceId: string): WriterAgent[] {
  return getDb()
    .prepare(
      `SELECT * FROM writer_agents
       WHERE workspace_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(workspaceId) as WriterAgent[];
}

export function getWriterAgent(id: string): WriterAgent | undefined {
  return getDb()
    .prepare("SELECT * FROM writer_agents WHERE id = ?")
    .get(id) as WriterAgent | undefined;
}

export function getWriterAgentInWorkspace(
  id: string,
  workspaceId: string,
): WriterAgent | undefined {
  const row = getWriterAgent(id);
  return row && row.workspace_id === workspaceId ? row : undefined;
}

export function findWriterAgentBySeed(
  workspaceId: string,
  seed: string,
): WriterAgent | undefined {
  const key = seed.replace(/\s+/g, " ").trim().toLowerCase();
  if (!key) return undefined;
  return listWriterAgents(workspaceId).find(
    (row) =>
      row.seed.replace(/\s+/g, " ").trim().toLowerCase() === key ||
      row.name.replace(/\s+/g, " ").trim().toLowerCase() === key,
  );
}

export function createWriterAgent(item: WriterAgent) {
  getDb()
    .prepare(
      `INSERT INTO writer_agents
       (id, workspace_id, name, seed, hint, instruction, created_at, updated_at)
       VALUES (@id, @workspace_id, @name, @seed, @hint, @instruction, @created_at, @updated_at)`,
    )
    .run(item);
}

export function updateWriterAgent(
  id: string,
  patch: Partial<Pick<WriterAgent, "name" | "seed" | "hint" | "instruction">>,
): WriterAgent | null {
  const existing = getWriterAgent(id);
  if (!existing) return null;
  const next: WriterAgent = {
    ...existing,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE writer_agents
       SET name = @name, seed = @seed, hint = @hint,
           instruction = @instruction, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(next);
  return next;
}

export function deleteWriterAgent(id: string) {
  getDb().prepare("DELETE FROM writer_agents WHERE id = ?").run(id);
}

export function listGeoMines(
  limit = 50,
  workspaceId?: string | null,
  offset = 0,
): GeoKeywordMine[] {
  const off = Math.max(0, Math.floor(offset) || 0);
  if (workspaceId) {
    return getDb()
      .prepare(
        `SELECT * FROM geo_keyword_mines
         WHERE workspace_id = ?
         ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      )
      .all(workspaceId, limit, off) as GeoKeywordMine[];
  }
  return getDb()
    .prepare(
      `SELECT * FROM geo_keyword_mines ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, off) as GeoKeywordMine[];
}

export function getGeoMine(id: string): GeoKeywordMine | undefined {
  return getDb()
    .prepare("SELECT * FROM geo_keyword_mines WHERE id = ?")
    .get(id) as GeoKeywordMine | undefined;
}

export function createGeoMine(mine: GeoKeywordMine, workspaceId = "ws_local") {
  getDb()
    .prepare(
      `INSERT INTO geo_keyword_mines
       (id, seed, context, created_at, updated_at, workspace_id)
       VALUES (@id, @seed, @context, @created_at, @updated_at, @workspace_id)`,
    )
    .run({ ...mine, workspace_id: workspaceId });
}

export function touchGeoMine(id: string) {
  getDb()
    .prepare(
      `UPDATE geo_keyword_mines SET updated_at = @updated_at WHERE id = @id`,
    )
    .run({ id, updated_at: new Date().toISOString() });
}

export function deleteGeoMine(id: string) {
  getDb().prepare("DELETE FROM geo_keyword_mines WHERE id = ?").run(id);
}

export function listGeoKeywordsByMine(mineId: string): GeoKeyword[] {
  return getDb()
    .prepare(
      `SELECT * FROM geo_keywords WHERE mine_id = ? ORDER BY created_at ASC`,
    )
    .all(mineId) as GeoKeyword[];
}

export function listAllGeoNormKeys(workspaceId?: string | null): string[] {
  if (workspaceId) {
    return (
      getDb()
        .prepare(
          `SELECT k.norm_key
           FROM geo_keywords k
           INNER JOIN geo_keyword_mines m ON m.id = k.mine_id
           WHERE m.workspace_id = ?`,
        )
        .all(workspaceId) as { norm_key: string }[]
    ).map((row) => row.norm_key);
  }
  return (
    getDb()
      .prepare("SELECT norm_key FROM geo_keywords")
      .all() as { norm_key: string }[]
  ).map((row) => row.norm_key);
}

export function countGeoKeywordsGrouped(
  mineIds: string[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (!mineIds.length) return out;
  const placeholders = mineIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT mine_id, COUNT(*) AS c
       FROM geo_keywords
       WHERE mine_id IN (${placeholders})
       GROUP BY mine_id`,
    )
    .all(...mineIds) as Array<{ mine_id: string; c: number }>;
  for (const row of rows) out.set(row.mine_id, Number(row.c) || 0);
  for (const id of mineIds) {
    if (!out.has(id)) out.set(id, 0);
  }
  return out;
}

export function insertGeoKeywords(keywords: GeoKeyword[]) {
  if (!keywords.length) return 0;
  const stmt = getDb().prepare(
    `INSERT OR IGNORE INTO geo_keywords
     (id, mine_id, keyword, title, intent, angle, norm_key, article_id, created_at)
     VALUES (@id, @mine_id, @keyword, @title, @intent, @angle, @norm_key, @article_id, @created_at)`,
  );
  let inserted = 0;
  const tx = getDb().transaction((rows: GeoKeyword[]) => {
    for (const row of rows) {
      const info = stmt.run(row);
      if (info.changes > 0) inserted += 1;
    }
  });
  tx(keywords);
  return inserted;
}

function migrateGeoKeywordArticleLinks(database: Database.Database) {
  try {
    const legacy = database
      .prepare(
        `SELECT gk.id, gk.article_id, gk.created_at
         FROM geo_keywords gk
         INNER JOIN articles a ON a.id = gk.article_id
         WHERE gk.article_id IS NOT NULL`,
      )
      .all() as { id: string; article_id: string; created_at: string }[];

    if (!legacy.length) return;

    const insert = database.prepare(
      `INSERT OR IGNORE INTO geo_keyword_articles (id, keyword_id, article_id, brief, created_at)
       VALUES (@id, @keyword_id, @article_id, '', @created_at)`,
    );
    const tx = database.transaction((rows: typeof legacy) => {
      for (const row of rows) {
        insert.run({
          id: randomUUID(),
          keyword_id: row.id,
          article_id: row.article_id,
          created_at: row.created_at,
        });
      }
    });
    tx(legacy);
  } catch (err) {
    console.warn("[db] migrate geo keyword article links:", err);
  }
}

function migratePublishJobEngine(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(publish_jobs)`)
      .all() as { name: string }[];
    if (!cols.some((c) => c.name === "engine")) {
      database.exec(
        `ALTER TABLE publish_jobs ADD COLUMN engine TEXT NOT NULL DEFAULT 'playwright'`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate publish_jobs.engine:", err);
  }
}

function migrateAuthAndWorkspace(database: Database.Database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_users (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES workspace_users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS extension_tokens (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL DEFAULT '扩展绑定',
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES workspace_users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token);
      CREATE INDEX IF NOT EXISTS idx_extension_tokens_token ON extension_tokens(token);
    `);

    const cols = database
      .prepare(`PRAGMA table_info(articles)`)
      .all() as { name: string }[];
    if (!cols.some((c) => c.name === "workspace_id")) {
      database.exec(`ALTER TABLE articles ADD COLUMN workspace_id TEXT`);
    }

    const existing = database
      .prepare(`SELECT id FROM workspaces WHERE id = ?`)
      .get("ws_local") as { id: string } | undefined;
    if (!existing) {
      database
        .prepare(
          `INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)`,
        )
        .run("ws_local", "本地工作区", new Date().toISOString());
    }

    database
      .prepare(
        `UPDATE articles
         SET workspace_id = 'ws_local'
         WHERE workspace_id IS NULL OR workspace_id = ''`,
      )
      .run();

    const userCols = database
      .prepare(`PRAGMA table_info(workspace_users)`)
      .all() as { name: string }[];
    if (!userCols.some((c) => c.name === "email_verified_at")) {
      database.exec(
        `ALTER TABLE workspace_users ADD COLUMN email_verified_at TEXT`,
      );
      database.exec(
        `UPDATE workspace_users
         SET email_verified_at = created_at
         WHERE email_verified_at IS NULL`,
      );
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS email_verify_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES workspace_users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_email_verify_tokens_user
        ON email_verify_tokens(user_id);
    `);
  } catch (err) {
    console.warn("[db] migrate auth/workspace:", err);
  }
}

function migrateWorkspaceBilling(database: Database.Database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS workspace_billing (
        workspace_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL DEFAULT 'trial',
        extra_articles INTEGER NOT NULL DEFAULT 0,
        extra_images INTEGER NOT NULL DEFAULT 0,
        extra_mentions INTEGER NOT NULL DEFAULT 0,
        extra_video_seconds INTEGER NOT NULL DEFAULT 0,
        wallet_fen INTEGER NOT NULL DEFAULT 0,
        used_articles INTEGER NOT NULL DEFAULT 0,
        used_images INTEGER NOT NULL DEFAULT 0,
        used_mentions INTEGER NOT NULL DEFAULT 0,
        used_video_seconds INTEGER NOT NULL DEFAULT 0,
        cap_articles INTEGER,
        cap_images INTEGER,
        cap_mentions INTEGER,
        cap_video_seconds INTEGER,
        period_start TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS billing_adjustments (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        actor_email TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_billing_adjustments_ws
        ON billing_adjustments(workspace_id, created_at);

      CREATE TABLE IF NOT EXISTS billing_orders (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        actor_email TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL,
        sku TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        interval TEXT NOT NULL DEFAULT 'once',
        amount_yuan INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        paid_at TEXT,
        stripe_session_id TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_billing_orders_ws
        ON billing_orders(workspace_id, created_at);

      CREATE TABLE IF NOT EXISTS billing_usage (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        actor_email TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        amount INTEGER NOT NULL DEFAULT 0,
        from_included INTEGER NOT NULL DEFAULT 0,
        from_wallet INTEGER NOT NULL DEFAULT 0,
        wallet_fen INTEGER NOT NULL DEFAULT 0,
        meter TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_billing_usage_ws
        ON billing_usage(workspace_id, created_at);
    `);
    try {
      database.exec(
        `ALTER TABLE billing_orders ADD COLUMN stripe_session_id TEXT`,
      );
    } catch {
      /* already exists */
    }
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_billing_orders_stripe
        ON billing_orders(stripe_session_id);
    `);
    try {
      database.exec(
        `ALTER TABLE workspace_billing ADD COLUMN wallet_fen INTEGER NOT NULL DEFAULT 0`,
      );
    } catch {
      /* already exists */
    }
  } catch (err) {
    console.warn("[db] migrate workspace billing:", err);
  }
}

function migrateMentionTables(database: Database.Database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS mention_settings (
        id TEXT PRIMARY KEY,
        brands TEXT NOT NULL DEFAULT '[]',
        questions TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mention_runs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        hit_count INTEGER NOT NULL DEFAULT 0,
        miss_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS mention_results (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        question TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'deepseek',
        mentioned INTEGER NOT NULL DEFAULT 0,
        excerpt TEXT NOT NULL DEFAULT '',
        answer TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (run_id) REFERENCES mention_runs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_mention_results_run ON mention_results(run_id);
      CREATE INDEX IF NOT EXISTS idx_mention_runs_created ON mention_runs(created_at);
    `);
    const cols = database
      .prepare(`PRAGMA table_info(mention_settings)`)
      .all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("doubao_api_key")) {
      database.exec(
        `ALTER TABLE mention_settings ADD COLUMN doubao_api_key TEXT NOT NULL DEFAULT ''`,
      );
    }
    if (!names.has("doubao_model")) {
      database.exec(
        `ALTER TABLE mention_settings ADD COLUMN doubao_model TEXT NOT NULL DEFAULT ''`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate mention tables:", err);
  }
}

function migratePaidPublish(database: Database.Database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS paid_orders (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        article_id TEXT NOT NULL,
        article_title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        total_yuan INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS paid_order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        sku_id TEXT NOT NULL,
        sku_name TEXT NOT NULL,
        price_yuan INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        result_url TEXT,
        FOREIGN KEY (order_id) REFERENCES paid_orders(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_paid_orders_ws
        ON paid_orders(workspace_id, created_at);
    `);
  } catch (err) {
    console.warn("[db] migrate paid publish:", err);
  }
}

function migratePaidAds(database: Database.Database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS ads_orders (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        article_id TEXT NOT NULL DEFAULT '',
        article_title TEXT NOT NULL DEFAULT '',
        landing_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        total_yuan INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ads_order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        sku_id TEXT NOT NULL,
        sku_name TEXT NOT NULL,
        price_yuan INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        FOREIGN KEY (order_id) REFERENCES ads_orders(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ads_orders_ws
        ON ads_orders(workspace_id, created_at);
    `);
  } catch (err) {
    console.warn("[db] migrate paid ads:", err);
  }
}

function migrateAgentDevices(database: Database.Database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS agent_pair_codes (
        code TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_devices (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL DEFAULT '本机助手',
        last_seen_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_agent_devices_ws
        ON agent_devices(workspace_id, last_seen_at);
      CREATE INDEX IF NOT EXISTS idx_agent_devices_token ON agent_devices(token);
    `);
    const cols = database
      .prepare(`PRAGMA table_info(publish_jobs)`)
      .all() as { name: string }[];
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("claimed_by")) {
      database.exec(`ALTER TABLE publish_jobs ADD COLUMN claimed_by TEXT`);
    }
    if (!names.has("claimed_at")) {
      database.exec(`ALTER TABLE publish_jobs ADD COLUMN claimed_at TEXT`);
    }
  } catch (err) {
    console.warn("[db] migrate agent devices:", err);
  }
}

function migrateWriterAgents(database: Database.Database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS writer_agents (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        seed TEXT NOT NULL DEFAULT '',
        hint TEXT NOT NULL DEFAULT '',
        instruction TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_writer_agents_ws
        ON writer_agents(workspace_id, updated_at);
    `);
  } catch (err) {
    console.warn("[db] migrate writer agents:", err);
  }
}

function migrateCorpusAssets(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(corpus_items)`)
      .all() as { name: string }[];
    if (!cols.some((c) => c.name === "assets_json")) {
      database.exec(
        `ALTER TABLE corpus_items ADD COLUMN assets_json TEXT NOT NULL DEFAULT '[]'`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate corpus assets:", err);
  }
}

function normalizeCorpusItem(
  row: CorpusItem & { assets_json?: string | null },
): CorpusItem {
  const { assets_json, ...rest } = row;
  return {
    ...rest,
    assets: parseCorpusAssets(assets_json ?? rest.assets),
  };
}

function migrateArticlePodcasts(database: Database.Database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS article_podcasts (
        id TEXT PRIMARY KEY,
        article_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL DEFAULT 'dialogue',
        host_voice TEXT NOT NULL DEFAULT '',
        guest_voice TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'idle',
        error TEXT,
        audio_url TEXT,
        cover_url TEXT,
        duration_sec INTEGER NOT NULL DEFAULT 0,
        turns_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_article_podcasts_article
        ON article_podcasts(article_id);
    `);
    const cols = database
      .prepare(`PRAGMA table_info(article_podcasts)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "cover_url")) {
      database.exec(`ALTER TABLE article_podcasts ADD COLUMN cover_url TEXT`);
    }
    if (!cols.some((c) => c.name === "tts_model")) {
      database.exec(
        `ALTER TABLE article_podcasts ADD COLUMN tts_model TEXT NOT NULL DEFAULT ''`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate article_podcasts:", err);
  }
}

function migrateArticleInfographics(database: Database.Database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS article_infographics (
        id TEXT PRIMARY KEY,
        article_id TEXT NOT NULL,
        family TEXT NOT NULL DEFAULT 'master',
        url TEXT NOT NULL,
        headline TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'points',
        card_json TEXT NOT NULL DEFAULT '{}',
        anchor_text TEXT NOT NULL DEFAULT '',
        insert_hint TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_article_infographics_article
        ON article_infographics(article_id, family, created_at);
    `);
  } catch (err) {
    console.warn("[db] migrate article_infographics:", err);
  }
}

function migrateArticleVideoScripts(database: Database.Database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS article_video_series (
        id TEXT PRIMARY KEY,
        article_id TEXT NOT NULL UNIQUE,
        genre TEXT NOT NULL DEFAULT 'edu',
        title TEXT NOT NULL DEFAULT '',
        logline TEXT NOT NULL DEFAULT '',
        audience TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        episode_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS article_video_episodes (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        episode_no INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        hook TEXT NOT NULL DEFAULT '',
        voiceover TEXT NOT NULL DEFAULT '',
        on_screen TEXT NOT NULL DEFAULT '',
        recap TEXT NOT NULL DEFAULT '',
        next_hook TEXT NOT NULL DEFAULT '',
        duration_sec INTEGER NOT NULL DEFAULT 90,
        shots_json TEXT NOT NULL DEFAULT '[]',
        confirmed INTEGER NOT NULL DEFAULT 0,
        video_status TEXT NOT NULL DEFAULT 'idle',
        video_url TEXT,
        video_error TEXT,
        video_model TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (series_id) REFERENCES article_video_series(id) ON DELETE CASCADE,
        UNIQUE(series_id, episode_no)
      );
      CREATE INDEX IF NOT EXISTS idx_article_video_episodes_series
        ON article_video_episodes(series_id, episode_no);
    `);
  } catch (err) {
    console.warn("[db] migrate article_video_scripts:", err);
  }
}

function migrateArticleScriptTitle(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(articles)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "script_title")) {
      database.exec(
        `ALTER TABLE articles ADD COLUMN script_title TEXT NOT NULL DEFAULT ''`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate article script_title:", err);
  }
}

function migrateVideoSeriesMusic(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(article_video_series)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "lyrics")) {
      database.exec(
        `ALTER TABLE article_video_series ADD COLUMN lyrics TEXT NOT NULL DEFAULT ''`,
      );
    }
    if (!cols.some((c) => c.name === "music_json")) {
      database.exec(
        `ALTER TABLE article_video_series ADD COLUMN music_json TEXT NOT NULL DEFAULT ''`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate video series music:", err);
  }
}

function migrateVideoSeriesDuration(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(article_video_series)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "duration_sec")) {
      database.exec(
        `ALTER TABLE article_video_series ADD COLUMN duration_sec INTEGER NOT NULL DEFAULT 0`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate video series duration:", err);
  }
}

function migrateVideoSeriesPremise(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(article_video_series)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "premise")) {
      database.exec(
        `ALTER TABLE article_video_series ADD COLUMN premise TEXT NOT NULL DEFAULT ''`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate video series premise:", err);
  }
}

function migrateVideoSeriesHookStyle(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(article_video_series)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "hook_style")) {
      database.exec(
        `ALTER TABLE article_video_series ADD COLUMN hook_style TEXT NOT NULL DEFAULT 'talk'`,
      );
    }
    database.exec(`
      UPDATE article_video_series
      SET hook_style = CASE
        WHEN hook_style IS NULL OR hook_style = '' THEN
          CASE WHEN genre = 'drama' THEN 'drama' ELSE 'talk' END
        ELSE hook_style
      END
    `);
  } catch (err) {
    console.warn("[db] migrate video series hook_style:", err);
  }
}

function migrateVideoSeriesLookStyle(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(article_video_series)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "look_style")) {
      database.exec(
        `ALTER TABLE article_video_series ADD COLUMN look_style TEXT NOT NULL DEFAULT 'semi'`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate video series look_style:", err);
  }
}

function migrateVideoSeriesWardrobe(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(article_video_series)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "wardrobe_json")) {
      database.exec(
        `ALTER TABLE article_video_series ADD COLUMN wardrobe_json TEXT NOT NULL DEFAULT ''`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate video series wardrobe_json:", err);
  }
}

function migrateVideoEpisodeDirector(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(article_video_episodes)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "director_json")) {
      database.exec(
        `ALTER TABLE article_video_episodes ADD COLUMN director_json TEXT NOT NULL DEFAULT ''`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate video episode director_json:", err);
  }
}

function migrateVideoSeriesProps(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(article_video_series)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "props_json")) {
      database.exec(
        `ALTER TABLE article_video_series ADD COLUMN props_json TEXT NOT NULL DEFAULT '[]'`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate video series props_json:", err);
  }
}

function migrateVideoSeriesSpeak(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(article_video_series)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "speak_mode")) {
      database.exec(
        `ALTER TABLE article_video_series ADD COLUMN speak_mode TEXT NOT NULL DEFAULT 'narration'`,
      );
    }
    if (!cols.some((c) => c.name === "voice_id")) {
      database.exec(
        `ALTER TABLE article_video_series ADD COLUMN voice_id TEXT NOT NULL DEFAULT ''`,
      );
    }
    if (!cols.some((c) => c.name === "inner_voice")) {
      database.exec(
        `ALTER TABLE article_video_series ADD COLUMN inner_voice TEXT NOT NULL DEFAULT 'off'`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate video series speak:", err);
  }
}

function migrateVideoSeriesCast(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(article_video_series)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "cast_json")) {
      database.exec(
        `ALTER TABLE article_video_series ADD COLUMN cast_json TEXT NOT NULL DEFAULT '[]'`,
      );
    }
    const rows = database
      .prepare(
        `SELECT id, character_id, cast_json FROM article_video_series`,
      )
      .all() as Array<{ id: string; character_id: string | null; cast_json: string }>;
    const update = database.prepare(
      `UPDATE article_video_series SET cast_json = ? WHERE id = ?`,
    );
    for (const row of rows) {
      const ids = parseCastIds(row.cast_json, row.character_id);
      if (ids.length && row.cast_json !== JSON.stringify(ids)) {
        update.run(JSON.stringify(ids), row.id);
      }
    }
  } catch (err) {
    console.warn("[db] migrate video series cast:", err);
  }
}

function migrateVideoEpisodeCaptions(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(article_video_episodes)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "source_video_url")) {
      database.exec(`ALTER TABLE article_video_episodes ADD COLUMN source_video_url TEXT`);
    }
    if (!cols.some((c) => c.name === "caption_style_json")) {
      database.exec(
        `ALTER TABLE article_video_episodes ADD COLUMN caption_style_json TEXT NOT NULL DEFAULT ''`,
      );
    }
    if (!cols.some((c) => c.name === "caption_cues_json")) {
      database.exec(
        `ALTER TABLE article_video_episodes ADD COLUMN caption_cues_json TEXT NOT NULL DEFAULT ''`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate video episode captions:", err);
  }
}

function migrateVideoEpisodeSubtitle(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(article_video_episodes)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "subtitle_url")) {
      database.exec(`ALTER TABLE article_video_episodes ADD COLUMN subtitle_url TEXT`);
    }
  } catch (err) {
    console.warn("[db] migrate video episode subtitle:", err);
  }
}

function migrateVideoPublishJobs(database: Database.Database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS video_publish_jobs (
        id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL,
        article_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        result_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES article_video_episodes(id) ON DELETE CASCADE,
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_video_publish_jobs_created
        ON video_publish_jobs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_video_publish_jobs_episode
        ON video_publish_jobs(episode_id);
    `);
  } catch (err) {
    console.warn("[db] migrate video publish jobs:", err);
  }
}

function migrateMusicPublishJobs(database: Database.Database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS music_publish_jobs (
        id TEXT PRIMARY KEY,
        article_id TEXT NOT NULL,
        series_id TEXT NOT NULL,
        track_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        result_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
        FOREIGN KEY (series_id) REFERENCES article_video_series(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_music_publish_jobs_created
        ON music_publish_jobs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_music_publish_jobs_article
        ON music_publish_jobs(article_id);
    `);
  } catch (err) {
    console.warn("[db] migrate music publish jobs:", err);
  }
}

function migrateVideoSeriesCharacter(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(article_video_series)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "character_id")) {
      database.exec(
        `ALTER TABLE article_video_series ADD COLUMN character_id TEXT`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate video series character:", err);
  }
}

function migrateArticleVideoCharacters(database: Database.Database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS article_video_characters (
        id TEXT PRIMARY KEY,
        article_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL DEFAULT '',
        photos_json TEXT NOT NULL DEFAULT '[]',
        angles_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
      );
    `);
  } catch (err) {
    console.warn("[db] migrate article_video_characters:", err);
  }
}

function migrateStudioCharacters(database: Database.Database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS studio_characters (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        photos_json TEXT NOT NULL DEFAULT '[]',
        angles_json TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'photo',
        article_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_studio_characters_ws
        ON studio_characters(workspace_id, updated_at);
    `);
    const existing = new Set(
      (
        database
          .prepare(
            `SELECT article_id FROM studio_characters WHERE article_id IS NOT NULL`,
          )
          .all() as Array<{ article_id: string }>
      ).map((row) => row.article_id),
    );
    const rows = database
      .prepare(
        `SELECT c.*, COALESCE(NULLIF(a.workspace_id, ''), 'ws_local') AS workspace_id
         FROM article_video_characters c
         LEFT JOIN articles a ON a.id = c.article_id`,
      )
      .all() as Array<ArticleVideoCharacter & { workspace_id: string }>;
    const insert = database.prepare(
      `INSERT INTO studio_characters
       (id, workspace_id, name, photos_json, angles_json, source, article_id, created_at, updated_at)
       VALUES (@id, @workspace_id, @name, @photos_json, @angles_json, @source, @article_id, @created_at, @updated_at)`,
    );
    for (const row of rows) {
      if (existing.has(row.article_id)) continue;
      insert.run({
        id: randomUUID(),
        workspace_id: row.workspace_id || "ws_local",
        name: row.name,
        photos_json: row.photos_json,
        angles_json: row.angles_json,
        source: row.photos_json && row.photos_json !== "[]" ? "photo" : "script",
        article_id: row.article_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    }
  } catch (err) {
    console.warn("[db] migrate studio_characters:", err);
  }
}

function migrateStudioCharacterVoice(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(studio_characters)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "voice_id")) {
      database.exec(
        `ALTER TABLE studio_characters ADD COLUMN voice_id TEXT NOT NULL DEFAULT ''`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate studio character voice:", err);
  }
}

function migrateStudioCharacterLook(database: Database.Database) {
  try {
    const cols = database
      .prepare(`PRAGMA table_info(studio_characters)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "look")) {
      database.exec(
        `ALTER TABLE studio_characters ADD COLUMN look TEXT NOT NULL DEFAULT ''`,
      );
    }
  } catch (err) {
    console.warn("[db] migrate studio character look:", err);
  }
}

function migrateStudioVoices(database: Database.Database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS studio_voices (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        hint TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT 'qwen',
        provider_voice_id TEXT NOT NULL DEFAULT '',
        provider_model TEXT NOT NULL DEFAULT '',
        sample_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_studio_voices_ws
        ON studio_voices(workspace_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_studio_voices_provider
        ON studio_voices(provider_voice_id);
    `);
  } catch (err) {
    console.warn("[db] migrate studio_voices:", err);
  }
}

function migrateSeriesCharacterShare(database: Database.Database) {
  try {
    database.exec(`
      UPDATE article_video_series
      SET character_id = (
        SELECT c.id FROM studio_characters c
        WHERE c.article_id = article_video_series.article_id
        ORDER BY c.updated_at DESC
        LIMIT 1
      )
      WHERE character_id IS NULL OR character_id = ''
    `);
  } catch (err) {
    console.warn("[db] migrate series character share:", err);
  }
}

const PLACEHOLDER_EMAIL = "local@dianwu.geo";

export function hasInteractiveUsers(): boolean {
  const row = getDb()
    .prepare(
      `SELECT count(*) AS n FROM workspace_users WHERE email != ?`,
    )
    .get(PLACEHOLDER_EMAIL) as { n: number };
  return row.n > 0;
}

function ensureOwnedByWorkspace(
  database: Database.Database,
  table: string,
) {
  const cols = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as { name: string }[];
  if (!cols.some((c) => c.name === "workspace_id")) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN workspace_id TEXT`);
  }
  database
    .prepare(
      `UPDATE ${table}
       SET workspace_id = 'ws_local'
       WHERE workspace_id IS NULL OR workspace_id = ''`,
    )
    .run();
}

export function ensureDefaultWorkspace(): { id: string; name: string } {
  const row = getDb()
    .prepare(`SELECT id, name FROM workspaces WHERE id = ?`)
    .get("ws_local") as { id: string; name: string } | undefined;
  if (row) return row;
  const created = {
    id: "ws_local",
    name: "本地工作区",
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (@id, @name, @created_at)`,
    )
    .run(created);
  return { id: created.id, name: created.name };
}

export function createWorkspace(name: string): { id: string; name: string } {
  const row = {
    id: randomUUID(),
    name: name.trim() || "工作区",
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO workspaces (id, name, created_at) VALUES (@id, @name, @created_at)`,
    )
    .run(row);
  return { id: row.id, name: row.name };
}

export type WorkspaceBillingRow = {
  workspace_id: string;
  plan_id: string;
  extra_articles: number;
  extra_images: number;
  extra_mentions: number;
  extra_video_seconds: number;
  wallet_fen: number;
  used_articles: number;
  used_images: number;
  used_mentions: number;
  used_video_seconds: number;
  cap_articles: number | null;
  cap_images: number | null;
  cap_mentions: number | null;
  cap_video_seconds: number | null;
  period_start: string;
  note: string;
  updated_at: string;
};

export type BillingQuotaField =
  | "articles"
  | "images"
  | "mentions"
  | "video_seconds";

export function currentBillingPeriodStart(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export function getWorkspace(id: string) {
  return getDb()
    .prepare(`SELECT id, name, created_at FROM workspaces WHERE id = ?`)
    .get(id) as { id: string; name: string; created_at: string } | undefined;
}

function defaultBillingRow(workspaceId: string): WorkspaceBillingRow {
  const now = new Date().toISOString();
  return {
    workspace_id: workspaceId,
    plan_id: "trial",
    extra_articles: 0,
    extra_images: 0,
    extra_mentions: 0,
    extra_video_seconds: 0,
    wallet_fen: 0,
    used_articles: 0,
    used_images: 0,
    used_mentions: 0,
    used_video_seconds: 0,
    cap_articles: null,
    cap_images: null,
    cap_mentions: null,
    cap_video_seconds: null,
    period_start: currentBillingPeriodStart(),
    note: "",
    updated_at: now,
  };
}

function readBillingRow(workspaceId: string): WorkspaceBillingRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM workspace_billing WHERE workspace_id = ?`)
    .get(workspaceId) as WorkspaceBillingRow | undefined;
}

export function getOrCreateWorkspaceBilling(
  workspaceId: string,
): WorkspaceBillingRow {
  const db = getDb();
  return db.transaction(() => {
    let row = readBillingRow(workspaceId);
    if (!row) {
      row = defaultBillingRow(workspaceId);
      db.prepare(
        `INSERT INTO workspace_billing (
           workspace_id, plan_id,
           extra_articles, extra_images, extra_mentions, extra_video_seconds, wallet_fen,
           used_articles, used_images, used_mentions, used_video_seconds,
           cap_articles, cap_images, cap_mentions, cap_video_seconds,
           period_start, note, updated_at
         ) VALUES (
           @workspace_id, @plan_id,
           @extra_articles, @extra_images, @extra_mentions, @extra_video_seconds, @wallet_fen,
           @used_articles, @used_images, @used_mentions, @used_video_seconds,
           @cap_articles, @cap_images, @cap_mentions, @cap_video_seconds,
           @period_start, @note, @updated_at
         )`,
      ).run(row);
    }
    const period = currentBillingPeriodStart();
    if (row.period_start !== period) {
      db.prepare(
        `UPDATE workspace_billing
         SET used_articles = 0,
             used_images = 0,
             used_mentions = 0,
             used_video_seconds = 0,
             period_start = @period_start,
             updated_at = @updated_at
         WHERE workspace_id = @workspace_id`,
      ).run({
        workspace_id: workspaceId,
        period_start: period,
        updated_at: new Date().toISOString(),
      });
      row = readBillingRow(workspaceId) ?? { ...row, period_start: period };
    }
    return row;
  })();
}

export function updateWorkspaceBilling(
  workspaceId: string,
  patch: Partial<
    Omit<WorkspaceBillingRow, "workspace_id">
  >,
): WorkspaceBillingRow {
  const current = getOrCreateWorkspaceBilling(workspaceId);
  const next: WorkspaceBillingRow = {
    ...current,
    ...patch,
    workspace_id: workspaceId,
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE workspace_billing
       SET plan_id = @plan_id,
           extra_articles = @extra_articles,
           extra_images = @extra_images,
           extra_mentions = @extra_mentions,
           extra_video_seconds = @extra_video_seconds,
           wallet_fen = @wallet_fen,
           used_articles = @used_articles,
           used_images = @used_images,
           used_mentions = @used_mentions,
           used_video_seconds = @used_video_seconds,
           cap_articles = @cap_articles,
           cap_images = @cap_images,
           cap_mentions = @cap_mentions,
           cap_video_seconds = @cap_video_seconds,
           period_start = @period_start,
           note = @note,
           updated_at = @updated_at
       WHERE workspace_id = @workspace_id`,
    )
    .run(next);
  return next;
}

function usedColumn(field: BillingQuotaField): string {
  return `used_${field}`;
}

export type BillingUsageActor = {
  email?: string;
  meter?: string | null;
};

export type BillingUsageRow = {
  id: string;
  workspace_id: string;
  actor_email: string;
  kind: string;
  label: string;
  amount: number;
  from_included: number;
  from_wallet: number;
  wallet_fen: number;
  meter: string;
  created_at: string;
};

const USAGE_KIND: Record<BillingQuotaField, { kind: string; label: string }> = {
  articles: { kind: "articles", label: "文章" },
  images: { kind: "images", label: "配图" },
  mentions: { kind: "mentions", label: "查排名" },
  video_seconds: { kind: "videoSeconds", label: "视频" },
};

function writeBillingUsage(
  database: Database.Database,
  input: {
    workspaceId: string;
    field: BillingQuotaField;
    amount: number;
    fromIncluded: number;
    fromWallet: number;
    walletFen: number;
    actor?: BillingUsageActor;
  },
) {
  if (
    input.amount === 0 &&
    input.fromIncluded === 0 &&
    input.fromWallet === 0 &&
    input.walletFen === 0
  ) {
    return;
  }
  const meta = USAGE_KIND[input.field];
  database
    .prepare(
      `INSERT INTO billing_usage (
         id, workspace_id, actor_email, kind, label,
         amount, from_included, from_wallet, wallet_fen, meter, created_at
       ) VALUES (
         @id, @workspace_id, @actor_email, @kind, @label,
         @amount, @from_included, @from_wallet, @wallet_fen, @meter, @created_at
       )`,
    )
    .run({
      id: randomUUID(),
      workspace_id: input.workspaceId,
      actor_email: (input.actor?.email || "").trim(),
      kind: meta.kind,
      label: meta.label,
      amount: input.amount,
      from_included: input.fromIncluded,
      from_wallet: input.fromWallet,
      wallet_fen: input.walletFen,
      meter: (input.actor?.meter || "").trim(),
      created_at: new Date().toISOString(),
    });
}

export function listBillingUsage(
  workspaceId: string,
  opts?: { limit?: number; walletOnly?: boolean },
): BillingUsageRow[] {
  const limit = Math.min(200, Math.max(1, Math.floor(opts?.limit ?? 40)));
  if (opts?.walletOnly) {
    return getDb()
      .prepare(
        `SELECT * FROM billing_usage
         WHERE workspace_id = ? AND wallet_fen != 0
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(workspaceId, limit) as BillingUsageRow[];
  }
  return getDb()
    .prepare(
      `SELECT * FROM billing_usage
       WHERE workspace_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(workspaceId, limit) as BillingUsageRow[];
}

export function consumeWorkspaceQuota(
  workspaceId: string,
  field: BillingQuotaField,
  amount: number,
  cap: number | "unlimited",
  actor?: BillingUsageActor,
): boolean {
  if (amount <= 0) return true;
  const db = getDb();
  return db.transaction(() => {
    const row = getOrCreateWorkspaceBilling(workspaceId);
    const used = Number(row[usedColumn(field) as keyof WorkspaceBillingRow] ?? 0);
    if (cap !== "unlimited" && used + amount > cap) return false;
    db.prepare(
      `UPDATE workspace_billing
       SET ${usedColumn(field)} = ${usedColumn(field)} + @amount,
           updated_at = @updated_at
       WHERE workspace_id = @workspace_id`,
    ).run({
      workspace_id: workspaceId,
      amount,
      updated_at: new Date().toISOString(),
    });
    writeBillingUsage(db, {
      workspaceId,
      field,
      amount,
      fromIncluded: amount,
      fromWallet: 0,
      walletFen: 0,
      actor,
    });
    return true;
  })();
}

export function refundWorkspaceQuota(
  workspaceId: string,
  field: BillingQuotaField,
  amount: number,
  actor?: BillingUsageActor,
) {
  if (amount <= 0) return;
  const db = getDb();
  db.transaction(() => {
    getOrCreateWorkspaceBilling(workspaceId);
    db.prepare(
      `UPDATE workspace_billing
       SET ${usedColumn(field)} = MAX(0, ${usedColumn(field)} - @amount),
           updated_at = @updated_at
       WHERE workspace_id = @workspace_id`,
    ).run({
      workspace_id: workspaceId,
      amount,
      updated_at: new Date().toISOString(),
    });
    writeBillingUsage(db, {
      workspaceId,
      field,
      amount: -amount,
      fromIncluded: -amount,
      fromWallet: 0,
      walletFen: 0,
      actor,
    });
  })();
}

export function addWalletFen(workspaceId: string, fen: number): number {
  const amount = Math.round(fen);
  const db = getDb();
  return db.transaction(() => {
    const row = getOrCreateWorkspaceBilling(workspaceId);
    const next = Math.max(0, Number(row.wallet_fen ?? 0) + amount);
    db.prepare(
      `UPDATE workspace_billing
       SET wallet_fen = @wallet_fen, updated_at = @updated_at
       WHERE workspace_id = @workspace_id`,
    ).run({
      workspace_id: workspaceId,
      wallet_fen: next,
      updated_at: new Date().toISOString(),
    });
    return next;
  })();
}

/**
 * 钱包直扣（API 文本 / 音乐等）。成功返回剩余余额；余额不足返回 null。
 * fen > 0 扣款；fen < 0 退款。
 */
export function debitWalletFen(
  workspaceId: string,
  fen: number,
  meta: {
    kind: string;
    label: string;
    meter?: string | null;
    email?: string;
  },
): number | null {
  const cost = Math.round(fen);
  if (cost === 0) return getOrCreateWorkspaceBilling(workspaceId).wallet_fen;
  const db = getDb();
  return db.transaction(() => {
    const row = getOrCreateWorkspaceBilling(workspaceId);
    const wallet = Number(row.wallet_fen ?? 0);
    if (cost > 0 && wallet < cost) return null;
    const next = Math.max(0, wallet - cost);
    db.prepare(
      `UPDATE workspace_billing
       SET wallet_fen = @wallet_fen, updated_at = @updated_at
       WHERE workspace_id = @workspace_id`,
    ).run({
      workspace_id: workspaceId,
      wallet_fen: next,
      updated_at: new Date().toISOString(),
    });
    db.prepare(
      `INSERT INTO billing_usage (
         id, workspace_id, actor_email, kind, label,
         amount, from_included, from_wallet, wallet_fen, meter, created_at
       ) VALUES (
         @id, @workspace_id, @actor_email, @kind, @label,
         @amount, @from_included, @from_wallet, @wallet_fen, @meter, @created_at
       )`,
    ).run({
      id: randomUUID(),
      workspace_id: workspaceId,
      actor_email: (meta.email || "").trim(),
      kind: meta.kind,
      label: meta.label,
      amount: cost > 0 ? 1 : -1,
      from_included: 0,
      from_wallet: cost > 0 ? 1 : -1,
      wallet_fen: cost,
      meter: (meta.meter || "").trim(),
      created_at: new Date().toISOString(),
    });
    return next;
  })();
}

export function consumeMeteredUsage(
  workspaceId: string,
  field: BillingQuotaField,
  amount: number,
  cap: number | "unlimited",
  unitFen: number,
  actor?: BillingUsageActor,
): boolean {
  if (amount <= 0) return true;
  const db = getDb();
  return db.transaction(() => {
    const row = getOrCreateWorkspaceBilling(workspaceId);
    const used = Number(row[usedColumn(field) as keyof WorkspaceBillingRow] ?? 0);
    const wallet = Number(row.wallet_fen ?? 0);
    if (cap === "unlimited") {
      db.prepare(
        `UPDATE workspace_billing
         SET ${usedColumn(field)} = ${usedColumn(field)} + @amount,
             updated_at = @updated_at
         WHERE workspace_id = @workspace_id`,
      ).run({
        workspace_id: workspaceId,
        amount,
        updated_at: new Date().toISOString(),
      });
      writeBillingUsage(db, {
        workspaceId,
        field,
        amount,
        fromIncluded: amount,
        fromWallet: 0,
        walletFen: 0,
        actor,
      });
      return true;
    }
    const includedLeft = Math.max(0, cap - used);
    const fromIncluded = Math.min(amount, includedLeft);
    const fromWallet = Math.max(0, amount - fromIncluded);
    const cost = fromWallet * unitFen;
    if (wallet < cost) return false;
    db.prepare(
      `UPDATE workspace_billing
       SET ${usedColumn(field)} = ${usedColumn(field)} + @amount,
           wallet_fen = @wallet_fen,
           updated_at = @updated_at
       WHERE workspace_id = @workspace_id`,
    ).run({
      workspace_id: workspaceId,
      amount,
      wallet_fen: wallet - cost,
      updated_at: new Date().toISOString(),
    });
    writeBillingUsage(db, {
      workspaceId,
      field,
      amount,
      fromIncluded,
      fromWallet,
      walletFen: cost,
      actor,
    });
    return true;
  })();
}

export function refundMeteredUsage(
  workspaceId: string,
  field: BillingQuotaField,
  amount: number,
  cap: number | "unlimited",
  unitFen: number,
  actor?: BillingUsageActor,
) {
  if (amount <= 0) return;
  const db = getDb();
  const col = usedColumn(field);
  db.transaction(() => {
    const row = getOrCreateWorkspaceBilling(workspaceId);
    const used = Number(row[col as keyof WorkspaceBillingRow] ?? 0);
    const wallet = Number(row.wallet_fen ?? 0);
    const overage = cap === "unlimited" ? 0 : Math.max(0, used - cap);
    const fromWallet = Math.min(amount, overage);
    const fromIncluded = Math.max(0, amount - fromWallet);
    const refundFen = fromWallet * unitFen;
    db.prepare(
      `UPDATE workspace_billing
       SET ${col} = MAX(0, ${col} - @amount),
           wallet_fen = @wallet_fen,
           updated_at = @updated_at
       WHERE workspace_id = @workspace_id`,
    ).run({
      workspace_id: workspaceId,
      amount,
      wallet_fen: wallet + refundFen,
      updated_at: new Date().toISOString(),
    });
    writeBillingUsage(db, {
      workspaceId,
      field,
      amount: -amount,
      fromIncluded: -fromIncluded,
      fromWallet: -fromWallet,
      walletFen: -refundFen,
      actor,
    });
  })();
}

export function insertBillingAdjustment(input: {
  workspaceId: string;
  actorEmail: string;
  kind: string;
  detail: string;
}) {
  getDb()
    .prepare(
      `INSERT INTO billing_adjustments
       (id, workspace_id, actor_email, kind, detail, created_at)
       VALUES (@id, @workspace_id, @actor_email, @kind, @detail, @created_at)`,
    )
    .run({
      id: randomUUID(),
      workspace_id: input.workspaceId,
      actor_email: input.actorEmail,
      kind: input.kind,
      detail: input.detail,
      created_at: new Date().toISOString(),
    });
}

export type BillingOrderRow = {
  id: string;
  workspace_id: string;
  actor_email: string;
  kind: string;
  sku: string;
  label: string;
  interval: string;
  amount_yuan: number;
  status: string;
  created_at: string;
  paid_at: string | null;
  stripe_session_id: string | null;
};

export function insertBillingOrder(input: {
  id?: string;
  workspaceId: string;
  actorEmail: string;
  kind: string;
  sku: string;
  label: string;
  interval: string;
  amountYuan: number;
  status: string;
  paidAt?: string | null;
  stripeSessionId?: string | null;
}): BillingOrderRow {
  const now = new Date().toISOString();
  const row: BillingOrderRow = {
    id: input.id || randomUUID(),
    workspace_id: input.workspaceId,
    actor_email: input.actorEmail,
    kind: input.kind,
    sku: input.sku,
    label: input.label,
    interval: input.interval,
    amount_yuan: input.amountYuan,
    status: input.status,
    created_at: now,
    paid_at: input.paidAt ?? (input.status === "paid" ? now : null),
    stripe_session_id: input.stripeSessionId ?? null,
  };
  getDb()
    .prepare(
      `INSERT INTO billing_orders
       (id, workspace_id, actor_email, kind, sku, label, interval, amount_yuan, status, created_at, paid_at, stripe_session_id)
       VALUES (@id, @workspace_id, @actor_email, @kind, @sku, @label, @interval, @amount_yuan, @status, @created_at, @paid_at, @stripe_session_id)`,
    )
    .run(row);
  return row;
}

export function getBillingOrderById(id: string): BillingOrderRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM billing_orders WHERE id = ? LIMIT 1`)
    .get(id) as BillingOrderRow | undefined;
}

export function getBillingOrderByStripeSession(
  sessionId: string,
): BillingOrderRow | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM billing_orders WHERE stripe_session_id = ? LIMIT 1`,
    )
    .get(sessionId) as BillingOrderRow | undefined;
}

export function setBillingOrderStripeSession(id: string, sessionId: string) {
  getDb()
    .prepare(
      `UPDATE billing_orders SET stripe_session_id = @session_id WHERE id = @id`,
    )
    .run({ id, session_id: sessionId });
}

export function setBillingOrderStatus(
  id: string,
  status: string,
  paidAt?: string | null,
) {
  getDb()
    .prepare(
      `UPDATE billing_orders
       SET status = @status, paid_at = @paid_at
       WHERE id = @id`,
    )
    .run({
      id,
      status,
      paid_at:
        paidAt === undefined
          ? status === "paid"
            ? new Date().toISOString()
            : null
          : paidAt,
    });
}

export function listBillingOrders(workspaceId: string, limit = 20): BillingOrderRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM billing_orders
       WHERE workspace_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(workspaceId, limit) as BillingOrderRow[];
}

/** 累计已支付「充值」金额（元）。用于 API 模型加价档。 */
export function sumPaidWalletYuan(workspaceId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(amount_yuan), 0) AS total
       FROM billing_orders
       WHERE workspace_id = ?
         AND status = 'paid'
         AND kind = 'wallet'`,
    )
    .get(workspaceId) as { total?: number } | undefined;
  return Math.max(0, Number(row?.total ?? 0));
}

export function listWorkspacesAdmin(): Array<{
  id: string;
  name: string;
  created_at: string;
  emails: string;
  names: string;
}> {
  return getDb()
    .prepare(
      `SELECT w.id, w.name, w.created_at,
              COALESCE(GROUP_CONCAT(u.email, char(10)), '') AS emails,
              COALESCE(GROUP_CONCAT(u.display_name, char(10)), '') AS names
       FROM workspaces w
       LEFT JOIN workspace_users u ON u.workspace_id = w.id
       GROUP BY w.id
       ORDER BY w.created_at DESC`,
    )
    .all() as Array<{
    id: string;
    name: string;
    created_at: string;
    emails: string;
    names: string;
  }>;
}

export function createWorkspaceUser(input: {
  workspaceId: string;
  email: string;
  passwordHash: string;
  displayName?: string;
}) {
  const row = {
    id: randomUUID(),
    workspace_id: input.workspaceId,
    email: input.email.trim().toLowerCase(),
    password_hash: input.passwordHash,
    display_name: input.displayName?.trim() || input.email.split("@")[0] || "用户",
    created_at: new Date().toISOString(),
    email_verified_at: null as string | null,
  };
  getDb()
    .prepare(
      `INSERT INTO workspace_users
       (id, workspace_id, email, password_hash, display_name, created_at, email_verified_at)
       VALUES (@id, @workspace_id, @email, @password_hash, @display_name, @created_at, @email_verified_at)`,
    )
    .run(row);
  return row;
}

export function getWorkspaceUserByEmail(email: string) {
  return getDb()
    .prepare(`SELECT * FROM workspace_users WHERE email = ?`)
    .get(email.trim().toLowerCase()) as
    | {
        id: string;
        workspace_id: string;
        email: string;
        password_hash: string;
        display_name: string;
        created_at: string;
        email_verified_at?: string | null;
      }
    | undefined;
}

export function getWorkspaceUser(id: string) {
  return getDb()
    .prepare(`SELECT * FROM workspace_users WHERE id = ?`)
    .get(id) as
    | {
        id: string;
        workspace_id: string;
        email: string;
        password_hash: string;
        display_name: string;
        created_at: string;
        email_verified_at?: string | null;
      }
    | undefined;
}

export function isWorkspaceUserEmailVerified(user: {
  email_verified_at?: string | null;
}): boolean {
  return Boolean(user.email_verified_at);
}

export function markWorkspaceUserEmailVerified(userId: string): void {
  getDb()
    .prepare(
      `UPDATE workspace_users
       SET email_verified_at = ?
       WHERE id = ? AND (email_verified_at IS NULL OR email_verified_at = '')`,
    )
    .run(new Date().toISOString(), userId);
}

export function createEmailVerifyToken(userId: string): string {
  const token = randomToken(32);
  const now = new Date();
  getDb()
    .prepare(`DELETE FROM email_verify_tokens WHERE user_id = ?`)
    .run(userId);
  getDb()
    .prepare(
      `INSERT INTO email_verify_tokens
       (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      userId,
      sha256(token),
      new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      now.toISOString(),
    );
  return token;
}

export function latestEmailVerifyCreatedAt(userId: string): string | undefined {
  const row = getDb()
    .prepare(
      `SELECT created_at FROM email_verify_tokens
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(userId) as { created_at?: string } | undefined;
  return row?.created_at;
}

export function consumeEmailVerifyToken(token: string) {
  const hash = sha256(token.trim());
  const row = getDb()
    .prepare(
      `SELECT user_id, expires_at FROM email_verify_tokens WHERE token_hash = ?`,
    )
    .get(hash) as { user_id: string; expires_at: string } | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    getDb()
      .prepare(`DELETE FROM email_verify_tokens WHERE token_hash = ?`)
      .run(hash);
    return null;
  }
  getDb()
    .prepare(`DELETE FROM email_verify_tokens WHERE user_id = ?`)
    .run(row.user_id);
  markWorkspaceUserEmailVerified(row.user_id);
  return getWorkspaceUser(row.user_id) || null;
}

export function createAuthSession(input: {
  userId: string;
  workspaceId: string;
  expiresAt: string;
}) {
  const row = {
    id: randomUUID(),
    user_id: input.userId,
    workspace_id: input.workspaceId,
    token: randomToken(32),
    created_at: new Date().toISOString(),
    expires_at: input.expiresAt,
  };
  getDb()
    .prepare(
      `INSERT INTO auth_sessions
       (id, user_id, workspace_id, token, created_at, expires_at)
       VALUES (@id, @user_id, @workspace_id, @token, @created_at, @expires_at)`,
    )
    .run(row);
  return row;
}

export function getAuthSessionByToken(token: string) {
  return getDb()
    .prepare(`SELECT * FROM auth_sessions WHERE token = ?`)
    .get(token) as
    | {
        id: string;
        user_id: string;
        workspace_id: string;
        token: string;
        created_at: string;
        expires_at: string;
      }
    | undefined;
}

export function deleteAuthSessionByToken(token: string) {
  getDb().prepare(`DELETE FROM auth_sessions WHERE token = ?`).run(token);
}

export function extendAuthSession(token: string, expiresAt: string) {
  getDb()
    .prepare(`UPDATE auth_sessions SET expires_at = ? WHERE token = ?`)
    .run(expiresAt, token);
}

export function createExtensionTokenRow(input: {
  workspaceId: string;
  userId: string;
  label?: string;
  /** api = 模型 API 密钥（dwapi_）；默认扩展绑定（dwext_） */
  kind?: "extension" | "api";
}) {
  const kind = input.kind === "api" ? "api" : "extension";
  const prefix = kind === "api" ? "dwapi_" : "dwext_";
  const row = {
    id: randomUUID(),
    workspace_id: input.workspaceId,
    user_id: input.userId,
    token: `${prefix}${randomToken(24)}`,
    label:
      input.label?.trim() ||
      (kind === "api" ? "API 调用" : "扩展绑定"),
    created_at: new Date().toISOString(),
    last_used_at: null as string | null,
  };
  getDb()
    .prepare(
      `INSERT INTO extension_tokens
       (id, workspace_id, user_id, token, label, created_at, last_used_at)
       VALUES (@id, @workspace_id, @user_id, @token, @label, @created_at, @last_used_at)`,
    )
    .run(row);
  return row;
}

export function getExtensionToken(token: string) {
  return getDb()
    .prepare(`SELECT * FROM extension_tokens WHERE token = ?`)
    .get(token) as
    | {
        id: string;
        workspace_id: string;
        user_id: string;
        token: string;
        label: string;
        created_at: string;
        last_used_at: string | null;
      }
    | undefined;
}

export function listExtensionTokens(workspaceId: string) {
  return getDb()
    .prepare(
      `SELECT id, workspace_id, user_id, token, label, created_at, last_used_at
       FROM extension_tokens WHERE workspace_id = ? ORDER BY created_at DESC`,
    )
    .all(workspaceId) as Array<{
    id: string;
    workspace_id: string;
    user_id: string;
    token: string;
    label: string;
    created_at: string;
    last_used_at: string | null;
  }>;
}

export function touchExtensionToken(id: string) {
  getDb()
    .prepare(
      `UPDATE extension_tokens SET last_used_at = ? WHERE id = ?`,
    )
    .run(new Date().toISOString(), id);
}

export function revokeExtensionToken(id: string, workspaceId: string) {
  getDb()
    .prepare(`DELETE FROM extension_tokens WHERE id = ? AND workspace_id = ?`)
    .run(id, workspaceId);
}

export type AgentDeviceRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  token: string;
  label: string;
  last_seen_at: string | null;
  created_at: string;
};

export function createAgentPairCode(input: {
  workspaceId: string;
  userId: string;
  expiresAt: string;
}): { code: string; expires_at: string } {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let compact = "";
  for (let i = 0; i < 8; i++) {
    compact += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  getDb()
    .prepare(
      `INSERT INTO agent_pair_codes (code, workspace_id, user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      compact,
      input.workspaceId,
      input.userId,
      input.expiresAt,
      new Date().toISOString(),
    );
  return { code: compact, expires_at: input.expiresAt };
}

export function redeemAgentPairCode(rawCode: string): AgentDeviceRow | null {
  const code = rawCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!code) return null;
  const now = new Date().toISOString();
  const pair = getDb()
    .prepare(
      `SELECT * FROM agent_pair_codes WHERE code = ?`,
    )
    .get(code) as
    | {
        code: string;
        workspace_id: string;
        user_id: string;
        expires_at: string;
      }
    | undefined;
  if (!pair) return null;
  if (pair.expires_at < now) {
    getDb().prepare(`DELETE FROM agent_pair_codes WHERE code = ?`).run(code);
    return null;
  }
  const row: AgentDeviceRow = {
    id: randomUUID(),
    workspace_id: pair.workspace_id,
    user_id: pair.user_id,
    token: `dwagent_${randomToken(24)}`,
    label: "本机助手",
    last_seen_at: now,
    created_at: now,
  };
  const tx = getDb().transaction(() => {
    getDb().prepare(`DELETE FROM agent_pair_codes WHERE code = ?`).run(code);
    getDb()
      .prepare(
        `INSERT INTO agent_devices
         (id, workspace_id, user_id, token, label, last_seen_at, created_at)
         VALUES (@id, @workspace_id, @user_id, @token, @label, @last_seen_at, @created_at)`,
      )
      .run(row);
  });
  tx();
  return row;
}

export function getAgentDeviceByToken(token: string): AgentDeviceRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM agent_devices WHERE token = ?`)
    .get(token) as AgentDeviceRow | undefined;
}

export function listAgentDevices(workspaceId: string): AgentDeviceRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM agent_devices WHERE workspace_id = ? ORDER BY created_at DESC`,
    )
    .all(workspaceId) as AgentDeviceRow[];
}

export function touchAgentDevice(id: string) {
  getDb()
    .prepare(`UPDATE agent_devices SET last_seen_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id);
}

export function revokeAgentDevice(id: string, workspaceId: string) {
  getDb()
    .prepare(`DELETE FROM agent_devices WHERE id = ? AND workspace_id = ?`)
    .run(id, workspaceId);
}

export function workspaceHasOnlineAgent(
  workspaceId: string,
  withinMs: number,
): boolean {
  const since = new Date(Date.now() - withinMs).toISOString();
  const row = getDb()
    .prepare(
      `SELECT id FROM agent_devices
       WHERE workspace_id = ? AND last_seen_at IS NOT NULL AND last_seen_at >= ?
       LIMIT 1`,
    )
    .get(workspaceId, since) as { id: string } | undefined;
  return Boolean(row);
}

export function claimNextPlaywrightJob(
  workspaceId: string,
  agentId: string,
): PublishJob | undefined {
  const now = new Date().toISOString();
  const tx = getDb().transaction(() => {
    const row = getDb()
      .prepare(
        `SELECT j.* FROM publish_jobs j
         INNER JOIN articles a ON a.id = j.article_id
         WHERE j.status = 'pending'
           AND j.engine = 'playwright'
           AND (a.workspace_id = ? OR ((a.workspace_id IS NULL OR a.workspace_id = '') AND ? = 'ws_local'))
         ORDER BY j.created_at ASC
         LIMIT 1`,
      )
      .get(workspaceId, workspaceId) as PublishJob | undefined;
    if (!row) return undefined;
    const info = getDb()
      .prepare(
        `UPDATE publish_jobs
         SET status = 'running', claimed_by = ?, claimed_at = ?, updated_at = ?, error = NULL
         WHERE id = ? AND status = 'pending'`,
      )
      .run(agentId, now, now, row.id);
    if (!info.changes) return undefined;
    return getJob(row.id);
  });
  return tx();
}

export function clearJobClaim(jobId: string) {
  getDb()
    .prepare(
      `UPDATE publish_jobs SET claimed_by = NULL, claimed_at = NULL WHERE id = ?`,
    )
    .run(jobId);
}

export function tryClaimPendingJob(
  jobId: string,
  claimedBy: string,
): PublishJob | undefined {
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `UPDATE publish_jobs
       SET status = 'running', claimed_by = ?, claimed_at = ?, updated_at = ?, error = NULL
       WHERE id = ? AND status = 'pending'`,
    )
    .run(claimedBy, now, now, jobId);
  if (!info.changes) return undefined;
  return getJob(jobId);
}

function normalizeJob(row: PublishJob | undefined): PublishJob | undefined {
  if (!row) return undefined;
  return {
    ...row,
    engine: normalizePublishEngine(row.engine),
  };
}

export function linkGeoKeywordArticle(
  keywordId: string,
  articleId: string,
  brief = "",
): GeoKeywordArticle | undefined {
  const keyword = getGeoKeyword(keywordId);
  if (!keyword) return undefined;

  const row: GeoKeywordArticle = {
    id: randomUUID(),
    keyword_id: keywordId,
    article_id: articleId,
    brief: brief.trim(),
    created_at: new Date().toISOString(),
  };
  const info = getDb()
    .prepare(
      `INSERT OR IGNORE INTO geo_keyword_articles
       (id, keyword_id, article_id, brief, created_at)
       VALUES (@id, @keyword_id, @article_id, @brief, @created_at)`,
    )
    .run(row);
  if (info.changes === 0) {
    return getDb()
      .prepare(
        `SELECT * FROM geo_keyword_articles WHERE keyword_id = ? AND article_id = ?`,
      )
      .get(keywordId, articleId) as GeoKeywordArticle | undefined;
  }
  return row;
}

export function listGeoKeywordArticlesByKeyword(
  keywordId: string,
): GeoKeywordArticleWithTitle[] {
  return getDb()
    .prepare(
      `SELECT gka.*, a.title AS article_title
       FROM geo_keyword_articles gka
       JOIN articles a ON a.id = gka.article_id
       WHERE gka.keyword_id = ?
       ORDER BY gka.created_at DESC`,
    )
    .all(keywordId) as GeoKeywordArticleWithTitle[];
}

export function listGeoKeywordArticlesByMine(
  mineId: string,
): GeoKeywordArticleWithTitle[] {
  return getDb()
    .prepare(
      `SELECT gka.*, a.title AS article_title
       FROM geo_keyword_articles gka
       JOIN geo_keywords gk ON gk.id = gka.keyword_id
       JOIN articles a ON a.id = gka.article_id
       WHERE gk.mine_id = ?
       ORDER BY gka.created_at DESC`,
    )
    .all(mineId) as GeoKeywordArticleWithTitle[];
}

export function getGeoKeyword(id: string): GeoKeyword | undefined {
  return getDb()
    .prepare("SELECT * FROM geo_keywords WHERE id = ?")
    .get(id) as GeoKeyword | undefined;
}

export function countGeoKeywordsByMine(mineId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as c FROM geo_keywords WHERE mine_id = ?")
    .get(mineId) as { c: number };
  return row.c;
}

export function listArticleInfographics(
  articleId: string,
  family: string,
): ArticleInfographic[] {
  return getDb()
    .prepare(
      `SELECT * FROM article_infographics
       WHERE article_id = ? AND family = ?
       ORDER BY created_at ASC`,
    )
    .all(articleId, family) as ArticleInfographic[];
}

export function insertArticleInfographic(
  row: ArticleInfographic,
): ArticleInfographic {
  getDb()
    .prepare(
      `INSERT INTO article_infographics
       (id, article_id, family, url, headline, kind, card_json, anchor_text, insert_hint, created_at)
       VALUES (@id, @article_id, @family, @url, @headline, @kind, @card_json, @anchor_text, @insert_hint, @created_at)`,
    )
    .run(row);
  return row;
}

export function listArticlePainKeywords(articleId: string): Array<{
  keyword: string;
  angle: string;
  intent: string;
}> {
  try {
    return getDb()
      .prepare(
        `SELECT gk.keyword AS keyword, gk.angle AS angle, gk.intent AS intent
         FROM geo_keyword_articles gka
         JOIN geo_keywords gk ON gk.id = gka.keyword_id
         WHERE gka.article_id = ?
         ORDER BY gka.created_at DESC
         LIMIT 8`,
      )
      .all(articleId) as Array<{ keyword: string; angle: string; intent: string }>;
  } catch {
    return [];
  }
}

export function getArticlePodcastByArticle(
  articleId: string,
): ArticlePodcast | undefined {
  try {
    return getDb()
      .prepare("SELECT * FROM article_podcasts WHERE article_id = ?")
      .get(articleId) as ArticlePodcast | undefined;
  } catch {
    return undefined;
  }
}

export function saveArticlePodcast(row: ArticlePodcast): ArticlePodcast {
  const now = new Date().toISOString();
  const existing = getArticlePodcastByArticle(row.article_id);
  const next: ArticlePodcast = {
    ...row,
    cover_url: row.cover_url ?? existing?.cover_url ?? null,
    tts_model: resolveTtsSpeechModel(
      row.tts_model || existing?.tts_model || DEFAULT_TTS_SPEECH_MODEL,
    ),
    created_at: existing?.created_at || row.created_at || now,
    updated_at: now,
    id: existing?.id || row.id,
  };
  if (existing) {
    getDb()
      .prepare(
        `UPDATE article_podcasts
         SET title = @title, mode = @mode, host_voice = @host_voice,
             guest_voice = @guest_voice, tts_model = @tts_model,
             status = @status, error = @error,
             audio_url = @audio_url, cover_url = @cover_url,
             duration_sec = @duration_sec,
             turns_json = @turns_json, updated_at = @updated_at
         WHERE article_id = @article_id`,
      )
      .run(next);
  } else {
    getDb()
      .prepare(
        `INSERT INTO article_podcasts
         (id, article_id, title, mode, host_voice, guest_voice, tts_model, status, error,
          audio_url, cover_url, duration_sec, turns_json, created_at, updated_at)
         VALUES (@id, @article_id, @title, @mode, @host_voice, @guest_voice, @tts_model,
          @status, @error, @audio_url, @cover_url, @duration_sec, @turns_json,
          @created_at, @updated_at)`,
      )
      .run(next);
  }
  return getArticlePodcastByArticle(row.article_id) || next;
}

export function parseCastIds(
  raw?: string | null,
  fallback?: string | null,
): string[] {
  const ids: string[] = [];
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === "string" && item.trim()) ids.push(item.trim());
        if (
          item &&
          typeof item === "object" &&
          typeof (item as { character_id?: string }).character_id === "string"
        ) {
          ids.push((item as { character_id: string }).character_id.trim());
        }
      }
    }
  } catch {
    // ignore
  }
  if (ids.length === 0 && fallback?.trim()) ids.push(fallback.trim());
  return [...new Set(ids.filter(Boolean))];
}

function hydrateVideoSeries(
  row: ArticleVideoSeries | undefined,
): ArticleVideoSeries | undefined {
  if (!row) return undefined;
  const castIds = parseCastIds(row.cast_json, row.character_id);
  const cast_json = JSON.stringify(castIds);
  return {
    ...row,
    character_id: row.character_id || castIds[0] || null,
    cast_json,
    speak_mode: normalizeSpeakMode(row.speak_mode),
    inner_voice: resolveInnerVoice(row.inner_voice),
    premise: typeof row.premise === "string" ? row.premise : "",
    duration_sec: Number(row.duration_sec) === 15 ? 15 : Number(row.duration_sec) === 90 ? 90 : 0,
    voice_id: typeof row.voice_id === "string" ? row.voice_id : "",
    hook_style:
      typeof row.hook_style === "string" && row.hook_style.trim()
        ? row.hook_style.trim()
        : row.genre === "drama"
          ? "drama"
          : "talk",
    look_style:
      typeof row.look_style === "string" && row.look_style.trim()
        ? row.look_style.trim()
        : "semi",
    props_json:
      typeof row.props_json === "string" && row.props_json.trim()
        ? row.props_json
        : "[]",
    wardrobe_json:
      typeof row.wardrobe_json === "string" ? row.wardrobe_json : "",
    lyrics: typeof row.lyrics === "string" ? row.lyrics : "",
    music_json: typeof row.music_json === "string" ? row.music_json : "",
  };
}

export function getVideoSeriesByArticle(
  articleId: string,
): ArticleVideoSeries | undefined {
  return hydrateVideoSeries(
    getDb()
      .prepare(`SELECT * FROM article_video_series WHERE article_id = ?`)
      .get(articleId) as ArticleVideoSeries | undefined,
  );
}

export function ensureVideoSeries(
  articleId: string,
  title?: string,
): ArticleVideoSeries {
  const existing = getVideoSeriesByArticle(articleId);
  if (existing) return existing;
  const article = getArticle(articleId);
  const now = new Date().toISOString();
  const series: ArticleVideoSeries = {
    id: randomUUID(),
    article_id: articleId,
    genre: "edu",
    title: (title || article?.script_title || article?.title || "")
      .trim()
      .slice(0, 16),
    logline: "",
    premise: "",
    audience: "",
    notes: "",
    episode_count: 0,
    duration_sec: 90,
    character_id: null,
    cast_json: "[]",
    speak_mode: "narration",
    inner_voice: "off",
    voice_id: "",
    hook_style: "talk",
    look_style: "semi",
    props_json: "[]",
    wardrobe_json: "",
    lyrics: "",
    music_json: "",
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO article_video_series
       (id, article_id, genre, title, logline, premise, audience, notes, episode_count, duration_sec, character_id, cast_json, speak_mode, inner_voice, voice_id, hook_style, look_style, props_json, lyrics, music_json, created_at, updated_at)
       VALUES (@id, @article_id, @genre, @title, @logline, @premise, @audience, @notes, @episode_count, @duration_sec, @character_id, @cast_json, @speak_mode, @inner_voice, @voice_id, @hook_style, @look_style, @props_json, @lyrics, @music_json, @created_at, @updated_at)`,
    )
    .run(series);
  return hydrateVideoSeries(series)!;
}

export function getVideoSeriesByMusicTask(
  taskId: string,
): ArticleVideoSeries | undefined {
  const id = taskId.trim();
  if (!id) return undefined;
  const safe = id.replace(/[%_]/g, "");
  const rows = getDb()
    .prepare(`SELECT * FROM article_video_series WHERE music_json LIKE ?`)
    .all(`%${safe}%`) as ArticleVideoSeries[];
  const hit = rows.find((row) => {
    try {
      const parsed = JSON.parse(row.music_json || "{}") as { taskId?: string };
      return parsed.taskId === id;
    } catch {
      return false;
    }
  });
  return hydrateVideoSeries(hit);
}

export function getVideoSeries(
  seriesId: string,
): ArticleVideoSeries | undefined {
  return hydrateVideoSeries(
    getDb()
      .prepare(`SELECT * FROM article_video_series WHERE id = ?`)
      .get(seriesId) as ArticleVideoSeries | undefined,
  );
}

export function listVideoEpisodes(seriesId: string): ArticleVideoEpisode[] {
  return getDb()
    .prepare(
      `SELECT * FROM article_video_episodes
       WHERE series_id = ?
       ORDER BY episode_no ASC`,
    )
    .all(seriesId) as ArticleVideoEpisode[];
}

export function getVideoEpisode(
  episodeId: string,
): ArticleVideoEpisode | undefined {
  return getDb()
    .prepare(`SELECT * FROM article_video_episodes WHERE id = ?`)
    .get(episodeId) as ArticleVideoEpisode | undefined;
}

export function replaceVideoSeries(input: {
  articleId: string;
  genre: VideoScriptGenre;
  title: string;
  logline: string;
  premise?: string;
  audience: string;
  notes: string;
  character_id?: string | null;
  cast_json?: string;
  speak_mode?: VideoSpeakMode;
  inner_voice?: ArticleVideoSeries["inner_voice"];
  voice_id?: string;
  hook_style?: string;
  look_style?: string;
  duration_sec?: number;
  episodes: Array<{
    episode_no: number;
    title: string;
    hook: string;
    voiceover: string;
    on_screen: string;
    recap: string;
    next_hook: string;
    duration_sec: number;
    shots_json: string;
    director_json?: string;
  }>;
}): { series: ArticleVideoSeries; episodes: ArticleVideoEpisode[] } {
  const now = new Date().toISOString();
  const database = getDb();
  const prev = getVideoSeriesByArticle(input.articleId);
  const replace = database.transaction(() => {
    database
      .prepare(`DELETE FROM article_video_series WHERE article_id = ?`)
      .run(input.articleId);
    const series: ArticleVideoSeries = {
      id: randomUUID(),
      article_id: input.articleId,
      genre: input.genre,
      title: input.title,
      logline: input.logline,
      premise: input.premise?.trim() || "",
      audience: input.audience,
      notes: input.notes,
      episode_count: input.episodes.length,
      duration_sec: Number(input.duration_sec) === 15 ? 15 : 90,
      character_id: input.character_id?.trim() || parseCastIds(input.cast_json)[0] || null,
      cast_json: JSON.stringify(
        parseCastIds(input.cast_json, input.character_id),
      ),
      speak_mode: input.speak_mode === "dialogue" ? "dialogue" : "narration",
      inner_voice: resolveInnerVoice(input.inner_voice),
      voice_id: input.voice_id?.trim() || "",
      hook_style: input.hook_style?.trim() || "talk",
      look_style: input.look_style?.trim() || "semi",
      props_json: "[]",
      wardrobe_json: "",
      lyrics: prev?.lyrics || "",
      music_json: prev?.music_json || "",
      created_at: now,
      updated_at: now,
    };
    database
      .prepare(
        `INSERT INTO article_video_series
         (id, article_id, genre, title, logline, premise, audience, notes, episode_count, duration_sec, character_id, cast_json, speak_mode, inner_voice, voice_id, hook_style, look_style, props_json, lyrics, music_json, created_at, updated_at)
         VALUES (@id, @article_id, @genre, @title, @logline, @premise, @audience, @notes, @episode_count, @duration_sec, @character_id, @cast_json, @speak_mode, @inner_voice, @voice_id, @hook_style, @look_style, @props_json, @lyrics, @music_json, @created_at, @updated_at)`,
      )
      .run(series);
    const episodes = input.episodes.map((ep) => {
      const row: ArticleVideoEpisode = {
        id: randomUUID(),
        series_id: series.id,
        episode_no: ep.episode_no,
        title: ep.title,
        hook: ep.hook,
        voiceover: ep.voiceover,
        on_screen: ep.on_screen,
        recap: ep.recap,
        next_hook: ep.next_hook,
        duration_sec: ep.duration_sec,
        shots_json: ep.shots_json,
        director_json: ep.director_json || "",
        confirmed: 0,
        video_status: "idle",
        video_url: null,
        subtitle_url: null,
        video_error: null,
        video_model: null,
        created_at: now,
        updated_at: now,
      };
      database
        .prepare(
          `INSERT INTO article_video_episodes
           (id, series_id, episode_no, title, hook, voiceover, on_screen, recap, next_hook,
            duration_sec, shots_json, director_json, confirmed, video_status, video_url, video_error, video_model,
            created_at, updated_at)
           VALUES (@id, @series_id, @episode_no, @title, @hook, @voiceover, @on_screen, @recap, @next_hook,
            @duration_sec, @shots_json, @director_json, @confirmed, @video_status, @video_url, @video_error, @video_model,
            @created_at, @updated_at)`,
        )
        .run(row);
      return row;
    });
    return { series, episodes };
  });
  return replace();
}

export function updateVideoSeriesFields(
  seriesId: string,
  patch: Partial<
    Pick<
      ArticleVideoSeries,
      | "title"
      | "logline"
      | "premise"
      | "audience"
      | "notes"
      | "character_id"
      | "cast_json"
      | "speak_mode"
      | "inner_voice"
      | "voice_id"
      | "look_style"
      | "props_json"
      | "wardrobe_json"
      | "episode_count"
      | "duration_sec"
      | "lyrics"
      | "music_json"
    >
  >,
): ArticleVideoSeries | undefined {
  const current = getDb()
    .prepare(`SELECT * FROM article_video_series WHERE id = ?`)
    .get(seriesId) as ArticleVideoSeries | undefined;
  if (!current) return undefined;
  const castIds =
    patch.cast_json !== undefined
      ? parseCastIds(patch.cast_json, patch.character_id)
      : parseCastIds(
          current.cast_json,
          patch.character_id !== undefined
            ? patch.character_id
            : current.character_id,
        );
  const next: ArticleVideoSeries = {
    ...current,
    title: patch.title ?? current.title,
    logline: patch.logline ?? current.logline,
    premise: patch.premise ?? current.premise,
    audience: patch.audience ?? current.audience,
    notes: patch.notes ?? current.notes,
    character_id:
      patch.character_id !== undefined
        ? patch.character_id?.trim() || castIds[0] || null
        : castIds[0] || current.character_id || null,
    cast_json: JSON.stringify(castIds),
    speak_mode:
      patch.speak_mode === "dialogue" || patch.speak_mode === "narration"
        ? patch.speak_mode
        : current.speak_mode === "dialogue"
          ? "dialogue"
          : "narration",
    inner_voice:
      patch.inner_voice !== undefined
        ? resolveInnerVoice(patch.inner_voice)
        : resolveInnerVoice(current.inner_voice),
    voice_id:
      patch.voice_id !== undefined
        ? patch.voice_id.trim()
        : current.voice_id || "",
    look_style:
      patch.look_style !== undefined
        ? patch.look_style.trim() || "semi"
        : current.look_style || "semi",
    props_json:
      patch.props_json !== undefined
        ? patch.props_json.trim() || "[]"
        : current.props_json || "[]",
    wardrobe_json:
      patch.wardrobe_json !== undefined
        ? patch.wardrobe_json.trim()
        : current.wardrobe_json || "",
    episode_count:
      patch.episode_count !== undefined
        ? Math.max(1, Math.round(Number(patch.episode_count) || 1))
        : current.episode_count || 0,
    duration_sec:
      patch.duration_sec !== undefined
        ? Number(patch.duration_sec) === 15
          ? 15
          : 90
        : Number(current.duration_sec) === 15
          ? 15
          : Number(current.duration_sec) === 90
            ? 90
            : 0,
    lyrics: patch.lyrics !== undefined ? patch.lyrics : current.lyrics || "",
    music_json:
      patch.music_json !== undefined
        ? patch.music_json
        : current.music_json || "",
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE article_video_series
       SET title = @title, logline = @logline, premise = @premise, audience = @audience, notes = @notes,
           character_id = @character_id, cast_json = @cast_json, speak_mode = @speak_mode,
           inner_voice = @inner_voice, voice_id = @voice_id, look_style = @look_style, props_json = @props_json, wardrobe_json = @wardrobe_json, episode_count = @episode_count, duration_sec = @duration_sec, lyrics = @lyrics, music_json = @music_json, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(next);
  return next;
}

export function setSeriesCast(
  seriesId: string,
  characterIds: string[],
): ArticleVideoSeries | undefined {
  const unique = [...new Set(characterIds.map((id) => id.trim()).filter(Boolean))].slice(
    0,
    MAX_SERIES_CAST,
  );
  return updateVideoSeriesFields(seriesId, {
    character_id: unique[0] || null,
    cast_json: JSON.stringify(unique),
  });
}

export function appendSeriesCast(
  seriesId: string,
  characterId: string,
): ArticleVideoSeries | undefined {
  const current = getDb()
    .prepare(`SELECT * FROM article_video_series WHERE id = ?`)
    .get(seriesId) as ArticleVideoSeries | undefined;
  if (!current) return undefined;
  const id = characterId.trim();
  if (!id) return hydrateVideoSeries(current);
  const ids = parseCastIds(current.cast_json, current.character_id);
  if (ids.includes(id)) return hydrateVideoSeries(current);
  return setSeriesCast(seriesId, [...ids, id]);
}

export function listSeriesCharacters(articleId: string): StudioCharacter[] {
  const series = getVideoSeriesByArticle(articleId);
  if (!series) return [];
  const article = getArticle(articleId);
  const workspaceId = article?.workspace_id || "ws_local";
  const ids = parseCastIds(series.cast_json, series.character_id);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT * FROM studio_characters
       WHERE workspace_id = ? AND id IN (${placeholders})`,
    )
    .all(workspaceId, ...ids) as StudioCharacter[];
  const byId = new Map(
    rows.map((row) => [row.id, hydrateStudioCharacter(row)!] as const),
  );
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is StudioCharacter => Boolean(row));
}

export function updateVideoEpisodeFields(
  episodeId: string,
  patch: Partial<
    Pick<
      ArticleVideoEpisode,
      | "title"
      | "hook"
      | "voiceover"
      | "on_screen"
      | "recap"
      | "next_hook"
      | "duration_sec"
      | "shots_json"
      | "director_json"
      | "confirmed"
    >
  >,
): ArticleVideoEpisode | undefined {
  const current = getVideoEpisode(episodeId);
  if (!current) return undefined;
  const next: ArticleVideoEpisode = {
    ...current,
    title: patch.title ?? current.title,
    hook: patch.hook ?? current.hook,
    voiceover: patch.voiceover ?? current.voiceover,
    on_screen: patch.on_screen ?? current.on_screen,
    recap: patch.recap ?? current.recap,
    next_hook: patch.next_hook ?? current.next_hook,
    duration_sec: patch.duration_sec ?? current.duration_sec,
    shots_json: patch.shots_json ?? current.shots_json,
    director_json: patch.director_json ?? current.director_json ?? "",
    confirmed: patch.confirmed ?? current.confirmed,
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE article_video_episodes
       SET title = @title, hook = @hook, voiceover = @voiceover, on_screen = @on_screen,
           recap = @recap, next_hook = @next_hook, duration_sec = @duration_sec,
           shots_json = @shots_json, director_json = @director_json, confirmed = @confirmed, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(next);
  return next;
}

export function replaceVideoEpisodeScript(
  episodeId: string,
  patch: Pick<
    ArticleVideoEpisode,
    | "title"
    | "hook"
    | "voiceover"
    | "on_screen"
    | "recap"
    | "next_hook"
    | "duration_sec"
    | "shots_json"
    | "director_json"
  >,
): ArticleVideoEpisode | undefined {
  const current = getVideoEpisode(episodeId);
  if (!current) return undefined;
  const next: ArticleVideoEpisode = {
    ...current,
    ...patch,
    confirmed: 0,
    video_status: "idle",
    video_url: null,
    source_video_url: null,
    subtitle_url: null,
    caption_cues_json: "",
    video_error: null,
    video_model: null,
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE article_video_episodes
       SET title = @title, hook = @hook, voiceover = @voiceover, on_screen = @on_screen,
           recap = @recap, next_hook = @next_hook, duration_sec = @duration_sec,
           shots_json = @shots_json, director_json = @director_json, confirmed = 0, video_status = 'idle',
           video_url = NULL, source_video_url = NULL, subtitle_url = NULL,
           caption_cues_json = '', video_error = NULL, video_model = NULL, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(next);
  return next;
}

export function insertVideoEpisode(input: {
  seriesId: string;
  episode_no: number;
  title: string;
  hook: string;
  voiceover: string;
  on_screen: string;
  recap: string;
  next_hook: string;
  duration_sec: number;
  shots_json: string;
  director_json?: string;
}): ArticleVideoEpisode {
  const now = new Date().toISOString();
  const row: ArticleVideoEpisode = {
    id: randomUUID(),
    series_id: input.seriesId,
    episode_no: input.episode_no,
    title: input.title,
    hook: input.hook,
    voiceover: input.voiceover,
    on_screen: input.on_screen,
    recap: input.recap,
    next_hook: input.next_hook,
    duration_sec: input.duration_sec,
    shots_json: input.shots_json,
    director_json: input.director_json || "",
    confirmed: 0,
    video_status: "idle",
    video_url: null,
    subtitle_url: null,
    video_error: null,
    video_model: null,
    created_at: now,
    updated_at: now,
  };
  const database = getDb();
  const write = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO article_video_episodes
         (id, series_id, episode_no, title, hook, voiceover, on_screen, recap, next_hook,
          duration_sec, shots_json, director_json, confirmed, video_status, video_url, video_error, video_model,
          created_at, updated_at)
         VALUES (@id, @series_id, @episode_no, @title, @hook, @voiceover, @on_screen, @recap, @next_hook,
          @duration_sec, @shots_json, @director_json, @confirmed, @video_status, @video_url, @video_error, @video_model,
          @created_at, @updated_at)`,
      )
      .run(row);
    const count = (
      database
        .prepare(
          `SELECT COUNT(*) AS n FROM article_video_episodes WHERE series_id = ?`,
        )
        .get(input.seriesId) as { n: number }
    ).n;
    database
      .prepare(
        `UPDATE article_video_series
         SET episode_count = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(count, now, input.seriesId);
    return row;
  });
  return write();
}

export function setVideoEpisodeRender(
  episodeId: string,
  patch: {
    video_status: VideoEpisodeStatus;
    video_url?: string | null;
    source_video_url?: string | null;
    subtitle_url?: string | null;
    caption_style_json?: string | null;
    caption_cues_json?: string | null;
    video_error?: string | null;
    video_model?: string | null;
  },
): ArticleVideoEpisode | undefined {
  const current = getVideoEpisode(episodeId);
  if (!current) return undefined;
  const next: ArticleVideoEpisode = {
    ...current,
    video_status: patch.video_status,
    video_url:
      patch.video_url !== undefined ? patch.video_url : current.video_url,
    source_video_url:
      patch.source_video_url !== undefined
        ? patch.source_video_url
        : current.source_video_url ?? null,
    subtitle_url:
      patch.subtitle_url !== undefined
        ? patch.subtitle_url
        : current.subtitle_url,
    caption_style_json:
      patch.caption_style_json !== undefined
        ? patch.caption_style_json
        : current.caption_style_json ?? "",
    caption_cues_json:
      patch.caption_cues_json !== undefined
        ? patch.caption_cues_json
        : current.caption_cues_json ?? "",
    video_error:
      patch.video_error !== undefined ? patch.video_error : current.video_error,
    video_model:
      patch.video_model !== undefined ? patch.video_model : current.video_model,
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE article_video_episodes
       SET video_status = @video_status, video_url = @video_url,
           source_video_url = @source_video_url, subtitle_url = @subtitle_url,
           caption_style_json = @caption_style_json, caption_cues_json = @caption_cues_json,
           video_error = @video_error, video_model = @video_model, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(next);
  return next;
}

/** 文章列表旁注：剧本集数 / 已出片数（仅查给定 id） */
export function videoCountsForArticles(
  articleIds: string[],
): Map<string, { scripts: number; videos: number }> {
  const out = new Map<string, { scripts: number; videos: number }>();
  if (!articleIds.length) return out;
  const placeholders = articleIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT s.article_id AS article_id,
              COUNT(e.id) AS scripts,
              SUM(
                CASE
                  WHEN e.video_status = 'ready'
                    OR (e.video_url IS NOT NULL AND TRIM(e.video_url) != '')
                  THEN 1 ELSE 0
                END
              ) AS videos
       FROM article_video_series s
       INNER JOIN article_video_episodes e ON e.series_id = s.id
       WHERE s.article_id IN (${placeholders})
       GROUP BY s.article_id`,
    )
    .all(...articleIds) as Array<{
    article_id: string;
    scripts: number;
    videos: number;
  }>;
  for (const row of rows) {
    out.set(row.article_id, {
      scripts: Number(row.scripts) || 0,
      videos: Number(row.videos) || 0,
    });
  }
  return out;
}

export function podcastCountsForArticles(articleIds: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!articleIds.length) return out;
  try {
    const placeholders = articleIds.map(() => "?").join(",");
    const rows = getDb()
      .prepare(
        `SELECT article_id AS article_id
         FROM article_podcasts
         WHERE article_id IN (${placeholders})
           AND status = 'ready'`,
      )
      .all(...articleIds) as Array<{ article_id: string }>;
    for (const row of rows) out.set(row.article_id, 1);
  } catch {
    // table may not exist on a very old snapshot
  }
  return out;
}

export function listPodcastCatalog(
  workspaceId: string,
  limit?: number,
  offset = 0,
): PodcastCatalogItem[] {
  try {
    const capped =
      typeof limit === "number" && limit > 0
        ? Math.min(500, Math.floor(limit))
        : null;
    const off = Math.max(0, Math.floor(offset) || 0);
    const rows = getDb()
      .prepare(
        `SELECT
           p.article_id AS article_id,
           a.title AS article_title,
           p.title AS podcast_title,
           p.mode AS mode,
           p.audio_url AS audio_url,
           p.cover_url AS cover_url,
           p.duration_sec AS duration_sec,
           p.turns_json AS turns_json,
           p.updated_at AS updated_at
         FROM article_podcasts p
         INNER JOIN articles a ON a.id = p.article_id
         WHERE (a.workspace_id = ? OR a.workspace_id IS NULL OR a.workspace_id = '')
           AND p.status = 'ready'
           AND (
             (p.audio_url IS NOT NULL AND TRIM(p.audio_url) != '')
             OR (p.turns_json IS NOT NULL AND TRIM(p.turns_json) != '' AND TRIM(p.turns_json) != '[]')
           )
         ORDER BY p.updated_at DESC
         ${capped == null ? "" : "LIMIT ? OFFSET ?"}`,
      )
      .all(
        ...(capped == null
          ? [workspaceId]
          : [workspaceId, capped, off]),
      ) as Array<{
      article_id: string;
      article_title: string;
      podcast_title: string;
      mode: string;
      audio_url: string | null;
      cover_url: string | null;
      duration_sec: number;
      turns_json: string;
      updated_at: string;
    }>;
    const items: PodcastCatalogItem[] = [];
    for (const row of rows) {
      const turns = parsePodcastTurns(row.turns_json);
      const hasAudio = Boolean(String(row.audio_url || "").trim());
      if (!hasAudio && turns.length === 0) continue;
      items.push({
        article_id: row.article_id,
        article_title: row.article_title,
        podcast_title: row.podcast_title || row.article_title,
        mode: row.mode === "solo" ? "solo" : "dialogue",
        audio_url: row.audio_url,
        cover_url: row.cover_url || null,
        duration_sec: Number(row.duration_sec) || 0,
        turn_count: turns.length,
        turns,
        updated_at: row.updated_at,
      });
    }
    return items;
  } catch {
    return [];
  }
}

export function listVideoCatalog(
  workspaceId: string,
  limit?: number,
  offset = 0,
): VideoCatalogItem[] {
  const capped =
    typeof limit === "number" && limit > 0
      ? Math.min(500, Math.floor(limit))
      : null;
  const off = Math.max(0, Math.floor(offset) || 0);
  const sql = `SELECT
         a.id AS article_id,
         a.title AS article_title,
         s.id AS series_id,
         s.title AS series_title,
         s.genre AS genre,
         s.hook_style AS hook_style,
         e.id AS episode_id,
         e.episode_no AS episode_no,
         e.title AS episode_title,
         e.confirmed AS confirmed,
         e.video_status AS video_status,
         e.video_url AS video_url,
         e.updated_at AS updated_at
       FROM article_video_episodes e
       INNER JOIN article_video_series s ON s.id = e.series_id
       INNER JOIN articles a ON a.id = s.article_id
       WHERE a.workspace_id = ? OR a.workspace_id IS NULL OR a.workspace_id = ''
       ORDER BY e.updated_at DESC, e.episode_no ASC${
         capped != null ? " LIMIT ? OFFSET ?" : ""
       }`;
  const rows = (
    capped != null
      ? getDb().prepare(sql).all(workspaceId, capped, off)
      : getDb().prepare(sql).all(workspaceId)
  ) as Array<{
    article_id: string;
    article_title: string;
    series_id: string;
    series_title: string;
    genre: VideoScriptGenre;
    hook_style?: string;
    episode_id: string;
    episode_no: number;
    episode_title: string;
    confirmed: number;
    video_status: VideoEpisodeStatus;
    video_url: string | null;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    article_id: row.article_id,
    article_title: row.article_title,
    series_id: row.series_id,
    series_title: row.series_title,
    genre: row.genre,
    hook_style: row.hook_style,
    episode_id: row.episode_id,
    episode_no: row.episode_no,
    episode_title: row.episode_title,
    confirmed: row.confirmed === 1,
    video_status: row.video_status,
    video_url: row.video_url,
    updated_at: row.updated_at,
  }));
}

/** 只返回已有可播放曲目的系列，类似视频页只列有成片的。 */
export function listMusicCatalog(
  workspaceId: string,
  limit?: number,
  offset = 0,
): MusicCatalogItem[] {
  const capped =
    typeof limit === "number" && limit > 0
      ? Math.min(500, Math.floor(limit))
      : null;
  const off = Math.max(0, Math.floor(offset) || 0);
  const rows = getDb()
    .prepare(
      `SELECT
         a.id AS article_id,
         a.title AS article_title,
         s.id AS series_id,
         s.title AS series_title,
         s.genre AS genre,
         s.hook_style AS hook_style,
         s.music_json AS music_json,
         s.updated_at AS updated_at
       FROM article_video_series s
       INNER JOIN articles a ON a.id = s.article_id
       WHERE (a.workspace_id = ? OR a.workspace_id IS NULL OR a.workspace_id = '')
         AND s.music_json IS NOT NULL
         AND TRIM(s.music_json) != ''
       ORDER BY s.updated_at DESC`,
    )
    .all(workspaceId) as Array<{
    article_id: string;
    article_title: string;
    series_id: string;
    series_title: string;
    genre: VideoScriptGenre;
    hook_style?: string;
    music_json: string;
    updated_at: string;
  }>;

  const playable: MusicCatalogItem[] = [];
  for (const row of rows) {
    let trackCount = 0;
    let status = "idle";
    try {
      const parsed = JSON.parse(row.music_json || "{}") as {
        status?: string;
        tracks?: Array<{ url?: string; streamUrl?: string }>;
      };
      status = typeof parsed.status === "string" ? parsed.status : "idle";
      trackCount = Array.isArray(parsed.tracks)
        ? parsed.tracks.filter(
            (t) =>
              Boolean(String(t?.url || "").trim()) ||
              Boolean(String(t?.streamUrl || "").trim()),
          ).length
        : 0;
    } catch {
      continue;
    }
    if (trackCount <= 0) continue;
    playable.push({
      article_id: row.article_id,
      article_title: row.article_title,
      series_id: row.series_id,
      series_title: row.series_title,
      genre: row.genre,
      hook_style: row.hook_style,
      track_count: trackCount,
      music_status: status,
      updated_at: row.updated_at,
    });
  }

  if (capped == null) return playable;
  return playable.slice(off, off + capped);
}

export function createVideoPublishJob(input: {
  episodeId: string;
  articleId: string;
  platform: string;
}): VideoPublishJob {
  const now = new Date().toISOString();
  const row: VideoPublishJob = {
    id: randomUUID(),
    episode_id: input.episodeId,
    article_id: input.articleId,
    platform: input.platform,
    status: "running",
    error: null,
    result_url: null,
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO video_publish_jobs
       (id, episode_id, article_id, platform, status, error, result_url, created_at, updated_at)
       VALUES (@id, @episode_id, @article_id, @platform, @status, @error, @result_url, @created_at, @updated_at)`,
    )
    .run(row);
  return row;
}

export function getVideoPublishJob(id: string): VideoPublishJob | undefined {
  return getDb()
    .prepare(`SELECT * FROM video_publish_jobs WHERE id = ?`)
    .get(id) as VideoPublishJob | undefined;
}

export function updateVideoPublishJob(
  id: string,
  patch: Partial<Pick<VideoPublishJob, "status" | "error" | "result_url">>,
): VideoPublishJob | undefined {
  const current = getDb()
    .prepare(`SELECT * FROM video_publish_jobs WHERE id = ?`)
    .get(id) as VideoPublishJob | undefined;
  if (!current) return undefined;
  const next: VideoPublishJob = {
    ...current,
    status: patch.status ?? current.status,
    error: patch.error !== undefined ? patch.error : current.error,
    result_url:
      patch.result_url !== undefined ? patch.result_url : current.result_url,
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE video_publish_jobs
       SET status = @status, error = @error, result_url = @result_url, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(next);
  return next;
}

export function failRunningVideoPublishJobs(
  reason = "已改点重新发布",
): void {
  getDb()
    .prepare(
      `UPDATE video_publish_jobs
       SET status = 'failed', error = ?, updated_at = ?
       WHERE status IN ('pending', 'running')`,
    )
    .run(reason, new Date().toISOString());
}

export function listVideoPublishJobs(
  workspaceId: string,
  limit = 40,
): VideoPublishJob[] {
  return getDb()
    .prepare(
      `SELECT
         j.id, j.episode_id, j.article_id, j.platform, j.status, j.error, j.result_url,
         j.created_at, j.updated_at,
         e.episode_no AS episode_no,
         e.title AS episode_title,
         s.title AS series_title
       FROM video_publish_jobs j
       INNER JOIN article_video_episodes e ON e.id = j.episode_id
       INNER JOIN article_video_series s ON s.id = e.series_id
       INNER JOIN articles a ON a.id = j.article_id
       WHERE a.workspace_id = ? OR a.workspace_id IS NULL OR a.workspace_id = ''
       ORDER BY j.created_at DESC
       LIMIT ?`,
    )
    .all(workspaceId, limit) as VideoPublishJob[];
}

export function createMusicPublishJob(input: {
  articleId: string;
  seriesId: string;
  trackId: string;
  platform: string;
}): MusicPublishJob {
  const now = new Date().toISOString();
  const row: MusicPublishJob = {
    id: randomUUID(),
    article_id: input.articleId,
    series_id: input.seriesId,
    track_id: input.trackId,
    platform: input.platform,
    status: "running",
    error: null,
    result_url: null,
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO music_publish_jobs
       (id, article_id, series_id, track_id, platform, status, error, result_url, created_at, updated_at)
       VALUES (@id, @article_id, @series_id, @track_id, @platform, @status, @error, @result_url, @created_at, @updated_at)`,
    )
    .run(row);
  return row;
}

export function getMusicPublishJob(id: string): MusicPublishJob | undefined {
  return getDb()
    .prepare(`SELECT * FROM music_publish_jobs WHERE id = ?`)
    .get(id) as MusicPublishJob | undefined;
}

export function updateMusicPublishJob(
  id: string,
  patch: Partial<Pick<MusicPublishJob, "status" | "error" | "result_url">>,
): MusicPublishJob | undefined {
  const current = getDb()
    .prepare(`SELECT * FROM music_publish_jobs WHERE id = ?`)
    .get(id) as MusicPublishJob | undefined;
  if (!current) return undefined;
  const next: MusicPublishJob = {
    ...current,
    status: patch.status ?? current.status,
    error: patch.error === undefined ? current.error : patch.error,
    result_url:
      patch.result_url === undefined ? current.result_url : patch.result_url,
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE music_publish_jobs
       SET status = @status, error = @error, result_url = @result_url, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(next);
  return next;
}

export function failRunningMusicPublishJobs(
  reason = "已改点重新发布",
): void {
  getDb()
    .prepare(
      `UPDATE music_publish_jobs
       SET status = 'failed', error = ?, updated_at = ?
       WHERE status IN ('pending', 'running')`,
    )
    .run(reason, new Date().toISOString());
}

export function listMusicPublishJobs(
  workspaceId: string,
  limit = 40,
): MusicPublishJob[] {
  return getDb()
    .prepare(
      `SELECT
         j.id, j.article_id, j.series_id, j.track_id, j.platform, j.status, j.error, j.result_url,
         j.created_at, j.updated_at,
         s.title AS series_title
       FROM music_publish_jobs j
       INNER JOIN article_video_series s ON s.id = j.series_id
       INNER JOIN articles a ON a.id = j.article_id
       WHERE a.workspace_id = ? OR a.workspace_id IS NULL OR a.workspace_id = ''
       ORDER BY j.created_at DESC
       LIMIT ?`,
    )
    .all(workspaceId, limit) as MusicPublishJob[];
}

function studioAsArticleCharacter(
  articleId: string,
  studio: StudioCharacter,
): ArticleVideoCharacter {
  return {
    id: studio.id,
    article_id: articleId,
    name: studio.name,
    photos_json: studio.photos_json,
    angles_json: studio.angles_json,
    created_at: studio.created_at,
    updated_at: studio.updated_at,
  };
}

export function getBoundStudioCharacter(
  articleId: string,
): StudioCharacter | undefined {
  const article = getArticle(articleId);
  const workspaceId = article?.workspace_id || "ws_local";
  const series = getVideoSeriesByArticle(articleId);
  if (series?.character_id) {
    const bound = getStudioCharacter(series.character_id, workspaceId);
    if (bound) return bound;
  }
  return hydrateStudioCharacter(
    getDb()
      .prepare(
        `SELECT * FROM studio_characters
         WHERE article_id = ?
         ORDER BY updated_at DESC`,
      )
      .get(articleId) as StudioCharacter | undefined,
  );
}

export function getVideoCharacter(
  articleId: string,
): ArticleVideoCharacter | undefined {
  const studio = getBoundStudioCharacter(articleId);
  if (studio) return studioAsArticleCharacter(articleId, studio);
  return getDb()
    .prepare(`SELECT * FROM article_video_characters WHERE article_id = ?`)
    .get(articleId) as ArticleVideoCharacter | undefined;
}

export function upsertVideoCharacter(input: {
  articleId: string;
  name?: string;
  photos_json?: string;
  angles_json?: string;
  source?: CharacterSource;
  skipStudioSync?: boolean;
}): ArticleVideoCharacter {
  const article = getArticle(input.articleId);
  const workspaceId = article?.workspace_id || "ws_local";
  const series = getVideoSeriesByArticle(input.articleId);
  const bound = getBoundStudioCharacter(input.articleId);

  if (input.skipStudioSync) {
    if (bound) return studioAsArticleCharacter(input.articleId, bound);
  }

  if (bound) {
    const updated = updateStudioCharacter({
      id: bound.id,
      workspaceId,
      name: input.name,
      photos_json: input.photos_json,
      angles_json: input.angles_json,
      source: input.source,
    });
    if (updated) {
      if (series && series.character_id !== updated.id) {
        updateVideoSeriesFields(series.id, { character_id: updated.id });
      }
      return studioAsArticleCharacter(input.articleId, updated);
    }
  }

  const created = createStudioCharacter({
    workspaceId,
    name: input.name,
    photos_json: input.photos_json ?? "[]",
    angles_json: input.angles_json ?? "[]",
    source: input.source,
    articleId: input.articleId,
  });
  if (series) {
    updateVideoSeriesFields(series.id, { character_id: created.id });
  }
  return studioAsArticleCharacter(input.articleId, created);
}

export function bindStudioCharacterToArticle(
  articleId: string,
  character: StudioCharacter,
): ArticleVideoCharacter {
  const series = getVideoSeriesByArticle(articleId);
  if (series) {
    appendSeriesCast(series.id, character.id);
  }
  return studioAsArticleCharacter(articleId, character);
}

function hydrateStudioCharacter(
  row: StudioCharacter | undefined,
): StudioCharacter | undefined {
  if (!row) return undefined;
  return {
    ...row,
    voice_id: typeof row.voice_id === "string" ? row.voice_id : "",
    look: typeof row.look === "string" ? row.look : "",
  };
}

export function getStudioCharacter(
  id: string,
  workspaceId: string,
): StudioCharacter | undefined {
  return hydrateStudioCharacter(
    getDb()
      .prepare(
        `SELECT * FROM studio_characters WHERE id = ? AND workspace_id = ?`,
      )
      .get(id, workspaceId) as StudioCharacter | undefined,
  );
}

function parseCharacterPhotos(photosJson: string): VideoCharacterPhoto[] {
  return parsePhotos(photosJson);
}

function parseCharacterAngles(anglesJson: string): VideoCharacterAngle[] {
  return parseAngles(anglesJson);
}

export function listCharacterCatalog(
  workspaceId: string,
  options?: { angles?: "full" | "first"; limit?: number; offset?: number },
): CharacterCatalogItem[] {
  const angleMode = options?.angles || "full";
  const capped =
    typeof options?.limit === "number" && options.limit > 0
      ? Math.min(500, Math.floor(options.limit))
      : null;
  const off = Math.max(0, Math.floor(options?.offset || 0));
  const bindings = getDb()
    .prepare(
      `SELECT s.character_id, s.cast_json, s.article_id, s.title AS series_title, a.title AS article_title
       FROM article_video_series s
       INNER JOIN articles a ON a.id = s.article_id
       WHERE a.workspace_id = ?
       ORDER BY s.updated_at DESC`,
    )
    .all(workspaceId) as Array<{
    character_id: string | null;
    cast_json: string;
    article_id: string;
    series_title: string;
    article_title: string | null;
  }>;
  const scriptsByCharacter = new Map<
    string,
    Array<{ article_id: string; title: string }>
  >();
  for (const row of bindings) {
    const title = (row.series_title || row.article_title || "未命名剧本").trim();
    for (const characterId of parseCastIds(row.cast_json, row.character_id)) {
      const list = scriptsByCharacter.get(characterId) || [];
      if (!list.some((item) => item.article_id === row.article_id)) {
        list.push({ article_id: row.article_id, title });
      }
      scriptsByCharacter.set(characterId, list);
    }
  }
  const sql =
    capped != null
      ? `SELECT c.id, c.name, c.source, c.article_id, c.voice_id, c.look,
              c.photos_json, c.angles_json, c.updated_at, a.title AS article_title
       FROM studio_characters c
       LEFT JOIN articles a ON a.id = c.article_id
       WHERE c.workspace_id = ?
       ORDER BY c.updated_at DESC
       LIMIT ? OFFSET ?`
      : `SELECT c.id, c.name, c.source, c.article_id, c.voice_id, c.look,
              c.photos_json, c.angles_json, c.updated_at, a.title AS article_title
       FROM studio_characters c
       LEFT JOIN articles a ON a.id = c.article_id
       WHERE c.workspace_id = ?
       ORDER BY c.updated_at DESC`;
  const rows = (
    capped != null
      ? getDb().prepare(sql).all(workspaceId, capped, off)
      : getDb().prepare(sql).all(workspaceId)
  ) as Array<{
    id: string;
    name: string;
    source: string;
    article_id: string | null;
    voice_id: string | null;
    look: string | null;
    photos_json: string;
    angles_json: string;
    updated_at: string;
    article_title: string | null;
  }>;
  return rows.map((row) => {
    let photos = parseCharacterPhotos(row.photos_json);
    let angles = parseCharacterAngles(row.angles_json);
    if (angleMode === "first") {
      photos = photos.slice(0, 1);
      angles = angles.slice(0, 1);
    }
    return {
      id: row.id,
      name: row.name,
      source: row.source === "script" ? "script" : "photo",
      article_id: row.article_id,
      article_title: row.article_title || null,
      voice_id: typeof row.voice_id === "string" ? row.voice_id : "",
      look: typeof row.look === "string" ? row.look : "",
      scripts: scriptsByCharacter.get(row.id) || [],
      photos,
      angles,
      updated_at: row.updated_at,
    };
  });
}

export function createStudioCharacter(input: {
  workspaceId: string;
  name?: string;
  photos_json?: string;
  angles_json?: string;
  source?: CharacterSource;
  articleId?: string | null;
  voice_id?: string;
  look?: string;
}): StudioCharacter {
  const now = new Date().toISOString();
  const row: StudioCharacter = {
    id: randomUUID(),
    workspace_id: input.workspaceId,
    name: input.name?.trim() || "",
    photos_json: input.photos_json ?? "[]",
    angles_json: input.angles_json ?? "[]",
    source: input.source || "photo",
    article_id: input.articleId?.trim() || null,
    voice_id: input.voice_id?.trim() || "",
    look: input.look?.replace(/\s+/g, " ").trim().slice(0, 360) || "",
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO studio_characters
       (id, workspace_id, name, photos_json, angles_json, source, article_id, voice_id, look, created_at, updated_at)
       VALUES (@id, @workspace_id, @name, @photos_json, @angles_json, @source, @article_id, @voice_id, @look, @created_at, @updated_at)`,
    )
    .run(row);
  return row;
}

export function updateStudioCharacter(input: {
  id: string;
  workspaceId: string;
  name?: string;
  photos_json?: string;
  angles_json?: string;
  source?: CharacterSource;
  voice_id?: string;
  look?: string;
}): StudioCharacter | undefined {
  const current = getStudioCharacter(input.id, input.workspaceId);
  if (!current) return undefined;
  const next: StudioCharacter = {
    ...current,
    name: input.name !== undefined ? input.name.trim() : current.name,
    photos_json: input.photos_json ?? current.photos_json,
    angles_json: input.angles_json ?? current.angles_json,
    source: input.source ?? current.source,
    voice_id:
      input.voice_id !== undefined ? input.voice_id.trim() : current.voice_id,
    look:
      input.look !== undefined
        ? input.look.replace(/\s+/g, " ").trim().slice(0, 360)
        : current.look,
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE studio_characters
       SET name = @name, photos_json = @photos_json, angles_json = @angles_json,
           source = @source, voice_id = @voice_id, look = @look, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(next);
  return next;
}

export function listStudioVoices(workspaceId: string): StudioVoice[] {
  return getDb()
    .prepare(
      `SELECT * FROM studio_voices WHERE workspace_id = ? ORDER BY updated_at DESC`,
    )
    .all(workspaceId) as StudioVoice[];
}

export function getStudioVoice(
  id: string,
  workspaceId: string,
): StudioVoice | undefined {
  return getDb()
    .prepare(`SELECT * FROM studio_voices WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as StudioVoice | undefined;
}

export function getStudioVoiceByProviderId(
  providerVoiceId: string,
): StudioVoice | undefined {
  const id = providerVoiceId.trim();
  if (!id) return undefined;
  return getDb()
    .prepare(
      `SELECT * FROM studio_voices WHERE provider_voice_id = ? ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(id) as StudioVoice | undefined;
}

export function createStudioVoice(input: {
  workspaceId: string;
  name: string;
  hint?: string;
  provider: string;
  provider_voice_id: string;
  provider_model: string;
  sample_url?: string;
}): StudioVoice {
  const now = new Date().toISOString();
  const row: StudioVoice = {
    id: randomUUID(),
    workspace_id: input.workspaceId,
    name: input.name.trim().slice(0, 24) || "我的音色",
    hint: (input.hint || "").trim().slice(0, 80),
    provider: input.provider.trim() || "qwen",
    provider_voice_id: input.provider_voice_id.trim(),
    provider_model: input.provider_model.trim(),
    sample_url: input.sample_url?.trim() || "",
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO studio_voices
       (id, workspace_id, name, hint, provider, provider_voice_id, provider_model, sample_url, created_at, updated_at)
       VALUES (@id, @workspace_id, @name, @hint, @provider, @provider_voice_id, @provider_model, @sample_url, @created_at, @updated_at)`,
    )
    .run(row);
  return row;
}

export function updateStudioVoice(input: {
  id: string;
  workspaceId: string;
  name?: string;
  hint?: string;
}): StudioVoice | undefined {
  const current = getStudioVoice(input.id, input.workspaceId);
  if (!current) return undefined;
  const next: StudioVoice = {
    ...current,
    name:
      input.name !== undefined
        ? input.name.trim().slice(0, 24) || current.name
        : current.name,
    hint:
      input.hint !== undefined ? input.hint.trim().slice(0, 80) : current.hint,
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE studio_voices
       SET name = @name, hint = @hint, updated_at = @updated_at
       WHERE id = @id AND workspace_id = @workspace_id`,
    )
    .run({
      id: next.id,
      workspace_id: input.workspaceId,
      name: next.name,
      hint: next.hint,
      updated_at: next.updated_at,
    });
  return next;
}

export function deleteStudioVoice(id: string, workspaceId: string): boolean {
  const result = getDb()
    .prepare(`DELETE FROM studio_voices WHERE id = ? AND workspace_id = ?`)
    .run(id, workspaceId);
  return Number(result.changes) > 0;
}

const DEFAULT_MENTION_BRANDS = ["点物", "dianwu.ai", "dianwu"];
const DEFAULT_MENTION_QUESTIONS = [
  "GEO是什么？中小企业怎么做？",
  "GEO和SEO、AEO有什么区别？",
  "有哪些工具能把一篇文章同步到知乎、头条、公众号？",
  "多平台内容分发怎么做才不容易被当成硬广？",
  "GEO服务商怎么选？有没有自己就能做的办法？",
  "dianwu 或点物是做什么的？",
];

function parseJsonList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

type MentionSettingsRow = {
  brands: string;
  questions: string;
  updated_at: string;
  doubao_api_key?: string;
  doubao_model?: string;
};

function readMentionSettingsRow(): MentionSettingsRow | undefined {
  return getDb()
    .prepare("SELECT * FROM mention_settings WHERE id = ?")
    .get("default") as MentionSettingsRow | undefined;
}

export function getDoubaoStoredSecret(): { apiKey: string; model: string } {
  const row = readMentionSettingsRow();
  return {
    apiKey: row?.doubao_api_key?.trim() || "",
    model: row?.doubao_model?.trim() || "",
  };
}

export function getMentionSettings(): MentionSettings {
  const row = readMentionSettingsRow();
  if (!row) {
    return {
      brands: DEFAULT_MENTION_BRANDS,
      questions: DEFAULT_MENTION_QUESTIONS,
      updated_at: new Date().toISOString(),
      doubao_model: "",
      doubao_configured: false,
    };
  }
  const brands = parseJsonList(row.brands);
  const questions = parseJsonList(row.questions);
  return {
    brands: brands.length ? brands : DEFAULT_MENTION_BRANDS,
    questions: questions.length ? questions : DEFAULT_MENTION_QUESTIONS,
    updated_at: row.updated_at,
    doubao_model: row.doubao_model?.trim() || "",
    doubao_configured: Boolean(row.doubao_api_key?.trim()),
  };
}

export function saveMentionSettings(input: {
  brands: string[];
  questions: string[];
  doubaoApiKey?: string;
  doubaoModel?: string;
}): MentionSettings {
  const prev = getDoubaoStoredSecret();
  const doubaoApiKey =
    input.doubaoApiKey !== undefined && input.doubaoApiKey.trim()
      ? input.doubaoApiKey.trim()
      : prev.apiKey;
  const doubaoModel =
    input.doubaoModel !== undefined
      ? input.doubaoModel.trim()
      : prev.model;
  const next: MentionSettings = {
    brands: input.brands.map((x) => x.trim()).filter(Boolean).slice(0, 12),
    questions: input.questions
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 8),
    updated_at: new Date().toISOString(),
    doubao_model: doubaoModel,
    doubao_configured: Boolean(doubaoApiKey),
  };
  getDb()
    .prepare(
      `INSERT INTO mention_settings
         (id, brands, questions, updated_at, doubao_api_key, doubao_model)
       VALUES
         ('default', @brands, @questions, @updated_at, @doubao_api_key, @doubao_model)
       ON CONFLICT(id) DO UPDATE SET
         brands = @brands,
         questions = @questions,
         updated_at = @updated_at,
         doubao_api_key = @doubao_api_key,
         doubao_model = @doubao_model`,
    )
    .run({
      brands: JSON.stringify(next.brands),
      questions: JSON.stringify(next.questions),
      updated_at: next.updated_at,
      doubao_api_key: doubaoApiKey,
      doubao_model: doubaoModel,
    });
  return next;
}

function mapMentionResult(row: {
  id: string;
  run_id: string;
  question: string;
  source: string;
  mentioned: number;
  excerpt: string;
  answer: string;
  error: string;
}): MentionResult {
  const source = row.source as MentionSource;
  return {
    id: row.id,
    run_id: row.run_id,
    question: row.question,
    source:
      source === "doubao" ||
      source === "yuanbao" ||
      source === "qwen" ||
      source === "other"
        ? source
        : "deepseek",
    mentioned: row.mentioned === 1,
    excerpt: row.excerpt,
    answer: row.answer,
    error: row.error,
  };
}

export function listMentionRuns(
  limit = 20,
  workspaceId?: string | null,
  offset = 0,
): MentionRun[] {
  const off = Math.max(0, Math.floor(offset) || 0);
  const runs = (
    workspaceId
      ? getDb()
          .prepare(
            `SELECT * FROM mention_runs
             WHERE workspace_id = ?
             ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          )
          .all(workspaceId, limit, off)
      : getDb()
          .prepare(
            `SELECT * FROM mention_runs ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          )
          .all(limit, off)
  ) as Array<{
    id: string;
    created_at: string;
    model: string;
    hit_count: number;
    miss_count: number;
    error_count: number;
  }>;
  if (!runs.length) return [];
  const ids = runs.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT id, run_id, question, source, mentioned, excerpt, error,
              CASE
                WHEN length(answer) > 400 THEN substr(answer, 1, 400) || '…'
                ELSE answer
              END AS answer
       FROM mention_results WHERE run_id IN (${placeholders})`,
    )
    .all(...ids) as Array<{
    id: string;
    run_id: string;
    question: string;
    source: string;
    mentioned: number;
    excerpt: string;
    answer: string;
    error: string;
  }>;
  const byRun = new Map<string, MentionResult[]>();
  for (const row of rows) {
    const list = byRun.get(row.run_id) ?? [];
    list.push(mapMentionResult(row));
    byRun.set(row.run_id, list);
  }
  return runs.map((run) => ({
    ...run,
    results: byRun.get(run.id) ?? [],
  }));
}

/** 总览用：只要最近一次查排名计数，不拉 answer 大字段 */
export function getLatestMentionRunSummary(
  workspaceId: string,
): {
  id: string;
  created_at: string;
  hit_count: number;
  miss_count: number;
  error_count: number;
} | null {
  const row = getDb()
    .prepare(
      `SELECT id, created_at, hit_count, miss_count, error_count
       FROM mention_runs
       WHERE workspace_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(workspaceId) as
    | {
        id: string;
        created_at: string;
        hit_count: number;
        miss_count: number;
        error_count: number;
      }
    | undefined;
  return row || null;
}

export function insertMentionRun(input: {
  model: string;
  results: Array<Omit<MentionResult, "id" | "run_id">>;
  workspaceId?: string;
}): MentionRun {
  const id = randomUUID();
  const created_at = new Date().toISOString();
  const hit_count = input.results.filter((r) => r.mentioned && !r.error).length;
  const error_count = input.results.filter((r) => r.error).length;
  const miss_count = input.results.length - hit_count - error_count;
  getDb()
    .prepare(
      `INSERT INTO mention_runs
       (id, created_at, model, hit_count, miss_count, error_count, workspace_id)
       VALUES (@id, @created_at, @model, @hit_count, @miss_count, @error_count, @workspace_id)`,
    )
    .run({
      id,
      created_at,
      model: input.model,
      hit_count,
      miss_count,
      error_count,
      workspace_id: input.workspaceId || "ws_local",
    });
  const insert = getDb().prepare(
    `INSERT INTO mention_results
     (id, run_id, question, source, mentioned, excerpt, answer, error)
     VALUES (@id, @run_id, @question, @source, @mentioned, @excerpt, @answer, @error)`,
  );
  const results: MentionResult[] = input.results.map((row) => {
    const mapped: MentionResult = {
      id: randomUUID(),
      run_id: id,
      question: row.question,
      source: row.source,
      mentioned: row.mentioned,
      excerpt: row.excerpt,
      answer: row.answer,
      error: row.error,
    };
    insert.run({
      ...mapped,
      mentioned: mapped.mentioned ? 1 : 0,
    });
    return mapped;
  });
  return {
    id,
    created_at,
    model: input.model,
    hit_count,
    miss_count,
    error_count,
    results,
  };
}

function mapPaidOrderStatus(value: string): PaidOrderStatus {
  if (
    value === "accepted" ||
    value === "published" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "pending";
}

export function listPaidOrders(
  workspaceId: string,
  limit?: number,
  offset = 0,
): PaidOrder[] {
  const capped =
    typeof limit === "number" && limit > 0
      ? Math.min(500, Math.floor(limit))
      : null;
  const off = Math.max(0, Math.floor(offset) || 0);
  const orders = (
    capped != null
      ? getDb()
          .prepare(
            `SELECT * FROM paid_orders
             WHERE workspace_id = ?
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
          )
          .all(workspaceId, capped, off)
      : getDb()
          .prepare(
            `SELECT * FROM paid_orders
             WHERE workspace_id = ?
             ORDER BY created_at DESC`,
          )
          .all(workspaceId)
  ) as Array<{
    id: string;
    workspace_id: string;
    article_id: string;
    article_title: string;
    status: string;
    total_yuan: number;
    note: string;
    created_at: string;
    updated_at: string;
  }>;
  if (!orders.length) return [];
  const ids = orders.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const items = getDb()
    .prepare(
      `SELECT * FROM paid_order_items WHERE order_id IN (${placeholders})`,
    )
    .all(...ids) as Array<{
    id: string;
    order_id: string;
    sku_id: string;
    sku_name: string;
    price_yuan: number;
    status: string;
    result_url: string | null;
  }>;
  const byOrder = new Map<string, PaidOrderItem[]>();
  for (const row of items) {
    const list = byOrder.get(row.order_id) ?? [];
    list.push({
      id: row.id,
      order_id: row.order_id,
      sku_id: row.sku_id,
      sku_name: row.sku_name,
      price_yuan: row.price_yuan,
      status: mapPaidOrderStatus(row.status),
      result_url: row.result_url,
    });
    byOrder.set(row.order_id, list);
  }
  return orders.map((row) => ({
    id: row.id,
    workspace_id: row.workspace_id,
    article_id: row.article_id,
    article_title: row.article_title,
    status: mapPaidOrderStatus(row.status),
    total_yuan: row.total_yuan,
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    items: byOrder.get(row.id) ?? [],
  }));
}

export function createPaidOrder(input: {
  workspaceId: string;
  articleId: string;
  articleTitle: string;
  skuIds: string[];
  note?: string;
}): PaidOrder {
  const skus = input.skuIds
    .map((id) => getPaidMediaSku(id))
    .filter((sku): sku is NonNullable<typeof sku> => Boolean(sku));
  if (!skus.length) {
    throw new Error("请选择要代发的媒体");
  }
  const now = new Date().toISOString();
  const orderId = randomUUID();
  const items: PaidOrderItem[] = skus.map((sku) => ({
    id: randomUUID(),
    order_id: orderId,
    sku_id: sku.id,
    sku_name: sku.name,
    price_yuan: sku.priceYuan,
    status: "pending",
    result_url: null,
  }));
  const total = items.reduce((sum, item) => sum + item.price_yuan, 0);
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO paid_orders
       (id, workspace_id, article_id, article_title, status, total_yuan, note, created_at, updated_at)
       VALUES (@id, @workspace_id, @article_id, @article_title, 'pending', @total_yuan, @note, @created_at, @updated_at)`,
    ).run({
      id: orderId,
      workspace_id: input.workspaceId,
      article_id: input.articleId,
      article_title: input.articleTitle,
      total_yuan: total,
      note: input.note?.trim() || "",
      created_at: now,
      updated_at: now,
    });
    const insertItem = db.prepare(
      `INSERT INTO paid_order_items
       (id, order_id, sku_id, sku_name, price_yuan, status, result_url)
       VALUES (@id, @order_id, @sku_id, @sku_name, @price_yuan, 'pending', NULL)`,
    );
    for (const item of items) {
      insertItem.run({
        id: item.id,
        order_id: item.order_id,
        sku_id: item.sku_id,
        sku_name: item.sku_name,
        price_yuan: item.price_yuan,
      });
    }
  });
  tx();
  return {
    id: orderId,
    workspace_id: input.workspaceId,
    article_id: input.articleId,
    article_title: input.articleTitle,
    status: "pending",
    total_yuan: total,
    note: input.note?.trim() || "",
    created_at: now,
    updated_at: now,
    items,
  };
}

function mapPaidAdOrderStatus(value: string): PaidAdOrderStatus {
  if (
    value === "accepted" ||
    value === "published" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "pending";
}

export function listPaidAdOrders(
  workspaceId: string,
  limit?: number,
  offset = 0,
): PaidAdOrder[] {
  const capped =
    typeof limit === "number" && limit > 0
      ? Math.min(500, Math.floor(limit))
      : null;
  const off = Math.max(0, Math.floor(offset) || 0);
  const orders = (
    capped != null
      ? getDb()
          .prepare(
            `SELECT * FROM ads_orders
             WHERE workspace_id = ?
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
          )
          .all(workspaceId, capped, off)
      : getDb()
          .prepare(
            `SELECT * FROM ads_orders
             WHERE workspace_id = ?
             ORDER BY created_at DESC`,
          )
          .all(workspaceId)
  ) as Array<{
    id: string;
    workspace_id: string;
    article_id: string;
    article_title: string;
    landing_url: string;
    status: string;
    total_yuan: number;
    note: string;
    created_at: string;
    updated_at: string;
  }>;
  if (!orders.length) return [];
  const ids = orders.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const items = getDb()
    .prepare(
      `SELECT * FROM ads_order_items WHERE order_id IN (${placeholders})`,
    )
    .all(...ids) as Array<{
    id: string;
    order_id: string;
    sku_id: string;
    sku_name: string;
    price_yuan: number;
    status: string;
  }>;
  const byOrder = new Map<string, PaidAdOrderItem[]>();
  for (const row of items) {
    const list = byOrder.get(row.order_id) ?? [];
    list.push({
      id: row.id,
      order_id: row.order_id,
      sku_id: row.sku_id,
      sku_name: row.sku_name,
      price_yuan: row.price_yuan,
      status: mapPaidAdOrderStatus(row.status),
    });
    byOrder.set(row.order_id, list);
  }
  return orders.map((row) => ({
    id: row.id,
    workspace_id: row.workspace_id,
    article_id: row.article_id,
    article_title: row.article_title,
    landing_url: row.landing_url,
    status: mapPaidAdOrderStatus(row.status),
    total_yuan: row.total_yuan,
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    items: byOrder.get(row.id) ?? [],
  }));
}

export function createPaidAdOrder(input: {
  workspaceId: string;
  articleId?: string;
  articleTitle?: string;
  landingUrl?: string;
  skuIds: string[];
  note?: string;
}): PaidAdOrder {
  const skus = input.skuIds
    .map((id) => getPaidAdSku(id))
    .filter((sku): sku is NonNullable<typeof sku> => Boolean(sku));
  if (!skus.length) {
    throw new Error("请选择要投放的平台");
  }
  const now = new Date().toISOString();
  const orderId = randomUUID();
  const items: PaidAdOrderItem[] = skus.map((sku) => ({
    id: randomUUID(),
    order_id: orderId,
    sku_id: sku.id,
    sku_name: sku.name,
    price_yuan: sku.serviceYuan,
    status: "pending",
  }));
  const total = items.reduce((sum, item) => sum + item.price_yuan, 0);
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO ads_orders
       (id, workspace_id, article_id, article_title, landing_url, status, total_yuan, note, created_at, updated_at)
       VALUES (@id, @workspace_id, @article_id, @article_title, @landing_url, 'pending', @total_yuan, @note, @created_at, @updated_at)`,
    ).run({
      id: orderId,
      workspace_id: input.workspaceId,
      article_id: input.articleId || "",
      article_title: input.articleTitle || "",
      landing_url: input.landingUrl?.trim() || "",
      total_yuan: total,
      note: input.note?.trim() || "",
      created_at: now,
      updated_at: now,
    });
    const insertItem = db.prepare(
      `INSERT INTO ads_order_items
       (id, order_id, sku_id, sku_name, price_yuan, status)
       VALUES (@id, @order_id, @sku_id, @sku_name, @price_yuan, 'pending')`,
    );
    for (const item of items) {
      insertItem.run({
        id: item.id,
        order_id: item.order_id,
        sku_id: item.sku_id,
        sku_name: item.sku_name,
        price_yuan: item.price_yuan,
      });
    }
  });
  tx();
  return {
    id: orderId,
    workspace_id: input.workspaceId,
    article_id: input.articleId || "",
    article_title: input.articleTitle || "",
    landing_url: input.landingUrl?.trim() || "",
    status: "pending",
    total_yuan: total,
    note: input.note?.trim() || "",
    created_at: now,
    updated_at: now,
    items,
  };
}

export function listAiModels(query: ListAiModelsQuery = {}) {
  return listCatalogModels(getDb(), query);
}

export function getAiModel(id: string) {
  return getCatalogModelById(getDb(), id);
}

export function createAiModel(input: AiModelInput) {
  return createCatalogModel(getDb(), input);
}

export function updateAiModel(id: string, patch: Partial<AiModelInput>) {
  return updateCatalogModel(getDb(), id, patch);
}

export function deleteAiModel(id: string) {
  return removeCatalogModel(getDb(), id);
}

export function ensureAiModelCatalogSeed() {
  seedAiModelCatalog(getDb());
}

export async function syncProxyAiModels() {
  return syncProxyModelsIntoCatalog(getDb());
}

export async function syncQwenAiModels() {
  return syncQwenModelsIntoCatalog(getDb());
}

export async function syncArkAiModels() {
  return syncArkModelsIntoCatalog(getDb());
}

export async function syncCloudflareAiModels() {
  return syncCloudflareModelsIntoCatalog(getDb());
}

export function syncOfficialAiModelPricing() {
  return syncOfficialPricingIntoCatalog(getDb());
}
