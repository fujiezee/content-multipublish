/**
 * Register extra platform adapters on top of the bundled Wechatsync / 点物GEO core.
 * Requires service-worker-loader.js to import assets/index.ts-ZvOctxVj.js first.
 *
 * Bundled core lazily calls Wu() → register(Tf) on first sync. That Map.set()
 * overwrites same ids (douban/zhihu/sohu/…). Extras must be re-applied on every
 * get() for override ids — not only on miss.
 */
import { createSegmentfaultAdapter } from "./adapters/segmentfault.js";
import { createCnblogsAdapter } from "./adapters/cnblogs.js";
import { createCto51Adapter } from "./adapters/cto51.js";
import { createImoocAdapter } from "./adapters/imooc.js";
import { createOschinaAdapter } from "./adapters/oschina.js";
import { createEastmoneyAdapter } from "./adapters/eastmoney.js";
import { createJianshuAdapter } from "./adapters/jianshu.js";
import { createNeteaseAdapter } from "./adapters/netease.js";
import { createDayuAdapter } from "./adapters/dayu.js";
import { createSohufocusAdapter } from "./adapters/sohufocus.js";
import { createYidianAdapter } from "./adapters/yidian.js";
import { createSohuAdapter } from "./adapters/sohu.js";
import { createDoubanAdapter } from "./adapters/douban.js";
import { createZhihuAdapter } from "./adapters/zhihu.js";
import { createSmzdmAdapter } from "./adapters/smzdm.js";
import { createXAdapter } from "./adapters/x.js";
import { createQiehaoAdapter } from "./adapters/qiehao.js";
import { createDafengAdapter } from "./adapters/dafeng.js";
import { createKuaichuanAdapter } from "./adapters/kuaichuan.js";
import { createSinakandianAdapter } from "./adapters/sinakandian.js";
import { createDongfangAdapter } from "./adapters/dongfang.js";
import { createBtimeAdapter } from "./adapters/btime.js";
import { createPeoplehaoAdapter } from "./adapters/peoplehao.js";
import { createXinhuahaoAdapter } from "./adapters/xinhuahao.js";
import { createZhongqingAdapter } from "./adapters/zhongqing.js";
import { createTencentcloudAdapter } from "./adapters/tencentcloud.js";
import { createAliyunAdapter } from "./adapters/aliyun.js";
import { createHuaweicloudAdapter } from "./adapters/huaweicloud.js";
import { createXiaohongshuAdapter } from "./adapters/xiaohongshu.js";

/** @type {Array<new () => { meta: { id: string } }>} */
let extraClasses = [];
/** @type {Map<string, new () => { meta: { id: string } }>} */
let extraById = new Map();
let getPatched = false;

function registerAdapter(registry, AdapterClass) {
  const instance = new AdapterClass();
  const id = instance.meta.id;
  registry.register({
    meta: instance.meta,
    factory: () => new AdapterClass(),
  });
  try {
    registry.instances?.delete?.(id);
  } catch {
    // ignore
  }
  return id;
}

async function clearAuthCacheFor(ids) {
  try {
    const data = await chrome.storage.local.get("authCache");
    const cache = data?.authCache || {};
    let changed = false;
    for (const id of ids) {
      if (cache[id]) {
        delete cache[id];
        changed = true;
      }
    }
    if (changed) await chrome.storage.local.set({ authCache: cache });
  } catch {
    // ignore
  }
}

function buildExtraClasses(BaseAdapter) {
  return [
    createSegmentfaultAdapter(BaseAdapter),
    createCnblogsAdapter(BaseAdapter),
    createCto51Adapter(BaseAdapter),
    createImoocAdapter(BaseAdapter),
    createOschinaAdapter(BaseAdapter),
    createEastmoneyAdapter(BaseAdapter),
    createJianshuAdapter(BaseAdapter),
    createNeteaseAdapter(BaseAdapter),
    createDayuAdapter(BaseAdapter),
    createSohufocusAdapter(BaseAdapter),
    createYidianAdapter(BaseAdapter),
    createSohuAdapter(BaseAdapter),
    createDoubanAdapter(BaseAdapter),
    createZhihuAdapter(BaseAdapter),
    createSmzdmAdapter(BaseAdapter),
    createXAdapter(BaseAdapter),
    createQiehaoAdapter(BaseAdapter),
    createDafengAdapter(BaseAdapter),
    createKuaichuanAdapter(BaseAdapter),
    createSinakandianAdapter(BaseAdapter),
    createDongfangAdapter(BaseAdapter),
    createBtimeAdapter(BaseAdapter),
    createPeoplehaoAdapter(BaseAdapter),
    createXinhuahaoAdapter(BaseAdapter),
    createZhongqingAdapter(BaseAdapter),
    createTencentcloudAdapter(BaseAdapter),
    createAliyunAdapter(BaseAdapter),
    createHuaweicloudAdapter(BaseAdapter),
    createXiaohongshuAdapter(BaseAdapter),
  ];
}

function ensureExtrasRegistered(registry) {
  if (!registry || !extraClasses.length) return [];
  const ids = [];
  for (const AdapterClass of extraClasses) {
    try {
      ids.push(registerAdapter(registry, AdapterClass));
    } catch (error) {
      console.error("[dianwu-geo] failed to register extra adapter:", error);
    }
  }
  return ids;
}

function ensureExtraForId(registry, id) {
  const AdapterClass = extraById.get(id);
  if (!AdapterClass || !registry) return false;
  try {
    registerAdapter(registry, AdapterClass);
    return true;
  } catch (error) {
    console.error("[dianwu-geo] failed to re-apply extra adapter:", id, error);
    return false;
  }
}

function patchRegistryGet(registry) {
  if (getPatched || !registry || typeof registry.get !== "function") return;
  getPatched = true;
  const originalGet = registry.get.bind(registry);
  registry.get = async function patchedGet(id) {
    // Wu() → register(Tf) overwrites same ids; always put extras back before use.
    if (extraById.has(id)) {
      ensureExtraForId(registry, id);
    } else if (typeof registry.has === "function" && !registry.has(id)) {
      ensureExtrasRegistered(registry);
    }
    return originalGet(id);
  };
}

function bootstrapExtraAdapters() {
  const api = globalThis.__DWGEO;
  if (!api?.registry || !api.BaseAdapter) {
    console.error(
      "[dianwu-geo] register-extra-adapters: __DWGEO bootstrap missing",
    );
    return false;
  }

  try {
    extraClasses = buildExtraClasses(api.BaseAdapter);
    extraById = new Map();
    for (const AdapterClass of extraClasses) {
      try {
        const id = new AdapterClass().meta.id;
        extraById.set(id, AdapterClass);
      } catch {
        // ignore broken class
      }
    }
  } catch (error) {
    console.error("[dianwu-geo] failed to build extra adapters:", error);
    return false;
  }

  const registeredIds = ensureExtrasRegistered(api.registry);
  patchRegistryGet(api.registry);
  clearAuthCacheFor(registeredIds);

  const hasHuawei =
    typeof api.registry.has === "function" &&
    api.registry.has("huaweicloud");
  const hasDouban = extraById.has("douban");
  console.info(
    "[dianwu-geo] extra adapters ready:",
    registeredIds.length,
    "huaweicloud=",
    hasHuawei,
    "doubanOverride=",
    hasDouban,
  );
  return hasHuawei && hasDouban;
}

const ok = bootstrapExtraAdapters();
if (!ok) {
  // Index module race (should not happen with static import order) — retry.
  setTimeout(() => bootstrapExtraAdapters(), 0);
  setTimeout(() => bootstrapExtraAdapters(), 500);
}

try {
  chrome.runtime.onStartup?.addListener?.(() => {
    bootstrapExtraAdapters();
  });
  chrome.runtime.onInstalled?.addListener?.(() => {
    bootstrapExtraAdapters();
  });
} catch {
  // ignore
}
