"use client";

import type { JobStatus, SessionStatus } from "@/lib/types";

const jobMap: Record<JobStatus, { label: string; className: string }> = {
  pending: { label: "等待中", className: "badge-muted" },
  running: { label: "同步中", className: "badge-run" },
  draft_ok: { label: "已进草稿", className: "badge-ok" },
  filled_awaiting_publish: { label: "待你发布", className: "badge-warn" },
  published: { label: "已发布", className: "badge-ok" },
  success: { label: "成功", className: "badge-ok" },
  failed: { label: "失败", className: "badge-danger" },
};

const sessionMap: Record<SessionStatus, { label: string; className: string }> = {
  connected: { label: "已连接", className: "badge-ok" },
  disconnected: { label: "未连接", className: "badge-muted" },
  expired: { label: "已过期", className: "badge-warn" },
};

export function JobBadge({ status }: { status: JobStatus }) {
  const item = jobMap[status] || jobMap.failed;
  return <span className={`badge ${item.className}`}>{item.label}</span>;
}

export function SessionBadge({ status }: { status: SessionStatus }) {
  const item = sessionMap[status];
  return <span className={`badge ${item.className}`}>{item.label}</span>;
}
