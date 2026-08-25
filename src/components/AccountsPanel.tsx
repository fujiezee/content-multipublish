"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlatformId, PlatformSession, SessionStatus } from "@/lib/types";
import { ALL_PLATFORM_IDS, PLATFORMS } from "@/lib/types";
import { SessionBadge } from "@/components/StatusBadge";
import { PlatformIcon } from "@/components/PlatformIcon";
import { platformLoginUrl } from "@/lib/platform-login";
import { ExtensionInstall } from "@/components/ExtensionInstall";
import {
  getDianwuGeoAccounts,
  isDianwuGeoExtensionPresent,
  isExtensionPlatform,
  waitForDianwuGeoExtension,
} from "@/lib/dianwu-geo";

type DraftStatus = "unknown" | "logged_in" | "logged_out" | "no_adapter";

function isPlatformId(value: string): value is PlatformId {
  return ALL_PLATFORM_IDS.includes(value as PlatformId);
}

function draftBadge(status: DraftStatus, extReady: boolean) {
  if (!extReady) return { label: "未装扩展", className: "badge-muted" };
  if (status === "logged_in") return { label: "已登录", className: "badge-ok" };
  if (status === "logged_out") return { label: "未登录", className: "badge-muted" };
  if (status === "no_adapter") return { label: "无适配", className: "badge-muted" };
  return { label: "未检测", className: "badge-muted" };
}

export function AccountsPanel() {
  const [sessions, setSessions] = useState<PlatformSession[]>([]);
  const [draftByPlatform, setDraftByPlatform] = useState<
    Partial<Record<PlatformId, { status: DraftStatus; name: string }>>
  >({});
  const [extReady, setExtReady] = useState(false);
  const [busyLocal, setBusyLocal] = useState<PlatformId | null>(null);
  const [busyDraft, setBusyDraft] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadLocal = useCallback(async () => {
    const res = await fetch("/api/platforms");
    const data = await res.json();
    setSessions(data.sessions ?? []);
  }, []);

  const checkDraft = useCallback(async (announce = true) => {
    setBusyDraft(true);
    if (announce) setMessage(null);
    try {
      const present =
        isDianwuGeoExtensionPresent() || (await waitForDianwuGeoExtension(2_000));
      setExtReady(present);
      if (!present) {
        setDraftByPlatform({});
        if (announce) setMessage("未检测到点物扩展。装好后在 chrome://extensions 重新加载，再点「检测草稿」。");
        return;
      }
      const accounts = await getDianwuGeoAccounts(20_000);
      const next: Partial<Record<PlatformId, { status: DraftStatus; name: string }>> = {};
      for (const platform of PLATFORMS) {
        if (!isExtensionPlatform(platform.id)) {
          next[platform.id] = { status: "no_adapter", name: "" };
          continue;
        }
        const hit = accounts.find((a) => a.type === platform.id);
        next[platform.id] = {
          status: hit ? "logged_in" : "logged_out",
          name: (hit?.title || hit?.displayName || "").trim(),
        };
      }
      for (const account of accounts) {
        if (!isPlatformId(account.type) || next[account.type]) continue;
        next[account.type] = {
          status: "logged_in",
          name: (account.title || account.displayName || "").trim(),
        };
      }
      setDraftByPlatform(next);
      if (announce) {
        const loggedIn = Object.values(next).filter((row) => row?.status === "logged_in").length;
        setMessage(`草稿登录已检测：${loggedIn} 个平台可用。`);
      }
    } catch (err) {
      if (announce) {
        setMessage(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusyDraft(false);
    }
  }, []);

  useEffect(() => {
    void loadLocal();
    void checkDraft(false);
  }, [loadLocal, checkDraft]);

  async function actLocal(
    platform: PlatformId,
    action: "connect" | "check" | "disconnect",
  ) {
    setBusyLocal(platform);
    setMessage(null);
    try {
      if (action === "connect") {
        setMessage("已打开本机浏览器窗口，请在窗口内完成登录（最多等待 5 分钟）…");
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
        setMessage(`${PLATFORMS.find((p) => p.id === platform)?.name} 本地服务已连接`);
      } else if (action === "check") {
        setMessage(
          data.status === "connected"
            ? "本地服务登录有效"
            : data.status === "expired"
              ? "本地服务登录已过期，请重新连接"
              : "本地服务尚未连接",
        );
      } else {
        setMessage("已断开并清除本地服务会话");
      }
      await loadLocal();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyLocal(null);
    }
  }

  function openDraftLogin(platform: PlatformId) {
    const url = platformLoginUrl(platform);
    if (!url) {
      setMessage("这个平台还没有登录页");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    setMessage(
      platform === "qiehao"
        ? "已打开企鹅号创作后台。确认已进后台后再点「检测草稿」。不要去扫码页，扫码页会踢掉已登录会话。"
        : "已打开平台登录页。在 Chrome 里登好后，再点「检测草稿」。",
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">自有号</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            用你自己的号发内容。每个平台看两种登录：本地服务和草稿，都能单独检测。
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary px-3 py-1.5 text-xs"
          disabled={busyDraft}
          onClick={() => void checkDraft(true)}
        >
          {busyDraft ? "正在检测草稿…" : "检测全部草稿"}
        </button>
      </div>

      <ExtensionInstall compact onReadyChange={setExtReady} />

      {message && (
        <div className="card border-[var(--accent)]/30 bg-[var(--accent-soft)]/40 px-3 py-2 text-sm">
          {message}
        </div>
      )}

      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {PLATFORMS.filter((platform) => platform.id !== "dianwu").map((platform) => {
          const session = sessions.find((s) => s.platform === platform.id);
          const localStatus: SessionStatus = session?.status ?? "disconnected";
          const draft = draftByPlatform[platform.id] ?? {
            status: isExtensionPlatform(platform.id) ? "unknown" : "no_adapter",
            name: "",
          };
          const draftMeta = draftBadge(draft.status, extReady);
          const localBusy = busyLocal === platform.id;
          return (
            <li key={platform.id} className="card flex flex-col gap-2.5 p-3">
              <div className="flex items-center gap-2">
                <PlatformIcon platform={platform.id} size={28} />
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-medium">{platform.name}</h2>
                  <p className="truncate text-xs text-[var(--muted)]" title={platform.description}>
                    {platform.description}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="rounded-md bg-[color-mix(in_srgb,var(--muted)_8%,transparent)] px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">本地服务</span>
                    <SessionBadge status={localStatus} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                    {session?.display_name || "本机浏览器会话"}
                    {session?.connected_at
                      ? ` · ${new Date(session.connected_at).toLocaleDateString("zh-CN")}`
                      : " · 未连接"}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="btn btn-primary px-2 py-0.5 text-[11px]"
                      disabled={!!busyLocal}
                      onClick={() => void actLocal(platform.id, "connect")}
                    >
                      {localBusy ? "进行中…" : "连接"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost px-2 py-0.5 text-[11px]"
                      disabled={!!busyLocal}
                      onClick={() => void actLocal(platform.id, "check")}
                    >
                      检测
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger px-2 py-0.5 text-[11px]"
                      disabled={!!busyLocal}
                      onClick={() => void actLocal(platform.id, "disconnect")}
                    >
                      断开
                    </button>
                  </div>
                </div>

                <div className="rounded-md bg-[color-mix(in_srgb,var(--muted)_8%,transparent)] px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">草稿</span>
                    <span className={`badge ${draftMeta.className}`}>{draftMeta.label}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                    {draft.status === "logged_in"
                      ? draft.name || "Chrome 扩展已登录，可同步草稿"
                      : draft.status === "no_adapter"
                        ? "这个平台还没有草稿适配"
                        : extReady
                          ? "用扩展检测 Chrome 里有没有登录"
                          : "需要点物扩展"}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="btn btn-ghost px-2 py-0.5 text-[11px]"
                      disabled={draft.status === "no_adapter"}
                      onClick={() => openDraftLogin(platform.id)}
                    >
                      打开登录
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary px-2 py-0.5 text-[11px]"
                      disabled={busyDraft || draft.status === "no_adapter"}
                      onClick={() => void checkDraft(true)}
                    >
                      {busyDraft ? "检测中…" : "检测"}
                    </button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
