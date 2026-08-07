/**
 * Register extra platform adapters on top of the bundled Wechatsync / 点物GEO core.
 * Requires service-worker-loader.js to import assets/index.ts-ZvOctxVj.js first.
 */
import { createSegmentfaultAdapter } from "./adapters/segmentfault.js";

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

  const extras = [createSegmentfaultAdapter(api.BaseAdapter)];

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
