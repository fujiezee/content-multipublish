"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "文章" },
  { href: "/keywords", label: "GEO 挖词" },
  { href: "/corpus", label: "语料库" },
  { href: "/writing", label: "AI 写文案" },
  { href: "/accounts", label: "本机账号" },
  { href: "/jobs", label: "同步记录" },
  { href: "/settings", label: "工作区" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)]/80 bg-[color-mix(in_srgb,var(--card)_88%,transparent)] backdrop-blur-md">
      <div className="shell flex items-center justify-between py-4">
        <Link href="/" className="group">
          <div className="text-[1.35rem] font-semibold tracking-tight text-[var(--accent)]">
            点物GEO
          </div>
          <div className="text-xs text-[var(--muted)] group-hover:text-[var(--ink)] transition-colors">
            文章多平台同步助手
          </div>
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/" || pathname.startsWith("/articles")
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={active ? "nav-link nav-link--active" : "nav-link text-[var(--muted)]"}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
