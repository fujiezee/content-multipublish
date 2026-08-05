import Database from "better-sqlite3";
import { DB_PATH, ensureDataDirs } from "@/lib/paths";
import {
  ALL_PLATFORM_IDS,
  type Article,
  type JobStatus,
  type PlatformId,
  type PlatformSession,
  type PublishJob,
  type SessionStatus,
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_article ON publish_jobs(article_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON publish_jobs(status);
  `);

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
     (id, article_id, platform, status, result_url, error, screenshot_path, created_at, updated_at)
     VALUES (@id, @article_id, @platform, @status, @result_url, @error, @screenshot_path, @created_at, @updated_at)`,
  );
  const tx = getDb().transaction((rows: PublishJob[]) => {
    for (const row of rows) stmt.run(row);
  });
  tx(jobs);
}

export function getJob(id: string): PublishJob | undefined {
  return getDb().prepare("SELECT * FROM publish_jobs WHERE id = ?").get(id) as
    | PublishJob
    | undefined;
}

export function listJobs(limit = 100): PublishJob[] {
  return getDb()
    .prepare("SELECT * FROM publish_jobs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as PublishJob[];
}

export function listJobsByArticle(articleId: string): PublishJob[] {
  return getDb()
    .prepare(
      "SELECT * FROM publish_jobs WHERE article_id = ? ORDER BY created_at DESC",
    )
    .all(articleId) as PublishJob[];
}

export function updateJob(
  id: string,
  patch: Partial<
    Pick<PublishJob, "status" | "result_url" | "error" | "screenshot_path">
  >,
) {
  const existing = getJob(id);
  if (!existing) return null;
  const next: PublishJob = {
    ...existing,
    ...patch,
    status: (patch.status ?? existing.status) as JobStatus,
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE publish_jobs
       SET status = @status, result_url = @result_url, error = @error,
           screenshot_path = @screenshot_path, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(next);
  return next;
}

export function listPendingJobs(): PublishJob[] {
  return getDb()
    .prepare(
      `SELECT * FROM publish_jobs
       WHERE status = 'pending'
       ORDER BY created_at ASC`,
    )
    .all() as PublishJob[];
}
