"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { APP_NAV_GROUPS, MARKETING_NAV, navActive } from "@/lib/nav";
import { SITE_BRAND } from "@/lib/billing/plans";
import { AuthBar } from "@/components/AuthBar";
import { HomeWarmup } from "@/components/HomeWarmup";
import { NavIcon } from "@/components/NavIcon";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { AuthProvider, useAuth } from "@/components/useAuth";
import { QuotaProvider } from "@/components/useQuota";

function isAuthPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/verify"
  );
}

function isPublicPath(pathname: string) {
  return pathname === "/" || isAuthPath(pathname);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <QuotaProvider>
        <ConfirmProvider>
          <AppFrame>{children}</AppFrame>
        </ConfirmProvider>
      </QuotaProvider>
    </AuthProvider>
  );
}

function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { ready, registered } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.documentElement.classList.add("app-locked");
    return () => document.documentElement.classList.remove("app-locked");
  }, []);
  useEffect(() => {
    if (!ready) return;
    if (registered && isAuthPath(pathname)) {
      router.replace("/dashboard");
      return;
    }
    if (isPublicPath(pathname) || registered) return;
    const next = encodeURIComponent(pathname);
    router.replace(`/login?next=${next}`);
  }, [ready, registered, pathname, router]);

  if (pathname === "/") {
    return (
      <div className="site-frame site-frame--home">
        <header className="site-header site-header--home">
          <div className="shell site-header__inner">
            <Link href="/" className="site-brand">
              <span className="site-brand__name">{SITE_BRAND}</span>
            </Link>
            <nav className="site-nav site-nav--home" aria-label="首页">
              {MARKETING_NAV.map((link) => (
                <Link key={link.href} href={link.href} className="nav-link">
                  {link.label}
                </Link>
              ))}
              <AuthBar registerLabel="免费试试" />
            </nav>
          </div>
        </header>
        <main className="site-scroll">{children}</main>
        <HomeWarmup />
      </div>
    );
  }

  if (isAuthPath(pathname)) {
    return (
      <div className="site-frame">
        <header className="site-header">
          <div className="shell site-header__inner">
            <Link href="/" className="site-brand">
              <span className="site-brand__name">{SITE_BRAND}</span>
            </Link>
            <AuthBar />
          </div>
        </header>
        <main className="site-scroll">
          <div className="shell py-8 pb-12">{children}</div>
        </main>
      </div>
    );
  }

  if (!isPublicPath(pathname) && (!ready || !registered)) {
    return (
      <div className="site-frame">
        <header className="site-header">
          <div className="shell site-header__inner">
            <Link href="/" className="site-brand">
              <span className="site-brand__name">{SITE_BRAND}</span>
            </Link>
            <AuthBar />
          </div>
        </header>
        <main className="site-scroll">
          <div className="shell py-8">{ready ? "请先登录" : "加载中…"}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-frame">
      {open ? (
        <button
          type="button"
          className="app-sidebar__backdrop"
          aria-label="关闭菜单"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside className={open ? "app-sidebar app-sidebar--open" : "app-sidebar"}>
        <Link href="/" className="app-sidebar__brand">
          {SITE_BRAND}
        </Link>
        <nav className="app-sidebar__nav" aria-label="工作台">
          {APP_NAV_GROUPS.map((group) => (
            <div key={group.id} className="app-nav-group">
              <p className="app-nav-group__label">{group.label}</p>
              {group.items.map((link) => {
                const active = navActive(pathname, link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={active ? "app-nav-link app-nav-link--active" : "app-nav-link"}
                    onClick={() => setOpen(false)}
                  >
                    <NavIcon name={link.icon} />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <button
            type="button"
            className="app-topbar__menu"
            aria-label="打开菜单"
            onClick={() => setOpen(true)}
          >
            菜单
          </button>
          <p className="app-topbar__crumb">工作台</p>
          <AuthBar compact />
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
