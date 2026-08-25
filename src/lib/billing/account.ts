import { NextResponse } from "next/server";
import {
  consumeMeteredUsage,
  consumeWorkspaceQuota,
  getOrCreateWorkspaceBilling,
  getWorkspace,
  insertBillingAdjustment,
  listBillingUsage,
  listWorkspacesAdmin,
  refundMeteredUsage,
  refundWorkspaceQuota,
  sumPaidWalletYuan,
  updateWorkspaceBilling,
  type BillingQuotaField,
  type BillingUsageRow,
  type WorkspaceBillingRow,
} from "@/lib/db";
import {
  getLicensePlan,
  isLicensePlanId,
  isMeteredQuotaKind,
  walletUnitsFromFen,
  type LicensePlan,
  type QuotaAmount,
} from "@/lib/billing/plans";
import { remainingWithMeter, usageFen } from "@/lib/billing/meters";
import type { BillingUsage, QuotaKind, QuotaSnap, UsageKind, WorkspacePlanView } from "@/lib/billing/types";
import { quotaRechargeText } from "@/lib/billing/copy";

export type { BillingUsage, QuotaKind, QuotaSnap, UsageKind, WorkspacePlanView };

const QUOTA_META: Record<
  QuotaKind,
  { label: string; unit: string; field: BillingQuotaField; planKey: keyof LicensePlan["quotas"] }
> = {
  articles: { label: "文章", unit: "篇", field: "articles", planKey: "articles" },
  images: { label: "配图", unit: "张", field: "images", planKey: "infographics" },
  mentions: { label: "查排名", unit: "次", field: "mentions", planKey: "mentions" },
  videoSeconds: {
    label: "视频",
    unit: "秒",
    field: "video_seconds",
    planKey: "videoSeconds",
  },
};

function extraOf(row: WorkspaceBillingRow, kind: QuotaKind): number {
  if (kind === "articles") return row.extra_articles;
  if (kind === "images") return row.extra_images;
  if (kind === "mentions") return row.extra_mentions;
  return row.extra_video_seconds;
}

function usedOf(row: WorkspaceBillingRow, kind: QuotaKind): number {
  if (kind === "articles") return row.used_articles;
  if (kind === "images") return row.used_images;
  if (kind === "mentions") return row.used_mentions;
  return row.used_video_seconds;
}

function customCapOf(row: WorkspaceBillingRow, kind: QuotaKind): number | null {
  if (kind === "articles") return row.cap_articles;
  if (kind === "images") return row.cap_images;
  if (kind === "mentions") return row.cap_mentions;
  return row.cap_video_seconds;
}

export function resolveQuotaCap(
  planAmount: QuotaAmount,
  extra: number,
  customCap: number | null,
): number | "unlimited" {
  const bonus = Math.max(0, extra);
  if (customCap != null && customCap >= 0) return customCap + bonus;
  if (planAmount === "unlimited") return "unlimited";
  if (planAmount === "custom") return bonus > 0 ? bonus : "unlimited";
  return planAmount + bonus;
}

function snapFor(
  row: WorkspaceBillingRow,
  plan: LicensePlan,
  kind: QuotaKind,
  paidRechargeYuan: number,
): QuotaSnap {
  const meta = QUOTA_META[kind];
  const cap = resolveQuotaCap(plan.quotas[meta.planKey], extraOf(row, kind), customCapOf(row, kind));
  const used = Math.max(0, usedOf(row, kind));
  const includedLeft = cap === "unlimited" ? "unlimited" : Math.max(0, cap - used);
  const walletFen = Number(row.wallet_fen ?? 0);
  const walletAllowed =
    !(kind === "videoSeconds" && plan.quotas.videoSeconds === 0);
  const walletUnits =
    walletAllowed && cap !== "unlimited" && isMeteredQuotaKind(kind)
      ? walletUnitsFromFen(kind, walletFen, paidRechargeYuan)
      : 0;
  return {
    kind,
    label: meta.label,
    unit: meta.unit,
    used,
    extra: extraOf(row, kind),
    cap,
    includedLeft,
    remaining:
      !walletAllowed
        ? 0
        : includedLeft === "unlimited"
          ? "unlimited"
          : includedLeft + walletUnits,
    walletUnits,
  };
}

export function viewWorkspacePlan(workspaceId: string): WorkspacePlanView {
  const workspace = getWorkspace(workspaceId);
  const row = getOrCreateWorkspaceBilling(workspaceId);
  const plan = getLicensePlan(row.plan_id);
  const kinds = Object.keys(QUOTA_META) as QuotaKind[];
  const paidRechargeYuan = sumPaidWalletYuan(workspaceId);
  return {
    workspaceId,
    workspaceName: workspace?.name || "工作区",
    planId: plan.id,
    planName: plan.name,
    forWho: plan.forWho,
    periodStart: row.period_start,
    note: row.note,
    walletFen: Number(row.wallet_fen ?? 0),
    paidRechargeYuan,
    quotas: kinds.map((kind) => snapFor(row, plan, kind, paidRechargeYuan)),
    extras: {
      articles: row.extra_articles,
      images: row.extra_images,
      mentions: row.extra_mentions,
      videoSeconds: row.extra_video_seconds,
    },
    caps: {
      articles: row.cap_articles,
      images: row.cap_images,
      mentions: row.cap_mentions,
      videoSeconds: row.cap_video_seconds,
    },
  };
}

export function formatQuotaRemain(snap: QuotaSnap): string {
  if (snap.remaining === "unlimited") return `${snap.used} / 不限`;
  return `${snap.used} / ${snap.cap} ${snap.unit}`;
}

export function quotaDeniedMessage(kind: QuotaKind): string {
  return quotaRechargeText(kind);
}

export function peekQuota(workspaceId: string, kind: QuotaKind): QuotaSnap {
  const view = viewWorkspacePlan(workspaceId);
  return view.quotas.find((item) => item.kind === kind) ?? view.quotas[0];
}

function isQuotaKind(raw: string): raw is QuotaKind {
  return (
    raw === "articles" ||
    raw === "images" ||
    raw === "mentions" ||
    raw === "videoSeconds"
  );
}

function isUsageKind(raw: string): raw is UsageKind {
  return (
    isQuotaKind(raw) || raw === "api" || raw === "music"
  );
}

const USAGE_META: Record<UsageKind, { label: string; unit: string }> = {
  articles: { label: "文章", unit: "篇" },
  images: { label: "配图", unit: "张" },
  mentions: { label: "查排名", unit: "次" },
  videoSeconds: { label: "视频", unit: "秒" },
  api: { label: "API", unit: "次" },
  music: { label: "音乐", unit: "次" },
};

export function asBillingUsage(row: BillingUsageRow): BillingUsage {
  const kind = isUsageKind(row.kind) ? row.kind : "api";
  const meta = USAGE_META[kind];
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actorEmail: row.actor_email,
    kind,
    label: row.label || meta.label,
    unit: meta.unit,
    amount: row.amount,
    fromIncluded: row.from_included,
    fromWallet: row.from_wallet,
    walletFen: row.wallet_fen,
    meter: row.meter,
    createdAt: row.created_at,
  };
}

export function listWorkspaceUsage(
  workspaceId: string,
  opts?: { limit?: number; walletOnly?: boolean },
): BillingUsage[] {
  return listBillingUsage(workspaceId, opts).map(asBillingUsage);
}

export function tryConsumeQuota(
  workspaceId: string,
  kind: QuotaKind,
  amount = 1,
  meter?: string | null,
  actorEmail = "",
): { ok: true } | { ok: false; error: string; kind: QuotaKind } {
  const view = viewWorkspacePlan(workspaceId);
  const snap = view.quotas.find((item) => item.kind === kind) ?? view.quotas[0];
  const field = QUOTA_META[kind].field;
  const actor = { email: actorEmail, meter };
  if (kind === "videoSeconds" && view.planId === "trial") {
    return { ok: false, error: quotaDeniedMessage(kind), kind };
  }
  if (isMeteredQuotaKind(kind) && snap.cap !== "unlimited") {
    if (
      !consumeMeteredUsage(
        workspaceId,
        field,
        amount,
        snap.cap,
        usageFen(kind, meter, view.paidRechargeYuan),
        actor,
      )
    ) {
      return { ok: false, error: quotaDeniedMessage(kind), kind };
    }
    return { ok: true };
  }
  if (!consumeWorkspaceQuota(workspaceId, field, amount, snap.cap, actor)) {
    return { ok: false, error: quotaDeniedMessage(kind), kind };
  }
  return { ok: true };
}

export function refundQuota(
  workspaceId: string,
  kind: QuotaKind,
  amount = 1,
  meter?: string | null,
  actorEmail = "",
) {
  const view = viewWorkspacePlan(workspaceId);
  const snap = peekQuota(workspaceId, kind);
  const actor = { email: actorEmail, meter };
  if (isMeteredQuotaKind(kind) && snap.cap !== "unlimited") {
    refundMeteredUsage(
      workspaceId,
      QUOTA_META[kind].field,
      amount,
      snap.cap,
      usageFen(kind, meter, view.paidRechargeYuan),
      actor,
    );
    return;
  }
  refundWorkspaceQuota(workspaceId, QUOTA_META[kind].field, amount, actor);
}

export function quotaDeniedResponse(
  denied: { error: string; kind: QuotaKind },
): NextResponse {
  return NextResponse.json(
    { error: denied.error, code: "quota", kind: denied.kind },
    { status: 402 },
  );
}

export function consumeOrRespond(
  workspaceId: string,
  kind: QuotaKind,
  amount = 1,
  meter?: string | null,
  actorEmail = "",
): NextResponse | null {
  const result = tryConsumeQuota(workspaceId, kind, amount, meter, actorEmail);
  if (result.ok) return null;
  return quotaDeniedResponse(result);
}

export function peekDeniedResponse(
  workspaceId: string,
  kind: QuotaKind,
  amount = 1,
  meter?: string | null,
): NextResponse | null {
  const view = viewWorkspacePlan(workspaceId);
  const left = remainingWithMeter(view, kind, meter);
  if (left === undefined || left === "unlimited") return null;
  if (left >= amount) return null;
  return quotaDeniedResponse({
    error: quotaDeniedMessage(kind),
    kind,
  });
}

export function listAdminWorkspacePlans() {
  return listWorkspacesAdmin().map((workspace) => {
    const emails = workspace.emails.split("\n").filter(Boolean);
    const names = workspace.names.split("\n").filter(Boolean);
    return {
      ...viewWorkspacePlan(workspace.id),
      createdAt: workspace.created_at,
      users: emails.map((email, i) => ({
        email,
        displayName: names[i] || email.split("@")[0] || "用户",
      })),
    };
  });
}

function asInt(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function asNullableInt(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.floor(n));
}

export function applyAdminBillingPatch(
  workspaceId: string,
  patch: Record<string, unknown>,
  actorEmail: string,
): WorkspacePlanView {
  if (!getWorkspace(workspaceId)) {
    throw new Error("工作区不存在");
  }
  const current = getOrCreateWorkspaceBilling(workspaceId);
  const nextPlan = typeof patch.planId === "string" && isLicensePlanId(patch.planId)
    ? patch.planId
    : current.plan_id;

  const extras = {
    extra_articles:
      asInt(patch.extraArticles, current.extra_articles) +
      asInt(patch.addArticles, 0),
    extra_images:
      asInt(patch.extraImages, current.extra_images) + asInt(patch.addImages, 0),
    extra_mentions:
      asInt(patch.extraMentions, current.extra_mentions) +
      asInt(patch.addMentions, 0),
    extra_video_seconds:
      asInt(patch.extraVideoSeconds, current.extra_video_seconds) +
      asInt(patch.addVideoSeconds, 0),
  };
  const addWalletFen =
    asInt(patch.addWalletFen, 0) + Math.round(asInt(patch.addWalletYuan, 0) * 100);

  const capArticles = asNullableInt(patch.capArticles);
  const capImages = asNullableInt(patch.capImages);
  const capMentions = asNullableInt(patch.capMentions);
  const capVideo = asNullableInt(patch.capVideoSeconds);

  const resetUsed = patch.resetUsed === true;
  updateWorkspaceBilling(workspaceId, {
    plan_id: nextPlan,
    ...extras,
    wallet_fen: Number(current.wallet_fen ?? 0) + addWalletFen,
    cap_articles: capArticles === undefined ? current.cap_articles : capArticles,
    cap_images: capImages === undefined ? current.cap_images : capImages,
    cap_mentions: capMentions === undefined ? current.cap_mentions : capMentions,
    cap_video_seconds: capVideo === undefined ? current.cap_video_seconds : capVideo,
    used_articles: resetUsed ? 0 : current.used_articles,
    used_images: resetUsed ? 0 : current.used_images,
    used_mentions: resetUsed ? 0 : current.used_mentions,
    used_video_seconds: resetUsed ? 0 : current.used_video_seconds,
    note: typeof patch.note === "string" ? patch.note.trim().slice(0, 200) : current.note,
  });

  const bits: string[] = [];
  if (nextPlan !== current.plan_id) {
    bits.push(`方案改为${getLicensePlan(nextPlan).name}`);
  }
  if (asInt(patch.addImages, 0)) bits.push(`配图 +${asInt(patch.addImages, 0)}`);
  if (asInt(patch.addMentions, 0)) bits.push(`查排名 +${asInt(patch.addMentions, 0)}`);
  if (asInt(patch.addVideoSeconds, 0)) bits.push(`视频 +${asInt(patch.addVideoSeconds, 0)}秒`);
  if (asInt(patch.addArticles, 0)) bits.push(`文章 +${asInt(patch.addArticles, 0)}`);
  if (addWalletFen) bits.push(`余额 +${(addWalletFen / 100).toFixed(2).replace(/\.00$/, "")}元`);
  if (resetUsed) bits.push("本月已用清零");
  if (bits.length) {
    insertBillingAdjustment({
      workspaceId,
      actorEmail,
      kind: nextPlan !== current.plan_id ? "plan" : "credit",
      detail: bits.join("，"),
    });
  }

  return viewWorkspacePlan(workspaceId);
}
