import {
  applyAdminBillingPatch,
  viewWorkspacePlan,
} from "@/lib/billing/account";
import {
  creditPackAdds,
  formatYuan,
  getCreditPack,
  getLicensePlan,
  getWalletPack,
  isLicensePlanId,
  planPriceYuan,
  walletCreditFen,
  walletCreditYuan,
  type LicensePlanId,
} from "@/lib/billing/plans";
import {
  createGeoCheckoutSession,
  isStripeSessionId,
  verifyGeoCheckoutSession,
} from "@/lib/billing/stripe";
import {
  getBillingOrderById,
  getBillingOrderByStripeSession,
  insertBillingOrder,
  listBillingOrders,
  setBillingOrderStatus,
  setBillingOrderStripeSession,
  type BillingOrderRow,
} from "@/lib/db";
import type {
  BillingOrder,
  BillingPlanInterval,
} from "@/lib/billing/types";

const PLAN_RANK: Record<LicensePlanId, number> = {
  trial: 0,
  workbench: 1,
  machine: 2,
  private: 3,
};

function toOrder(row: BillingOrderRow): BillingOrder {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actorEmail: row.actor_email,
    kind:
      row.kind === "wallet" || row.sku.startsWith("wallet-")
        ? "wallet"
        : row.kind === "pack"
          ? "pack"
          : "plan",
    sku: row.sku,
    label: row.label,
    interval:
      row.interval === "monthly" || row.interval === "yearly"
        ? row.interval
        : "once",
    amountYuan: row.amount_yuan,
    status:
      row.status === "paid" ||
      row.status === "failed" ||
      row.status === "cancelled"
        ? row.status
        : "pending",
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

function applyPaidOrder(row: BillingOrderRow, actorEmail: string) {
  if (row.kind === "wallet" || row.sku.startsWith("wallet-")) {
    const pack = getWalletPack(row.sku);
    if (!pack) throw new Error("没有这个充值档");
    return applyAdminBillingPatch(
      row.workspace_id,
      { addWalletFen: walletCreditFen(pack) },
      actorEmail,
    );
  }
  if (row.kind === "pack") {
    const pack = getCreditPack(row.sku);
    if (!pack) throw new Error("没有这个充值包");
    return applyAdminBillingPatch(
      row.workspace_id,
      creditPackAdds(pack),
      actorEmail,
    );
  }
  if (!isLicensePlanId(row.sku) || row.sku === "trial" || row.sku === "private") {
    throw new Error("这个方案不能在线开通");
  }
  return applyAdminBillingPatch(
    row.workspace_id,
    { planId: row.sku },
    actorEmail,
  );
}

function orderDraftFromSku(input: {
  kind: string;
  sku: string;
  interval: string;
}): { kind: string; label: string; interval: string; amountYuan: number } | null {
  const wallet = getWalletPack(input.sku);
  if (wallet) {
    const creditYuan = walletCreditYuan(wallet);
    const bonus = wallet.bonusPct > 0 ? `，送 ${wallet.bonusPct}%` : "";
    return {
      kind: "wallet",
      label: `充 ${formatYuan(wallet.payYuan)} 到账 ${formatYuan(creditYuan)}${bonus}`,
      interval: "once",
      amountYuan: wallet.payYuan,
    };
  }
  const pack = getCreditPack(input.sku);
  if (pack) {
    return {
      kind: "pack",
      label: `${pack.name} ${pack.amount} ${pack.unit}`,
      interval: "once",
      amountYuan: pack.priceYuan,
    };
  }
  if (isLicensePlanId(input.sku) && input.sku !== "trial" && input.sku !== "private") {
    const interval = input.interval === "yearly" ? "yearly" : "monthly";
    const plan = getLicensePlan(input.sku);
    const amount = planPriceYuan(plan, interval);
    if (amount == null) return null;
    return {
      kind: "plan",
      label: `${plan.name} · ${interval === "yearly" ? "年付" : "月付"}`,
      interval,
      amountYuan: amount,
    };
  }
  return null;
}

function restorePaidOrder(input: {
  orderId: string;
  workspaceId: string;
  actorEmail: string;
  sessionId: string;
  kind: string;
  sku: string;
  interval: string;
}): BillingOrderRow {
  const existing =
    getBillingOrderById(input.orderId) ||
    getBillingOrderByStripeSession(input.sessionId);
  if (existing) {
    if (!existing.stripe_session_id) {
      setBillingOrderStripeSession(existing.id, input.sessionId);
    }
    return existing;
  }
  const draft = orderDraftFromSku(input);
  if (!draft) throw new Error("找不到这笔订单");
  return insertBillingOrder({
    id: input.orderId,
    workspaceId: input.workspaceId,
    actorEmail: input.actorEmail,
    kind: draft.kind,
    sku: input.sku,
    label: draft.label,
    interval: draft.interval,
    amountYuan: draft.amountYuan,
    status: "pending",
    stripeSessionId: input.sessionId,
  });
}

export function fulfillPaidOrder(input: {
  workspaceId: string;
  orderId: string;
}): {
  billing: ReturnType<typeof viewWorkspacePlan>;
  order: BillingOrder;
  already: boolean;
} {
  const row = getBillingOrderById(input.orderId);
  if (!row || row.workspace_id !== input.workspaceId) {
    throw new Error("找不到这笔订单");
  }
  if (row.status === "paid") {
    return {
      billing: viewWorkspacePlan(input.workspaceId),
      order: toOrder(row),
      already: true,
    };
  }
  const billing = applyPaidOrder(row, row.actor_email);
  setBillingOrderStatus(row.id, "paid");
  const paid = getBillingOrderById(row.id) ?? { ...row, status: "paid" };
  return { billing, order: toOrder(paid), already: false };
}

export async function verifyPaidSession(input: {
  workspaceId: string;
  sessionId: string;
  actorEmail?: string;
}): Promise<{
  paid: boolean;
  status?: string;
  error?: string;
  billing?: ReturnType<typeof viewWorkspacePlan>;
  order?: BillingOrder;
}> {
  if (!isStripeSessionId(input.sessionId)) {
    return { paid: false, error: "支付会话无效" };
  }

  const local = getBillingOrderByStripeSession(input.sessionId);
  if (local && local.workspace_id !== input.workspaceId) {
    return { paid: false, error: "这笔支付不属于当前工作区" };
  }

  const verified = await verifyGeoCheckoutSession(input.sessionId);
  if (!verified.paid) {
    return {
      paid: false,
      status: verified.status || "pending",
      error: verified.error,
    };
  }
  if (verified.workspaceId && verified.workspaceId !== input.workspaceId) {
    return { paid: false, error: "这笔支付不属于当前工作区" };
  }

  const orderId = verified.orderId || local?.id;
  if (!orderId) return { paid: false, error: "找不到这笔订单" };

  const row = restorePaidOrder({
    orderId,
    workspaceId: input.workspaceId,
    actorEmail:
      verified.actorEmail ||
      input.actorEmail ||
      local?.actor_email ||
      "",
    sessionId: input.sessionId,
    kind: verified.kind || local?.kind || "",
    sku: verified.sku || local?.sku || "",
    interval: verified.interval || local?.interval || "once",
  });

  const result = fulfillPaidOrder({
    workspaceId: input.workspaceId,
    orderId: row.id,
  });
  return {
    paid: true,
    billing: result.billing,
    order: result.order,
  };
}

export async function reconcilePendingOrders(workspaceId: string) {
  const pending = listBillingOrders(workspaceId, 20).filter(
    (row) => row.status === "pending" && row.stripe_session_id,
  );
  if (pending.length === 0) return;
  await Promise.all(
    pending.slice(0, 5).map(async (row) => {
      if (!row.stripe_session_id) return;
      try {
        await verifyPaidSession({
          workspaceId,
          sessionId: row.stripe_session_id,
        });
      } catch {
        /* still pending */
      }
    }),
  );
}

export function listWorkspaceBillingOrders(workspaceId: string): BillingOrder[] {
  return listBillingOrders(workspaceId).map(toOrder);
}

export async function checkoutWorkspacePlan(input: {
  workspaceId: string;
  actorEmail: string;
  planId: string;
  interval: BillingPlanInterval;
  origin: string;
  embedded?: boolean;
}): Promise<{
  url?: string;
  sessionId: string;
  clientSecret?: string;
  publishableKey?: string;
  order: BillingOrder;
}> {
  if (!isLicensePlanId(input.planId) || input.planId === "trial") {
    throw new Error("请选一个要开通的方案");
  }
  if (input.planId === "private") {
    throw new Error("企业方案按用量谈，留下需求我们来开通");
  }
  const interval = input.interval === "yearly" ? "yearly" : "monthly";
  const plan = getLicensePlan(input.planId);
  const amount = planPriceYuan(plan, interval);
  if (amount == null) throw new Error("这个方案不能在线开通");
  const current = viewWorkspacePlan(input.workspaceId);
  if (PLAN_RANK[current.planId] > PLAN_RANK[input.planId]) {
    throw new Error("已经是更高档方案，降级请找管理员");
  }
  if (current.planId === input.planId) {
    throw new Error(`已经是${plan.name}方案`);
  }

  const row = insertBillingOrder({
    workspaceId: input.workspaceId,
    actorEmail: input.actorEmail,
    kind: "plan",
    sku: input.planId,
    label: `${plan.name} · ${interval === "yearly" ? "年付" : "月付"}`,
    interval,
    amountYuan: amount,
    status: "pending",
  });

  try {
    const session = await createGeoCheckoutSession({
      kind: "plan",
      sku: input.planId,
      interval,
      title: `点物${plan.name} · ${interval === "yearly" ? "年付" : "月付"}`,
      description: plan.forWho,
      amountYuan: amount,
      origin: input.origin,
      workspaceId: input.workspaceId,
      orderId: row.id,
      email: input.actorEmail,
      embedded: input.embedded === true,
    });
    setBillingOrderStripeSession(row.id, session.sessionId);
    return {
      url: session.url,
      sessionId: session.sessionId,
      clientSecret: session.clientSecret,
      publishableKey: session.publishableKey,
      order: toOrder({ ...row, stripe_session_id: session.sessionId }),
    };
  } catch (err) {
    setBillingOrderStatus(row.id, "failed", null);
    throw err;
  }
}

export async function checkoutWorkspacePack(input: {
  workspaceId: string;
  actorEmail: string;
  packId: string;
  origin: string;
  embedded?: boolean;
}): Promise<{
  url?: string;
  sessionId: string;
  clientSecret?: string;
  publishableKey?: string;
  order: BillingOrder;
}> {
  const wallet = getWalletPack(input.packId);
  if (wallet) {
    const creditYuan = walletCreditYuan(wallet);
    const bonus = wallet.bonusPct > 0 ? `，送 ${wallet.bonusPct}%` : "";
    const row = insertBillingOrder({
      workspaceId: input.workspaceId,
      actorEmail: input.actorEmail,
      kind: "wallet",
      sku: wallet.id,
      label: `充 ${formatYuan(wallet.payYuan)} 到账 ${formatYuan(creditYuan)}${bonus}`,
      interval: "once",
      amountYuan: wallet.payYuan,
      status: "pending",
    });
    try {
      const session = await createGeoCheckoutSession({
        kind: "pack",
        sku: wallet.id,
        interval: "once",
        title: `点物余额 ${wallet.payYuan} 元`,
        description: `充 ${wallet.payYuan} 元，到账 ${creditYuan} 元${bonus}。配图、视频、查排名共用。`,
        amountYuan: wallet.payYuan,
        origin: input.origin,
        workspaceId: input.workspaceId,
        orderId: row.id,
        email: input.actorEmail,
        embedded: input.embedded === true,
      });
      setBillingOrderStripeSession(row.id, session.sessionId);
      return {
        url: session.url,
        sessionId: session.sessionId,
        clientSecret: session.clientSecret,
        publishableKey: session.publishableKey,
        order: toOrder({ ...row, stripe_session_id: session.sessionId }),
      };
    } catch (err) {
      setBillingOrderStatus(row.id, "failed", null);
      throw err;
    }
  }

  const pack = getCreditPack(input.packId);
  if (!pack) throw new Error("没有这个充值档");

  const row = insertBillingOrder({
    workspaceId: input.workspaceId,
    actorEmail: input.actorEmail,
    kind: "pack",
    sku: pack.id,
    label: `${pack.name} ${pack.amount} ${pack.unit}`,
    interval: "once",
    amountYuan: pack.priceYuan,
    status: "pending",
  });

  try {
    const session = await createGeoCheckoutSession({
      kind: "pack",
      sku: pack.id,
      interval: "once",
      title: `点物 · ${pack.name} ${pack.amount} ${pack.unit}`,
      description: pack.note,
      amountYuan: pack.priceYuan,
      origin: input.origin,
      workspaceId: input.workspaceId,
      orderId: row.id,
      email: input.actorEmail,
      embedded: input.embedded === true,
    });
    setBillingOrderStripeSession(row.id, session.sessionId);
    return {
      url: session.url,
      sessionId: session.sessionId,
      clientSecret: session.clientSecret,
      publishableKey: session.publishableKey,
      order: toOrder({ ...row, stripe_session_id: session.sessionId }),
    };
  } catch (err) {
    setBillingOrderStatus(row.id, "failed", null);
    throw err;
  }
}
