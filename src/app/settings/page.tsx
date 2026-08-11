"use client";

import { useEffect, useState } from "react";

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
    <div className="shell space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">工作区与扩展绑定</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          SaaS 多租户：登录后生成扩展 Token；扩展用 Token 绑定本工作区。
          {authRequired
            ? " 当前已开启 AUTH_REQUIRED。"
            : " 本地模式可不登录，仍可生成绑定 Token。"}
        </p>
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
              在扩展 popup「CLI / MCP」旁或 chrome.storage.local.saasToken 填入
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

      <div className="card space-y-2 p-5 text-sm text-[var(--muted)]">
        <h2 className="text-lg font-medium text-[var(--ink)]">扩展安装</h2>
        <p>
          开发者模式加载仓库内 <code>tools/dianwu-geo</code>（当前 2.6.0+）。上架
          Chrome Web Store 或企业私载时保持同一签名与协议号。
        </p>
        <p>
          详见 <code>tools/dianwu-geo/DISTRIBUTION.md</code>
        </p>
      </div>
    </div>
  );
}
