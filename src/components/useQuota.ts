"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import type { QuotaKind, QuotaSnap, WorkspacePlanView } from "@/lib/billing/types";
import { quotaRechargeText } from "@/lib/billing/copy";

export function isQuotaMessage(text: string): boolean {
  return /额度用完|没额度|免费方案不出片|去费用页|额度不够|请充值|不足|配额/.test(
    text,
  );
}

export function parseQuotaError(
  res: Response,
  data: { error?: string; code?: string; kind?: string },
): string | null {
  if (res.status === 402 || data.code === "quota") {
    return quotaRechargeText();
  }
  if (typeof data.error === "string" && isQuotaMessage(data.error)) {
    return quotaRechargeText();
  }
  return null;
}

type QuotaApi = {
  view: WorkspacePlanView | null;
  loading: boolean;
  refresh: () => Promise<void>;
  snap: (kind: QuotaKind) => QuotaSnap | undefined;
  remaining: (kind: QuotaKind) => number | "unlimited" | undefined;
  can: (kind: QuotaKind, amount?: number) => boolean;
};

const QuotaContext = createContext<QuotaApi | null>(null);

function useQuotaState(): QuotaApi {
  const pathname = usePathname();
  const publicPath =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/verify";
  const [view, setView] = useState<WorkspacePlanView | null>(null);
  const [loading, setLoading] = useState(!publicPath);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/me", { cache: "no-store" });
      const data = (await res.json()) as { billing?: WorkspacePlanView };
      if (data.billing) setView(data.billing);
    } catch {
      // 生成页没有额度提示也不要挡住操作
    }
  }, []);

  useEffect(() => {
    if (publicPath) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void refresh().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [publicPath, refresh]);

  const snap = useCallback(
    (kind: QuotaKind): QuotaSnap | undefined =>
      view?.quotas.find((item) => item.kind === kind),
    [view],
  );

  const remaining = useCallback(
    (kind: QuotaKind): number | "unlimited" | undefined => snap(kind)?.remaining,
    [snap],
  );

  const can = useCallback(
    (kind: QuotaKind, amount = 1) => {
      const left = remaining(kind);
      if (left == null) return true;
      return left === "unlimited" || left >= amount;
    },
    [remaining],
  );

  return useMemo(
    () => ({ view, loading, refresh, snap, remaining, can }),
    [view, loading, refresh, snap, remaining, can],
  );
}

export function QuotaProvider({ children }: { children: ReactNode }) {
  const value = useQuotaState();
  return createElement(QuotaContext.Provider, { value }, children);
}

export function useQuota(): QuotaApi {
  const ctx = useContext(QuotaContext);
  if (!ctx) {
    throw new Error("useQuota 需要包在 QuotaProvider 里");
  }
  return ctx;
}
