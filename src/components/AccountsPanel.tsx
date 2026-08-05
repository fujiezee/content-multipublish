"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlatformId, PlatformSession } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import { SessionBadge } from "@/components/StatusBadge";

export function AccountsPanel() {
  const [sessions, setSessions] = useState<PlatformSession[]>([]);
  const [busy, setBusy] = useState<PlatformId | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/platforms");
    const data = await res.json();
    setSessions(data.sessions ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(platform: PlatformId, action: "connect" | "check" | "disconnect") {
    setBusy(platform);
    setMessage(null);
    try {
      if (action === "connect") {
        setMessage("已打开浏览器窗口，请在窗口内完成登录（最多等待 5 分钟）…");
      }
      const res = await fetch(`/api/platforms/${platform}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "操作失败");
      } else if (action === "connect") {
        setMessage(`${PLATFORMS.find((p) => p.id === platform)?.name} 已连接`);
      } else if (action === "check") {
        setMessage(
          data.status === "connected"
            ? "登录态有效"
            : data.status === "expired"
              ? "登录态已过期，请重新连接"
              : "尚未连接",
        );
      } else {
        setMessage("已断开并清除本地会话");
      }
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">账号</h1>
        <p className="mt-1 text-[var(--muted)]">
          首次连接会打开有头浏览器，扫码或账密登录后自动保存 Cookie（不存密码）。
          简书请登录成功并看到「写文章 / 新建文章」后再稍等，系统确认后会自动关闭窗口。
        </p>
      </div>

      {message && (
        <div className="card border-[var(--accent)]/30 bg-[var(--accent-soft)]/40 px-4 py-3 text-sm">
          {message}
        </div>
      )}

      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PLATFORMS.map((platform) => {
          const session = sessions.find((s) => s.platform === platform.id);
          const status = session?.status ?? "disconnected";
          const isBusy = busy === platform.id;
          return (
            <li key={platform.id} className="card flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-xl font-medium">{platform.name}</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">{platform.description}</p>
                </div>
                <SessionBadge status={status} />
              </div>
              <div className="mt-4 text-xs text-[var(--muted)]">
                {session?.display_name ? `显示名：${session.display_name}` : "尚未绑定显示名"}
                <br />
                {session?.connected_at
                  ? `连接于 ${new Date(session.connected_at).toLocaleString("zh-CN")}`
                  : "未连接"}
              </div>
              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                <button
                  className="btn btn-primary"
                  disabled={!!busy}
                  onClick={() => void act(platform.id, "connect")}
                >
                  {isBusy && busy === platform.id ? "进行中…" : "连接 / 重新登录"}
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={!!busy}
                  onClick={() => void act(platform.id, "check")}
                >
                  检测
                </button>
                <button
                  className="btn btn-danger"
                  disabled={!!busy}
                  onClick={() => void act(platform.id, "disconnect")}
                >
                  断开
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
