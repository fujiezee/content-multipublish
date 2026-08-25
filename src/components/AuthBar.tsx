"use client";

import Link from "next/link";
import { useAuth } from "@/components/useAuth";

export function AuthBar({
  compact = false,
  registerLabel = "注册",
}: {
  compact?: boolean;
  registerLabel?: string;
}) {
  const { user, ready, registered, logout } = useAuth();

  if (!ready) {
    return (
      <div className="auth-bar">
        <Link href="/login" className="nav-link">
          登录
        </Link>
        <Link href="/register" className="btn btn-primary auth-bar__btn">
          {registerLabel}
        </Link>
      </div>
    );
  }

  if (registered && user) {
    return (
      <div className="auth-bar">
        <span className="auth-bar__who" title={user.email}>
          {user.displayName}
        </span>
        {!compact ? (
          <Link href="/dashboard" className="nav-link">
            总览
          </Link>
        ) : null}
        <button type="button" className="btn btn-ghost auth-bar__btn" onClick={() => void logout()}>
          退出
        </button>
      </div>
    );
  }

  return (
    <div className="auth-bar">
      <Link href="/login" className="nav-link">
        登录
      </Link>
      <Link href="/register" className="btn btn-primary auth-bar__btn">
        {registerLabel}
      </Link>
    </div>
  );
}
