import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { randomToken } from "@/lib/auth/password";
import { DB_PATH, ensureDataDirs } from "@/lib/paths";
import {
  ALL_PLATFORM_IDS,
  type Article,
  type ArticleInfographic,
  type ArticleVideoEpisode,
  type ArticleVideoCharacter,
  type ArticleVideoSeries,
  type VideoSpeakMode,
  normalizeSpeakMode,
  type CharacterCatalogItem,
  type CharacterSource,
  type StudioCharacter,
  type VideoCatalogItem,
  type ArticleVariant,
  type VideoEpisodeStatus,
  type VideoScriptGenre,
  type CorpusItem,
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
import type { PaidOrder, PaidOrderItem, PaidOrderStatus } from "@/lib/paid-media";
import { getPaidMediaSku } from "@/lib/paid-media";
import type { PaidAdOrder, PaidAdOrderItem, PaidAdOrderStatus } from "@/lib/paid-ads";
import { getPaidAdSku } from "@/lib/paid-ads";

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
  migrateArticleInfographics(database);
  migrateArticleScriptTitle(database);
  migrateArticleVideoScripts(database);
  migrateVideoSeriesCharacter(database);
  migrateVideoSeriesSpeak(database);
  migrateVideoSeriesHookStyle(database);
  migrateVideoSeriesCast(database);
  migrateArticleVideoCharacters(database);
  migrateStudioCharacters(database);
  migrateStudioCharacterVoice(database);
  migrateSeriesCharacterShare(database);
  migrateMentionTables(database);
  migratePaidPublish(database);
  migratePaidAds(database);
  migrateAgentDevices(database);
  for (const table of [
    "corpus_items",
    "geo_keyword_mines",
    "mention_runs",
    "mention_settings",
  ] as const) {
    ensureOwnedByWorkspace(database, table);
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

export function listJobsInWorkspace(workspaceId: string, limit = 100): PublishJob[] {
  const ids = new Set(listArticles(workspaceId).map((a) => a.id));
  return listJobs(limit).filter((job) => ids.has(job.article_id));
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

export function listCorpusItems(workspaceId?: string | null): CorpusItem[] {
  if (workspaceId) {
    return getDb()
      .prepare(
        `SELECT * FROM corpus_items
         WHERE workspace_id = ?
         ORDER BY updated_at DESC`,
      )
      .all(workspaceId) as CorpusItem[];
  }
  return getDb()
    .prepare("SELECT * FROM corpus_items ORDER BY updated_at DESC")
    .all() as CorpusItem[];
}

export function getCorpusItem(id: string): CorpusItem | undefined {
  return getDb().prepare("SELECT * FROM corpus_items WHERE id = ?").get(id) as
    | CorpusItem
    | undefined;
}

export function createCorpusItem(item: CorpusItem, workspaceId = "ws_local") {
  getDb()
    .prepare(
      `INSERT INTO corpus_items
       (id, title, category, tags, content, created_at, updated_at, workspace_id)
       VALUES (@id, @title, @category, @tags, @content, @created_at, @updated_at, @workspace_id)`,
    )
    .run({ ...item, workspace_id: workspaceId });
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

export function listGeoMines(
  limit = 50,
  workspaceId?: string | null,
): GeoKeywordMine[] {
  if (workspaceId) {
    return getDb()
      .prepare(
        `SELECT * FROM geo_keyword_mines
         WHERE workspace_id = ?
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(workspaceId, limit) as GeoKeywordMine[];
  }
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
  } catch (err) {
    console.warn("[db] migrate auth/workspace:", err);
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
  };
  getDb()
    .prepare(
      `INSERT INTO workspace_users
       (id, workspace_id, email, password_hash, display_name, created_at)
       VALUES (@id, @workspace_id, @email, @password_hash, @display_name, @created_at)`,
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
      }
    | undefined;
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

export function createExtensionTokenRow(input: {
  workspaceId: string;
  userId: string;
  label?: string;
}) {
  const row = {
    id: randomUUID(),
    workspace_id: input.workspaceId,
    user_id: input.userId,
    token: `dwext_${randomToken(24)}`,
    label: input.label?.trim() || "扩展绑定",
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
    getDb()
      .prepare(
        `UPDATE publish_jobs
         SET status = 'running', claimed_by = ?, claimed_at = ?, updated_at = ?, error = NULL
         WHERE id = ? AND status = 'pending'`,
      )
      .run(agentId, now, now, row.id);
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
    voice_id: typeof row.voice_id === "string" ? row.voice_id : "",
    hook_style:
      typeof row.hook_style === "string" && row.hook_style.trim()
        ? row.hook_style.trim()
        : row.genre === "drama"
          ? "drama"
          : "talk",
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
  audience: string;
  notes: string;
  character_id?: string | null;
  cast_json?: string;
  speak_mode?: VideoSpeakMode;
  voice_id?: string;
  hook_style?: string;
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
  }>;
}): { series: ArticleVideoSeries; episodes: ArticleVideoEpisode[] } {
  const now = new Date().toISOString();
  const database = getDb();
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
      audience: input.audience,
      notes: input.notes,
      episode_count: input.episodes.length,
      character_id: input.character_id?.trim() || parseCastIds(input.cast_json)[0] || null,
      cast_json: JSON.stringify(
        parseCastIds(input.cast_json, input.character_id),
      ),
      speak_mode: input.speak_mode === "dialogue" ? "dialogue" : "narration",
      voice_id: input.voice_id?.trim() || "",
      hook_style: input.hook_style?.trim() || (input.genre === "drama" ? "drama" : "talk"),
      created_at: now,
      updated_at: now,
    };
    database
      .prepare(
        `INSERT INTO article_video_series
         (id, article_id, genre, title, logline, audience, notes, episode_count, character_id, cast_json, speak_mode, voice_id, hook_style, created_at, updated_at)
         VALUES (@id, @article_id, @genre, @title, @logline, @audience, @notes, @episode_count, @character_id, @cast_json, @speak_mode, @voice_id, @hook_style, @created_at, @updated_at)`,
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
        confirmed: 0,
        video_status: "idle",
        video_url: null,
        video_error: null,
        video_model: null,
        created_at: now,
        updated_at: now,
      };
      database
        .prepare(
          `INSERT INTO article_video_episodes
           (id, series_id, episode_no, title, hook, voiceover, on_screen, recap, next_hook,
            duration_sec, shots_json, confirmed, video_status, video_url, video_error, video_model,
            created_at, updated_at)
           VALUES (@id, @series_id, @episode_no, @title, @hook, @voiceover, @on_screen, @recap, @next_hook,
            @duration_sec, @shots_json, @confirmed, @video_status, @video_url, @video_error, @video_model,
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
      | "audience"
      | "notes"
      | "character_id"
      | "cast_json"
      | "speak_mode"
      | "voice_id"
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
    voice_id:
      patch.voice_id !== undefined
        ? patch.voice_id.trim()
        : current.voice_id || "",
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE article_video_series
       SET title = @title, logline = @logline, audience = @audience, notes = @notes,
           character_id = @character_id, cast_json = @cast_json, speak_mode = @speak_mode,
           voice_id = @voice_id, updated_at = @updated_at
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
    4,
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
  return parseCastIds(series.cast_json, series.character_id)
    .map((id) => getStudioCharacter(id, workspaceId))
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
    confirmed: patch.confirmed ?? current.confirmed,
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE article_video_episodes
       SET title = @title, hook = @hook, voiceover = @voiceover, on_screen = @on_screen,
           recap = @recap, next_hook = @next_hook, duration_sec = @duration_sec,
           shots_json = @shots_json, confirmed = @confirmed, updated_at = @updated_at
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
    video_error: null,
    video_model: null,
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE article_video_episodes
       SET title = @title, hook = @hook, voiceover = @voiceover, on_screen = @on_screen,
           recap = @recap, next_hook = @next_hook, duration_sec = @duration_sec,
           shots_json = @shots_json, confirmed = 0, video_status = 'idle',
           video_url = NULL, video_error = NULL, video_model = NULL, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(next);
  return next;
}

export function setVideoEpisodeRender(
  episodeId: string,
  patch: {
    video_status: VideoEpisodeStatus;
    video_url?: string | null;
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
    video_error:
      patch.video_error !== undefined ? patch.video_error : current.video_error,
    video_model:
      patch.video_model !== undefined ? patch.video_model : current.video_model,
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE article_video_episodes
       SET video_status = @video_status, video_url = @video_url, video_error = @video_error,
           video_model = @video_model, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(next);
  return next;
}

export function listVideoCatalog(workspaceId: string): VideoCatalogItem[] {
  const rows = getDb()
    .prepare(
      `SELECT
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
       ORDER BY e.updated_at DESC, e.episode_no ASC`,
    )
    .all(workspaceId) as Array<{
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

export function listCharacterCatalog(
  workspaceId: string,
): CharacterCatalogItem[] {
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
  const rows = getDb()
    .prepare(
      `SELECT c.*, a.title AS article_title
       FROM studio_characters c
       LEFT JOIN articles a ON a.id = c.article_id
       WHERE c.workspace_id = ?
       ORDER BY c.updated_at DESC`,
    )
    .all(workspaceId) as Array<StudioCharacter & { article_title: string | null }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    source: row.source === "script" ? "script" : "photo",
    article_id: row.article_id,
    article_title: row.article_title || null,
    voice_id: typeof row.voice_id === "string" ? row.voice_id : "",
    scripts: scriptsByCharacter.get(row.id) || [],
    photos: (() => {
      try {
        const parsed = JSON.parse(row.photos_json) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed
          .map((item) => {
            if (typeof item === "string" && item.trim()) return { url: item.trim() };
            if (
              item &&
              typeof item === "object" &&
              typeof (item as { url?: string }).url === "string"
            ) {
              return { url: (item as { url: string }).url.trim() };
            }
            return null;
          })
          .filter((x): x is { url: string } => Boolean(x?.url));
      } catch {
        return [];
      }
    })(),
    angles: (() => {
      try {
        const parsed = JSON.parse(row.angles_json) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const o = item as Record<string, unknown>;
            if (typeof o.url !== "string" || !o.url.trim()) return null;
            return {
              id: typeof o.id === "string" ? o.id : "angle",
              label: typeof o.label === "string" ? o.label : "角度",
              url: o.url.trim(),
            };
          })
          .filter((x): x is { id: string; label: string; url: string } =>
            Boolean(x),
          );
      } catch {
        return [];
      }
    })(),
    updated_at: row.updated_at,
  }));
}

export function createStudioCharacter(input: {
  workspaceId: string;
  name?: string;
  photos_json?: string;
  angles_json?: string;
  source?: CharacterSource;
  articleId?: string | null;
  voice_id?: string;
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
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO studio_characters
       (id, workspace_id, name, photos_json, angles_json, source, article_id, voice_id, created_at, updated_at)
       VALUES (@id, @workspace_id, @name, @photos_json, @angles_json, @source, @article_id, @voice_id, @created_at, @updated_at)`,
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
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE studio_characters
       SET name = @name, photos_json = @photos_json, angles_json = @angles_json,
           source = @source, voice_id = @voice_id, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(next);
  return next;
}

const DEFAULT_MENTION_BRANDS = ["点物GEO", "点物", "dianwu.ai", "dianwu"];
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
): MentionRun[] {
  const runs = (
    workspaceId
      ? getDb()
          .prepare(
            `SELECT * FROM mention_runs
             WHERE workspace_id = ?
             ORDER BY created_at DESC LIMIT ?`,
          )
          .all(workspaceId, limit)
      : getDb()
          .prepare(
            `SELECT * FROM mention_runs ORDER BY created_at DESC LIMIT ?`,
          )
          .all(limit)
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
      `SELECT * FROM mention_results WHERE run_id IN (${placeholders})`,
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

export function listPaidOrders(workspaceId: string): PaidOrder[] {
  const orders = getDb()
    .prepare(
      `SELECT * FROM paid_orders
       WHERE workspace_id = ?
       ORDER BY created_at DESC`,
    )
    .all(workspaceId) as Array<{
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

export function listPaidAdOrders(workspaceId: string): PaidAdOrder[] {
  const orders = getDb()
    .prepare(
      `SELECT * FROM ads_orders
       WHERE workspace_id = ?
       ORDER BY created_at DESC`,
    )
    .all(workspaceId) as Array<{
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
