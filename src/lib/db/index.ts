import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { DB_PATH, ensureDataDirs } from "@/lib/paths";
import {
  ALL_PLATFORM_IDS,
  type Article,
  type CorpusItem,
  type GeoKeyword,
  type GeoKeywordArticle,
  type GeoKeywordArticleWithTitle,
  type GeoKeywordMine,
  type JobStatus,
  type PlatformId,
  type PlatformSession,
  type PublishEngine,
  type PublishJob,
  type SessionStatus,
  normalizePublishEngine,
} from "@/lib/types";

let db: Database.Database | null = null;

function getDb() {
  if (db) return db;
  ensureDataDirs();
  db = new Database(DB_PATH);
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

    CREATE TABLE IF NOT EXISTS corpus_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      tags TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
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
  `);

  migrateGeoKeywordArticleLinks(database);
  migratePublishJobEngine(database);

  for (const platform of ALL_PLATFORM_IDS) {
    database
      .prepare(
        `INSERT OR IGNORE INTO platform_sessions (platform, storage_path, status)
         VALUES (?, ?, 'disconnected')`,
      )
      .run(platform, `data/sessions/${platform}.json`);
  }
}

export function listArticles(): Article[] {
  return getDb()
    .prepare("SELECT * FROM articles ORDER BY updated_at DESC")
    .all() as Article[];
}

export function getArticle(id: string): Article | undefined {
  return getDb().prepare("SELECT * FROM articles WHERE id = ?").get(id) as
    | Article
    | undefined;
}

export function createArticle(article: Article) {
  getDb()
    .prepare(
      `INSERT INTO articles (id, title, body, summary, cover_path, created_at, updated_at)
       VALUES (@id, @title, @body, @summary, @cover_path, @created_at, @updated_at)`,
    )
    .run(article);
}

export function updateArticle(
  id: string,
  patch: Partial<Pick<Article, "title" | "body" | "summary" | "cover_path">>,
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
  getDb()
    .prepare(
      `UPDATE articles
       SET title = @title, body = @body, summary = @summary,
           cover_path = @cover_path, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(next);
  return next;
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
       WHERE status = 'pending'
         AND (engine IS NULL OR engine = '' OR engine = 'playwright' OR engine = 'api')
       ORDER BY created_at ASC`,
    )
    .all() as PublishJob[];
  return rows.flatMap((row) => {
    const n = normalizeJob(row);
    return n ? [n] : [];
  });
}

export function listCorpusItems(): CorpusItem[] {
  return getDb()
    .prepare("SELECT * FROM corpus_items ORDER BY updated_at DESC")
    .all() as CorpusItem[];
}

export function getCorpusItem(id: string): CorpusItem | undefined {
  return getDb().prepare("SELECT * FROM corpus_items WHERE id = ?").get(id) as
    | CorpusItem
    | undefined;
}

export function createCorpusItem(item: CorpusItem) {
  getDb()
    .prepare(
      `INSERT INTO corpus_items (id, title, category, tags, content, created_at, updated_at)
       VALUES (@id, @title, @category, @tags, @content, @created_at, @updated_at)`,
    )
    .run(item);
}

export function updateCorpusItem(
  id: string,
  patch: Partial<Pick<CorpusItem, "title" | "category" | "tags" | "content">>,
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
           content = @content, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(next);
  return next;
}

export function deleteCorpusItem(id: string) {
  getDb().prepare("DELETE FROM corpus_items WHERE id = ?").run(id);
}

export function listGeoMines(limit = 50): GeoKeywordMine[] {
  return getDb()
    .prepare(
      `SELECT * FROM geo_keyword_mines ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(limit) as GeoKeywordMine[];
}

export function getGeoMine(id: string): GeoKeywordMine | undefined {
  return getDb()
    .prepare("SELECT * FROM geo_keyword_mines WHERE id = ?")
    .get(id) as GeoKeywordMine | undefined;
}

export function createGeoMine(mine: GeoKeywordMine) {
  getDb()
    .prepare(
      `INSERT INTO geo_keyword_mines (id, seed, context, created_at, updated_at)
       VALUES (@id, @seed, @context, @created_at, @updated_at)`,
    )
    .run(mine);
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

export function listAllGeoNormKeys(): string[] {
  return (
    getDb()
      .prepare("SELECT norm_key FROM geo_keywords")
      .all() as { norm_key: string }[]
  ).map((row) => row.norm_key);
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
