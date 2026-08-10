/**
 * Register extra platform adapters on top of the bundled Wechatsync / 点物GEO core.
 * Requires service-worker-loader.js to import assets/index.ts-ZvOctxVj.js first.
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

function registerAdapter(registry, AdapterClass) {
  const instance = new AdapterClass();
  registry.register({
    meta: instance.meta,
    factory: () => new AdapterClass(),
  });
}

function bootstrapExtraAdapters() {
  const api = globalThis.__DWGEO;
  if (!api?.registry || !api.BaseAdapter) {
    console.error(
      "[dianwu-geo] register-extra-adapters: __DWGEO bootstrap missing",
    );
    return;
  }

  const extras = [
    createSegmentfaultAdapter(api.BaseAdapter),
    createCnblogsAdapter(api.BaseAdapter),
    createCto51Adapter(api.BaseAdapter),
    createImoocAdapter(api.BaseAdapter),
    createOschinaAdapter(api.BaseAdapter),
    createEastmoneyAdapter(api.BaseAdapter),
    createJianshuAdapter(api.BaseAdapter),
    createNeteaseAdapter(api.BaseAdapter),
    createDayuAdapter(api.BaseAdapter),
    createSohufocusAdapter(api.BaseAdapter),
    createYidianAdapter(api.BaseAdapter),
  ];

  for (const AdapterClass of extras) {
    try {
      registerAdapter(api.registry, AdapterClass);
      console.info(
        "[dianwu-geo] registered extra adapter:",
        new AdapterClass().meta.id,
      );
    } catch (error) {
      console.error("[dianwu-geo] failed to register extra adapter:", error);
    }
  }
}

bootstrapExtraAdapters();
