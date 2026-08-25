import sqlWasm from "./sql-wasm.wasm";
import openNext from "../.open-next/worker.js";

export {
  DOQueueHandler,
  DOShardedTagCache,
  BucketCachePurge,
} from "../.open-next/worker.js";

const DB_KEY = "dianwu-geo/content.db";

async function loadGeoDbFromR2(env) {
  const bucket = env.GEO_DATA;
  if (!bucket) throw new Error("缺少 GEO_DATA");
  const dbObj = await bucket.get(DB_KEY);
  const mod = await import("./sql-wasm-browser.js");
  const initSqlJs =
    typeof mod.default === "function"
      ? mod.default
      : typeof mod.default?.default === "function"
        ? mod.default.default
        : mod.initSqlJs;
  if (typeof initSqlJs !== "function") {
    throw new Error("sql.js 导出不对: " + Object.keys(mod).join(","));
  }
  const SQL = await initSqlJs({
    instantiateWasm(info, receiveInstance) {
      const done = (instance) => {
        receiveInstance(instance, sqlWasm);
      };
      const result = WebAssembly.instantiate(sqlWasm, info);
      if (result && typeof result.then === "function") {
        result.then(done);
        return {};
      }
      done(result);
      return result.exports;
    },
  });
  const prev = globalThis.__GEO_SQL_RAW__;
  const raw = dbObj
    ? new SQL.Database(new Uint8Array(await dbObj.arrayBuffer()))
    : new SQL.Database();
  globalThis.__GEO_SQL_RAW__ = raw;
  globalThis.__GEO_SQL_BUCKET__ = bucket;
  globalThis.__GEO_SQL_DIRTY__ = false;
  if (prev && prev !== raw) {
    try {
      prev.close();
    } catch {
      /* ignore */
    }
  }
}

async function bootGeoDb(env, { fresh = false } = {}) {
  if (globalThis.__GEO_SQL_PERSISTING__) {
    await globalThis.__GEO_SQL_PERSISTING__.catch(() => undefined);
  }
  // 未落 R2 的写入不能被旧快照盖掉（流式生镜下一枪 POST 会 fresh reload）
  if (globalThis.__GEO_SQL_RAW__ && globalThis.__GEO_SQL_DIRTY__) return;
  if (globalThis.__GEO_SQL_RAW__ && !fresh) return;
  await loadGeoDbFromR2(env);
}

function persistDb() {
  const raw = globalThis.__GEO_SQL_RAW__;
  const bucket = globalThis.__GEO_SQL_BUCKET__;
  if (!raw || !bucket) return Promise.resolve();
  if (!globalThis.__GEO_SQL_DIRTY__) return Promise.resolve();
  return bucket.put(DB_KEY, raw.export()).then(() => {
    globalThis.__GEO_SQL_DIRTY__ = false;
  });
}

function persistAlways() {
  const raw = globalThis.__GEO_SQL_RAW__;
  const bucket = globalThis.__GEO_SQL_BUCKET__;
  if (!raw || !bucket) return Promise.resolve();
  // Next 里 persistCloudflareDb 已经落过盘时不要再整包覆盖，避免并发把刚写入的信息图盖掉
  if (!globalThis.__GEO_SQL_DIRTY__) return Promise.resolve();
  const prev = globalThis.__GEO_SQL_PERSISTING__;
  const pending = Promise.resolve(prev)
    .catch(() => undefined)
    .then(() => bucket.put(DB_KEY, raw.export()))
    .then(() => {
      globalThis.__GEO_SQL_DIRTY__ = false;
    })
    .finally(() => {
      if (globalThis.__GEO_SQL_PERSISTING__ === pending) {
        globalThis.__GEO_SQL_PERSISTING__ = undefined;
      }
    });
  globalThis.__GEO_SQL_PERSISTING__ = pending;
  return pending;
}

function wantsFreshSnapshot(method, pathname) {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) return true;
  // 生镜重试立刻 GET 本集分镜，必须读到刚写入的头尾，不能用 isolate 旧内存
  if (method === "GET" && /^\/api\/articles\/[^/]+\/video-script$/.test(pathname)) {
    return true;
  }
  if (method === "GET" && /^\/api\/ai\/infographic$/.test(pathname)) {
    return true;
  }
  return false;
}

/** Next 带 hash 的静态资源：浏览器 + 边缘长缓存（等同 Cache Rules 效果）。 */
function withStaticAssetCache(request, res) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/_next/static/")) return res;
  if (res.status !== 200 && res.status !== 206) return res;
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.delete("cdn-cache-control");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    // API 域名只给接口用；打开根路径回产品站首页
    if (
      (host === "api.dianwu.ai" || host === "www.api.dianwu.ai") &&
      (url.pathname === "/" || url.pathname === "")
    ) {
      return Response.redirect("https://dianwu.tech/", 302);
    }
    if (url.pathname === "/__ok" || url.pathname === "/__geo_ok") {
      return new Response("ok-geo", { status: 200 });
    }
    const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(
      request.method,
    );
    try {
      await bootGeoDb(env, {
        fresh: wantsFreshSnapshot(request.method, url.pathname),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (url.pathname === "/__db") {
        return new Response(JSON.stringify({ ready: false, error: message }), {
          status: 500,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
      console.error("[geo-db]", message);
    }
    if (url.pathname === "/__db") {
      const raw = globalThis.__GEO_SQL_RAW__;
      if (!raw) {
        return Response.json({ ready: false, error: "db not booted" }, { status: 500 });
      }
      const count = (sql) => {
        const stmt = raw.prepare(sql);
        try {
          stmt.step();
          return Number(stmt.getAsObject().c || 0);
        } finally {
          stmt.free();
        }
      };
      return Response.json({
        ready: true,
        articles: count("SELECT COUNT(*) AS c FROM articles"),
        users: count("SELECT COUNT(*) AS c FROM workspace_users"),
        keywords: count("SELECT COUNT(*) AS c FROM geo_keywords"),
        corpus: count("SELECT COUNT(*) AS c FROM corpus_items"),
        characters: count("SELECT COUNT(*) AS c FROM studio_characters"),
      });
    }
    const res = await openNext.fetch(request, env, ctx);
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const streaming =
      contentType.includes("ndjson") || contentType.includes("event-stream");
    // Streaming handlers write SQLite *after* fetch() returns. Snapshotting
    // here would persist the old DB and clobber later inserts on refresh.
    if (mutating && streaming && res.body && ctx?.waitUntil) {
      const { readable, writable } = new TransformStream();
      ctx.waitUntil(
        res.body
          .pipeTo(writable)
          .catch((err) => {
            console.error("[geo-db] stream", err);
          })
          .then(() => persistAlways()),
      );
      return withStaticAssetCache(
        request,
        new Response(readable, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        }),
      );
    }
    // Wait for R2 before the client can refresh, or a new isolate loads the old snapshot.
    if (mutating) {
      try {
        await persistAlways();
      } catch (err) {
        console.error("[geo-db] persist", err);
      }
    } else if (ctx?.waitUntil) {
      ctx.waitUntil(persistDb());
    }
    return withStaticAssetCache(request, res);
  },
};
