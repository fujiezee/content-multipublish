"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, type AuthUser } from "@/components/useAuth";

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  if (raw === "/login" || raw === "/register" || raw === "/verify") {
    return "/dashboard";
  }
  return raw;
}

type Mode = "login" | "register";

export function AuthScreen({ mode }: { mode: Mode }) {
  const router = useRouter();
  const search = useSearchParams();
  const nextPath = safeNextPath(search.get("next"));
  const { applyUser, ready, registered } = useAuth();

  useEffect(() => {
    if (ready && registered) router.replace(nextPath);
  }, [ready, registered, nextPath, router]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [remember, setRemember] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function resend(target = pendingEmail || email) {
    if (!target.trim()) {
      setMessage("先填邮箱");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: target }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setMessage(data.error || "发送失败");
        return;
      }
      setPendingEmail(target.trim().toLowerCase());
      setMessage(data.message || "激活邮件已发送");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "发送失败");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(
        mode === "login" ? "/api/auth/login" : "/api/auth/register",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            displayName,
            workspaceName,
            remember,
          }),
        },
      );
      const data = (await res.json()) as {
        error?: string;
        user?: AuthUser;
        needsVerify?: boolean;
        email?: string;
        message?: string;
      };
      if (data.needsVerify) {
        setPendingEmail(data.email || email);
        setMessage(data.message || data.error || "请到邮箱激活后再登录");
        return;
      }
      if (!res.ok) {
        setMessage(data.error || (mode === "login" ? "登录失败" : "注册失败"));
        return;
      }
      applyUser(data.user ?? null);
      router.replace(nextPath);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "请求失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-screen__card card">
        <p className="auth-screen__kicker">
          {pendingEmail
            ? "查收邮件"
            : mode === "login"
              ? "已有工作区"
              : "新开一个工作区"}
        </p>
        <h1>
          {pendingEmail
            ? "激活邮箱"
            : mode === "login"
              ? "登录"
              : "注册"}
        </h1>
        <p className="auth-screen__lead">
          {pendingEmail
            ? `激活链接已发到 ${pendingEmail}，点开后再登录。没收到就看垃圾箱。`
            : mode === "login"
              ? "进入总览，看稿、看同步、查排名。"
              : "注册后会发一封激活邮件，点开链接才能登录。"}
        </p>
        {message ? (
          <p
            className={
              pendingEmail && !/失败|错误/.test(message)
                ? "auth-screen__ok"
                : "auth-screen__error"
            }
          >
            {message}
          </p>
        ) : null}
        {pendingEmail ? (
          <div className="auth-screen__form">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void resend()}
            >
              {busy ? "请稍候…" : "重新发送激活邮件"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                setPendingEmail("");
                setMessage(null);
              }}
            >
              回登录
            </button>
          </div>
        ) : (
          <form
            className="auth-screen__form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {mode === "register" ? (
              <label>
                <span>显示名</span>
                <input
                  className="field"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="怎么称呼你"
                />
              </label>
            ) : null}
            <label>
              <span>邮箱</span>
              <input
                className="field"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>
            <label>
              <span>密码{mode === "register" ? "（至少 8 位）" : ""}</span>
              <input
                className="field"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {mode === "register" ? (
              <label>
                <span>工作区名称（可选）</span>
                <input
                  className="field"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="我的工作区"
                />
              </label>
            ) : null}
            <label className="auth-screen__remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span>记住登录（约 180 天，本机浏览器有效）</span>
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy
                ? "请稍候…"
                : mode === "login"
                  ? "登录并进入总览"
                  : "注册并发送激活邮件"}
            </button>
          </form>
        )}
        <p className="auth-screen__switch">
          {mode === "login" ? (
            <>
              还没有账号？<Link href="/register">去注册</Link>
            </>
          ) : (
            <>
              已经注册过？<Link href="/login">去登录</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
