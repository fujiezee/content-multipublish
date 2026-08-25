"use client";

import { useCallback, useEffect, useState } from "react";

type Device = {
  id: string;
  label: string;
  tokenPreview: string;
  lastSeenAt: string | null;
  createdAt: string;
  online: boolean;
};

type Status = {
  online: boolean;
  devices: Device[];
};

function isLocalSite() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function AgentSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [local] = useState(isLocalSite);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/agent/status", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) {
      setStatus({
        online: Boolean(data.online),
        devices: Array.isArray(data.devices) ? data.devices : [],
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 8000);
    return () => clearInterval(t);
  }, [refresh]);

  async function installLocal() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/agent/install", { method: "POST" });
      const data = await res.json();
      if (data.needDownload) {
        window.location.href = "/api/agent/download";
        setMessage("已开始下载。解压后看「先看这个」。");
        return;
      }
      if (!res.ok) throw new Error(data.error || "打开失败");
      setMessage(
        data.opened
          ? "助手窗口已打开，不要关。桌面也有「点物助手」文件夹。"
          : "已放到桌面「点物助手」。双击「打开点物助手」。",
      );
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "打开失败");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    await fetch("/api/agent/status", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await refresh();
  }

  return (
    <div className="card agent-install">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2>本机助手</h2>
          <p>
            扩展发不了的号，用这个。打开后，网站点同步，电脑会打开后台并把稿复制好。
          </p>
        </div>
        <span className={status?.online ? "badge badge-ok" : "badge badge-muted"}>
          {status?.online ? "在线" : "未打开"}
        </span>
      </div>

      {status?.online ? (
        <p className="agent-install__ok">助手开着，可以同步了。不要关那个小窗口。</p>
      ) : local ? (
        <>
          <p className="ext-install__hint">
            点一次就行。会在桌面放好，并打开一个窗口。不要从浏览器下载那个 command，苹果会拦。
          </p>
          <div className="ext-install__actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void installLocal()}
            >
              {busy ? "正在打开…" : "打开助手"}
            </button>
          </div>
        </>
      ) : (
        <>
          <ol className="ext-install__steps">
            <li>点「下载助手」，解压。</li>
            <li>
              苹果若提示无法验证：点「完成」，打开「系统设置 → 隐私与安全性」，点「仍要打开」。
            </li>
            <li>再双击「打开点物助手」。不要关窗口。</li>
          </ol>
          <div className="ext-install__actions">
            <a className="btn btn-primary" href="/api/agent/download">
              下载助手
            </a>
          </div>
        </>
      )}

      {message ? <p className="text-sm">{message}</p> : null}

      {(status?.devices ?? []).length > 0 ? (
        <ul className="mt-3 space-y-2">
          {status?.devices.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
            >
              <div>
                <div>
                  {d.label}
                  {d.online ? " · 在线" : " · 没开"}
                </div>
                <div className="text-xs text-[var(--muted)]">
                  {d.lastSeenAt
                    ? `最近 ${new Date(d.lastSeenAt).toLocaleString("zh-CN")}`
                    : "还没打开过"}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost text-xs"
                onClick={() => void revoke(d.id)}
              >
                解除
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
