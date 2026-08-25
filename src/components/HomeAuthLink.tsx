"use client";

import Link from "next/link";
import { useAuth } from "@/components/useAuth";

/** 已登录进产品；没登录先注册，注册完回到这里。 */
export function HomeAuthLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { ready, registered } = useAuth();
  const dest =
    ready && registered ? href : `/register?next=${encodeURIComponent(href)}`;
  return (
    <Link href={dest} className={className}>
      {children}
    </Link>
  );
}
