"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/useAuth";

export function AuthBar({
  compact = false,
  registerLabel = "注册",
}: {
  compact?: boolean;
  registerLabel?: string;
}) {
  const { user, ready, registered, logout } = useAuth();
  const pathname = usePathname();

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
    const onAccount = pathname === "/account";
    const onAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
    return (
      <div className="auth-bar">
        {!compact ? (
          <Link href="/dashboard" className="nav-link">
            总览
          </Link>
        ) : null}
        {user.isAdmin ? (
          <Link
            href="/admin"
            className={onAdmin ? "nav-link nav-link--active" : "nav-link"}
          >
            后台
          </Link>
        ) : null}
        <Link
          href="/account"
          className={onAccount ? "auth-bar__who auth-bar__who--active" : "auth-bar__who"}
          title={user.email}
        >
          {user.displayName}
        </Link>
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
