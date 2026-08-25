"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  workspaceId: string;
  isAdmin?: boolean;
};

type AuthContextValue = {
  user: AuthUser | null;
  ready: boolean;
  registered: boolean;
  refresh: () => Promise<void>;
  applyUser: (user: AuthUser | null) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function isRegisteredUser(user: AuthUser | null): boolean {
  return Boolean(user && user.id !== "local");
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  const applyUser = useCallback((next: AuthUser | null) => {
    setUser(next);
    setReady(true);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = (await res.json()) as { user?: AuthUser | null };
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    applyUser(null);
  }, [applyUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      ready,
      registered: isRegisteredUser(user),
      refresh,
      applyUser,
      logout,
    }),
    [user, ready, refresh, applyUser, logout],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth 需要包在 AuthProvider 里");
  }
  return ctx;
}
