"use client";

import { useEffect } from "react";

const CLEANUP_KEY = "dwgeo-sw-cleanup-v1";

/** Remove legacy dianwu.tech service workers that break Next.js chunk loading. */
export function ServiceWorkerCleanup() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    void (async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (!regs.length) return;

      await Promise.all(regs.map((reg) => reg.unregister()));
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }

      if (!sessionStorage.getItem(CLEANUP_KEY)) {
        sessionStorage.setItem(CLEANUP_KEY, "1");
        window.location.reload();
      }
    })();
  }, []);

  return null;
}
