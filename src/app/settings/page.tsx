"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExtensionInstall } from "@/components/ExtensionInstall";
import {
  LATEST_EXTENSION_VERSION,
  extensionDownloadUrl,
} from "@/lib/extension-release";

type TokenRow = {
  id: string;
  label: string;
  token: string;
  tokenPreview: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export default function SettingsPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [user, setUser] = useState<{
    email: string;
    displayName: string;
    workspaceId: string;
  } | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastToken, setLastToken] = useState<string | null>(null);

  async function refresh() {
    const me = await fetch("/api/auth/me").then((r) => r.json());
    setAuthRequired(Boolean(me.authRequired));
    if (me.user) {
      setUser({
        email: me.user.email,
        displayName: me.user.displayName,
        workspaceId: me.user.workspaceId,
      });
    } else {
      setUser(null);
    }
    const tok = await fetch("/api/auth/extension-token").then((r) => r.json());
    if (Array.isArray(tok.tokens)) setTokens(tok.tokens);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function register() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, displayName }),
      });
      const data = await res.json();
      if (data.needsVerify) {
        setMessage(data.message || "请到邮箱点开激活链接后再登录");
        return;
      }
      if (!res.ok) throw new Error(data.error || "注册失败");
      setMessage("注册成功");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "注册失败");
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.needsVerify) {
        setMessage(data.message || data.error || "请先激活邮箱");
        return;
      }
      if (!res.ok) throw new Error(data.error || "登录失败");
      setMessage("登录成功");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMessage("已退出");
    await refresh();
  }

  async function createToken() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/extension-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "Chrome 扩展" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      setLastToken(data.token?.token || null);
      setMessage("已生成扩展 Token，请复制到扩展设置");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    await fetch("/api/auth/extension-token", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">工作区与扩展绑定</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              登录注册在右上角。发到自己的号，装 Chrome 扩展即可。模型 API 与计价见{" "}
              <Link href="/api-hub" className="underline">
                API
              </Link>
              。
            </p>
          </div>
          <a
            className="btn btn-primary"
            href={extensionDownloadUrl()}
            download={`dianwu-geo-${LATEST_EXTENSION_VERSION}.zip`}
          >
            下载扩展包 v{LATEST_EXTENSION_VERSION}
          </a>
        </div>
      </div>

      {message && (
        <div className="card border-[var(--accent)]/30 bg-[var(--accent-soft)]/40 px-4 py-3 text-sm">
          {message}
        </div>
      )}

      <div className="card space-y-3 p-5">
        <h2 className="text-lg font-medium">账号</h2>
        {user ? (
          <div className="space-y-2 text-sm">
            <p>
              {user.displayName} · {user.email}
            </p>
            <p className="text-[var(--muted)]">工作区 {user.workspaceId}</p>
            <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
              退出登录
            </button>
          </div>
        ) : (
          <div className="grid max-w-md gap-2">
            <input
              className="field"
              placeholder="邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="field"
              type="password"
              placeholder="密码（≥8 位）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              className="field"
              placeholder="显示名（注册用，可选）"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void login()}
              >
                登录
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => void register()}
              >
                注册工作区
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-medium">扩展绑定 Token</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              网页发稿不需要这项。扩展已默认对接 https://dianwu.ai，装好后打开网站点同步/发布即可。
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary text-sm"
            disabled={busy}
            onClick={() => void createToken()}
          >
            生成 Token
          </button>
        </div>
        {lastToken && (
          <pre className="overflow-x-auto rounded-lg bg-black/5 p-3 text-xs">
            {lastToken}
          </pre>
        )}
        <ul className="space-y-2">
          {tokens.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
            >
              <div>
                <div>{t.label}</div>
                <div className="text-xs text-[var(--muted)]">
                  {t.tokenPreview} · {new Date(t.createdAt).toLocaleString("zh-CN")}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost text-xs"
                onClick={() => void revoke(t.id)}
              >
                吊销
              </button>
            </li>
          ))}
          {tokens.length === 0 && (
            <p className="text-sm text-[var(--muted)]">暂无 Token</p>
          )}
        </ul>
      </div>

      <ExtensionInstall />
    </div>
  );
}
