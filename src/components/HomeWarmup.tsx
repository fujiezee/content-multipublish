"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { APP_NAV_GROUPS } from "@/lib/nav";
import { useAuth } from "@/components/useAuth";

const AUTH_ROUTES = ["/login", "/register", "/verify"];

function appRoutes(): string[] {
  return APP_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));
}

function allowWarmup(): boolean {
  const conn = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (conn?.saveData) return false;
  if (conn?.effectiveType === "slow-2g" || conn?.effectiveType === "2g") {
    return false;
  }
  return true;
}

function whenLoaded(): Promise<void> {
  if (document.readyState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener("load", () => resolve(), { once: true });
  });
}

function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => done(), { timeout: 2500 });
    } else {
      window.setTimeout(done, 400);
    }
  });
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitVisible(signal: AbortSignal) {
  if (document.visibilityState === "visible") return;
  await new Promise<void>((resolve) => {
    const onChange = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    document.addEventListener("visibilitychange", onChange);
    signal.addEventListener("abort", () => {
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    });
  });
}

function warmupModules(registered: boolean): Array<() => Promise<unknown>> {
  const writing = () => import("@/components/AiWritingPanel");
  const dashboard = () => import("@/components/DashboardPanel");
  const auth = () => import("@/components/AuthScreen");
  const rest = [
    () => import("@/components/PlanPanel"),
    () => import("@/components/ArticleList"),
    () => import("@/components/ArticleEditor"),
    () => import("@/components/CorpusPanel"),
    () => import("@/components/VideoCatalog"),
    () => import("@/components/JobsPanel"),
  ];
  if (registered) return [dashboard, writing, ...rest];
  return [auth, writing, dashboard, ...rest];
}

function warmupRoutes(registered: boolean): string[] {
  const product = appRoutes();
  if (registered) return product;
  return [...AUTH_ROUTES, "/writing", ...product];
}

/** 首页先出画面，空闲后再把工作台 JS / 路由逐个预热，和打开总览后的效果一样。 */
export function HomeWarmup() {
  const router = useRouter();
  const { ready, registered } = useAuth();

  useEffect(() => {
    if (!ready || !allowWarmup()) return;
    const ac = new AbortController();

    void (async () => {
      await whenLoaded();
      await whenIdle();
      if (ac.signal.aborted) return;

      for (const load of warmupModules(registered)) {
        await waitVisible(ac.signal);
        if (ac.signal.aborted) return;
        try {
          await load();
        } catch {
          /* 预热失败不影响首页 */
        }
        await wait(160);
      }

      for (const href of warmupRoutes(registered)) {
        await waitVisible(ac.signal);
        if (ac.signal.aborted) return;
        try {
          router.prefetch(href);
        } catch {
          /* ignore */
        }
        await wait(140);
      }
    })();

    return () => ac.abort();
  }, [ready, registered, router]);

  return null;
}
