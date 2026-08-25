"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, type AuthUser } from "@/components/useAuth";

export function VerifyEmailScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const token = search.get("token") || "";
  const { applyUser } = useAuth();
  const [message, setMessage] = useState(
    token ? "正在激活…" : "缺少激活链接",
  );
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!token) return;
    let gone = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json()) as { error?: string; user?: AuthUser };
        if (gone) return;
        if (!res.ok || !data.user) {
          setMessage(data.error || "激活失败");
          return;
        }
        applyUser(data.user);
        setOk(true);
        setMessage("邮箱已激活，正在进入…");
        router.replace("/dashboard");
      } catch (err) {
        if (!gone) {
          setMessage(err instanceof Error ? err.message : "激活失败");
        }
      }
    })();
    return () => {
      gone = true;
    };
  }, [token, applyUser, router]);

  return (
    <div className="auth-screen">
      <div className="auth-screen__card card">
        <p className="auth-screen__kicker">邮箱激活</p>
        <h1>{ok ? "已激活" : "激活账号"}</h1>
        <p className={ok ? "auth-screen__ok" : "auth-screen__lead"}>{message}</p>
        {!ok ? (
          <p className="auth-screen__switch">
            链接失效？<Link href="/login">回登录页重新发送</Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
