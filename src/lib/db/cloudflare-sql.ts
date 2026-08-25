import type { Database as SqlJsDatabase } from "sql.js";
import { mergeInfographicHtml } from "@/lib/ai/infographic-insert";

const DB_OBJECT_KEY = "dianwu-geo/content.db";

type Engine = {
  exec(sql: string): void;
  pragma(_stmt: string): void;
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
    run(...args: unknown[]): { changes: number; lastInsertRowid: number };
  };
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
};

type R2Like = {
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    httpEtag?: string;
    etag?: string;
  } | null>;
  head?(key: string): Promise<{ httpEtag?: string; etag?: string } | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { onlyIf?: { etagMatches?: string } },
  ): Promise<unknown>;
};

declare global {
  // eslint-disable-next-line no-var
  var __GEO_SQL_RAW__: import("sql.js").Database | undefined;
  // eslint-disable-next-line no-var
  var __GEO_SQL_BUCKET__: R2Like | undefined;
  // eslint-disable-next-line no-var
  var __GEO_SQL_DIRTY__: boolean | undefined;
  // eslint-disable-next-line no-var
  var __GEO_SQL_PERSISTING__: Promise<void> | undefined;
}

function adoptGlobalDb() {
  const fromGlobal = globalThis.__GEO_SQL_RAW__;
  // Always follow Worker refresh: a stale local `raw` after R2 reload would
  // write into an orphan DB while persist exports the fresh global snapshot.
  if (fromGlobal && fromGlobal !== raw) {
    raw = fromGlobal;
  }
  persistBucket = globalThis.__GEO_SQL_BUCKET__ ?? persistBucket;
}

let raw: SqlJsDatabase | null = null;
let dirty = false;
let persistBucket: R2Like | null = null;
const txDepth = new WeakMap<SqlJsDatabase, number>();

function markDirty() {
  dirty = true;
  globalThis.__GEO_SQL_DIRTY__ = true;
}

function bindArgs(sql: string, args: unknown[]): { sql: string; values: unknown[] } {
  if (
    args.length === 1 &&
    args[0] &&
    typeof args[0] === "object" &&
    !Array.isArray(args[0]) &&
    !(args[0] instanceof Uint8Array)
  ) {
    const obj = args[0] as Record<string, unknown>;
    const values: unknown[] = [];
    const next = sql.replace(/@(\w+)/g, (_, name: string) => {
      values.push(obj[name]);
      return "?";
    });
    return { sql: next, values };
  }
  return { sql, values: args };
}

function wrapDb(database: SqlJsDatabase): Engine {
  return {
    exec(sql: string) {
      database.exec(sql);
      if (/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE)/i.test(sql)) {
        markDirty();
      }
    },
    pragma() {
      /* sql.js: WAL/foreign_keys handled in migrate */
    },
    prepare(sql: string) {
      return {
        get(...args: unknown[]) {
          const { sql: q, values } = bindArgs(sql, args);
          const stmt = database.prepare(q);
          try {
            if (values.length) stmt.bind(values);
            if (!stmt.step()) return undefined;
            const row = stmt.getAsObject();
            return row;
          } finally {
            stmt.free();
          }
        },
        all(...args: unknown[]) {
          const { sql: q, values } = bindArgs(sql, args);
          const stmt = database.prepare(q);
          const rows: unknown[] = [];
          try {
            if (values.length) stmt.bind(values);
            while (stmt.step()) rows.push(stmt.getAsObject());
            return rows;
          } finally {
            stmt.free();
          }
        },
        run(...args: unknown[]) {
          const { sql: q, values } = bindArgs(sql, args);
          const stmt = database.prepare(q);
          try {
            if (values.length) stmt.bind(values);
            stmt.step();
          } finally {
            stmt.free();
          }
          markDirty();
          const idStmt = database.prepare("SELECT last_insert_rowid() AS id");
          let lastInsertRowid = 0;
          try {
            if (idStmt.step()) {
              lastInsertRowid = Number(idStmt.getAsObject().id || 0);
            }
          } finally {
            idStmt.free();
          }
          return { changes: database.getRowsModified(), lastInsertRowid };
        },
      };
    },
    transaction<T extends (...args: never[]) => unknown>(fn: T): T {
      const wrapped = ((...args: never[]) => {
        const depth = txDepth.get(database) ?? 0;
        const savepoint = `sp_${depth}`;
        if (depth === 0) database.exec("BEGIN");
        else database.exec(`SAVEPOINT ${savepoint}`);
        txDepth.set(database, depth + 1);
        try {
          const result = fn(...args);
          if (depth === 0) database.exec("COMMIT");
          else database.exec(`RELEASE ${savepoint}`);
          txDepth.set(database, depth);
          markDirty();
          return result;
        } catch (err) {
          try {
            if (depth === 0) database.exec("ROLLBACK");
            else {
              database.exec(`ROLLBACK TO ${savepoint}`);
              database.exec(`RELEASE ${savepoint}`);
            }
          } catch {
            /* already aborted */
          }
          txDepth.set(database, depth);
          throw err;
        }
      }) as T;
      return wrapped;
    },
  };
}

function sqlAll(
  database: SqlJsDatabase,
  sql: string,
  values: unknown[] = [],
): Record<string, unknown>[] {
  const stmt = database.prepare(sql);
  const rows: Record<string, unknown>[] = [];
  try {
    if (values.length) stmt.bind(values);
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function sqlRun(database: SqlJsDatabase, sql: string, values: unknown[] = []) {
  const stmt = database.prepare(sql);
  try {
    if (values.length) stmt.bind(values);
    stmt.step();
  } finally {
    stmt.free();
  }
}

function tableExists(database: SqlJsDatabase, name: string): boolean {
  return (
    sqlAll(
      database,
      "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?",
      [name],
    ).length > 0
  );
}

function objectEtag(obj: { httpEtag?: string; etag?: string } | null | undefined) {
  return obj?.httpEtag || obj?.etag || "";
}

/** Pull infographic rows/body URLs from a newer R2 snapshot so last-write cannot drop them. */
function mergeRemoteInfographics(local: SqlJsDatabase, remoteBytes: Uint8Array) {
  const Ctor = local.constructor as {
    new (data?: ArrayLike<number>): SqlJsDatabase;
  };
  let remote: SqlJsDatabase | null = null;
  try {
    remote = new Ctor(remoteBytes);
    if (
      !tableExists(remote, "article_infographics") ||
      !tableExists(local, "article_infographics")
    ) {
      return;
    }
    const remoteRows = sqlAll(remote, "SELECT * FROM article_infographics");
    const localRows = sqlAll(
      local,
      "SELECT id, article_id, family, url FROM article_infographics",
    );
    const localIds = new Set(localRows.map((row) => String(row.id || "")));
    const localUrls = new Set(
      localRows.map(
        (row) =>
          `${row.article_id}|${row.family}|${String(row.url || "").replace(/&amp;/gi, "&").trim()}`,
      ),
    );
    for (const row of remoteRows) {
      const url = String(row.url || "")
        .replace(/&amp;/gi, "&")
        .trim();
      const key = `${row.article_id}|${row.family}|${url}`;
      if (localIds.has(String(row.id || "")) || localUrls.has(key)) continue;
      sqlRun(
        local,
        `INSERT INTO article_infographics
         (id, article_id, family, url, headline, kind, card_json, anchor_text, insert_hint, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.article_id,
          row.family,
          row.url,
          row.headline ?? "",
          row.kind ?? "points",
          row.card_json ?? "{}",
          row.anchor_text ?? "",
          row.insert_hint ?? "",
          row.created_at ?? new Date().toISOString(),
        ],
      );
      markDirty();
    }
    if (!tableExists(remote, "articles") || !tableExists(local, "articles")) {
      return;
    }
    const remoteArticles = sqlAll(remote, "SELECT id, body FROM articles");
    for (const article of remoteArticles) {
      const id = String(article.id || "");
      const remoteBody = String(article.body || "");
      if (!id || !remoteBody) continue;
      const localArticle = sqlAll(local, "SELECT body FROM articles WHERE id=?", [
        id,
      ])[0];
      if (!localArticle) continue;
      const localBody = String(localArticle.body || "");
      const merged = mergeInfographicHtml(localBody, remoteBody);
      if (merged !== localBody) {
        sqlRun(local, "UPDATE articles SET body=? WHERE id=?", [merged, id]);
        markDirty();
      }
    }
  } catch {
    // Keep the local snapshot if the remote file cannot be merged.
  } finally {
    try {
      remote?.close();
    } catch {
      /* ignore */
    }
  }
}

export async function persistCloudflareDb() {
  adoptGlobalDb();
  persistBucket = globalThis.__GEO_SQL_BUCKET__ ?? persistBucket;
  const database = raw ?? globalThis.__GEO_SQL_RAW__;
  const bucket = persistBucket;
  if (!database || !bucket) return;
  if (!dirty && !globalThis.__GEO_SQL_DIRTY__) return;
  const prev = globalThis.__GEO_SQL_PERSISTING__;
  const run = async () => {
    if (prev) await prev.catch(() => undefined);
    adoptGlobalDb();
    const nextDb = raw ?? globalThis.__GEO_SQL_RAW__;
    const nextBucket = persistBucket ?? globalThis.__GEO_SQL_BUCKET__;
    if (!nextDb || !nextBucket) return;
    if (!dirty && !globalThis.__GEO_SQL_DIRTY__) return;
    let etag = "";
    try {
      const meta = nextBucket.head
        ? await nextBucket.head(DB_OBJECT_KEY)
        : await nextBucket.get(DB_OBJECT_KEY);
      etag = objectEtag(meta);
    } catch {
      etag = "";
    }
    const putOnce = async (match: string) => {
      const payload = nextDb.export();
      if (!match) {
        await nextBucket.put(DB_OBJECT_KEY, payload);
        return true;
      }
      try {
        const written = await nextBucket.put(DB_OBJECT_KEY, payload, {
          onlyIf: { etagMatches: match },
        });
        return written != null;
      } catch {
        return false;
      }
    };
    let wrote = await putOnce(etag);
    if (!wrote) {
      const latest = await nextBucket.get(DB_OBJECT_KEY);
      if (latest) {
        mergeRemoteInfographics(
          nextDb,
          new Uint8Array(await latest.arrayBuffer()),
        );
        wrote = await putOnce(objectEtag(latest));
      }
      if (!wrote) {
        await nextBucket.put(DB_OBJECT_KEY, nextDb.export());
      }
    }
    dirty = false;
    globalThis.__GEO_SQL_DIRTY__ = false;
  };
  const pending = run().finally(() => {
    if (globalThis.__GEO_SQL_PERSISTING__ === pending) {
      globalThis.__GEO_SQL_PERSISTING__ = undefined;
    }
  });
  globalThis.__GEO_SQL_PERSISTING__ = pending;
  await pending;
}

export function getCloudflareDb(): Engine {
  adoptGlobalDb();
  if (!raw) {
    throw new Error("Cloudflare DB 还没就绪");
  }
  return wrapDb(raw);
}
