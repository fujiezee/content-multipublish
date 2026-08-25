/**
 * API / 音乐：按模型刊例 × 充值档位直接扣钱包。
 * 站内写稿/剧本不走这里。
 */
import { NextResponse } from "next/server";
import { gatewayGetModel } from "@/lib/ai/gateway";
import { lookupOfficialPricing } from "@/lib/ai/model-catalog/ark-prices";
import {
  isBillableOfficialPricing,
  modelHasBillablePrice,
  resolveModelOfficialPricing,
} from "@/lib/ai/model-catalog/pricing";
import type { AiModelPricingConfig } from "@/lib/ai/model-catalog/types";
import { PLAN_RECHARGE_HREF } from "@/lib/billing/copy";
import { apiMarkup, sellFen } from "@/lib/billing/markup";
import { sumPaidWalletYuan, debitWalletFen, getOrCreateWorkspaceBilling } from "@/lib/db";

export type ApiChargeKind = "api" | "music";

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

const DEFAULT_MAX_COMPLETION = 4096;

/** 中文友好粗估：约 2 字 ≈ 1 token */
export function estimateTokens(text: string): number {
  const chars = String(text || "").length;
  if (chars <= 0) return 0;
  return Math.max(1, Math.ceil(chars / 2));
}

export function estimateMessagesTokens(
  messages: { role?: string; content?: string }[],
): number {
  let total = 0;
  for (const row of messages) {
    total += estimateTokens(String(row.content || ""));
    total += 4;
  }
  return Math.max(1, total);
}

function tokensToFen(tokens: number, fenPerMillion: number): number {
  if (!Number.isFinite(fenPerMillion) || fenPerMillion <= 0 || tokens <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil((tokens * fenPerMillion) / 1_000_000));
}

export function resolvePricingForSlug(slug: string): AiModelPricingConfig | null {
  const id = String(slug || "").trim();
  if (!id) return null;
  const model = gatewayGetModel(id);
  if (model) {
    return resolveModelOfficialPricing(model);
  }
  return lookupOfficialPricing(id) || null;
}

export function quoteTextFen(
  slug: string,
  promptTokens: number,
  completionTokens: number,
  paidYuan: number,
): { fen: number; pricing: AiModelPricingConfig } | { error: string } {
  const pricing = resolvePricingForSlug(slug);
  if (!isBillableOfficialPricing(pricing)) {
    return { error: "该模型未上架或无刊例，不能调用" };
  }
  if (pricing.billUnit !== "1m_tokens") {
    return { error: `模型 ${slug} 不是按 token 计费` };
  }
  const markup = apiMarkup(paidYuan);
  const inFen = sellFen(pricing.officialInputFen ?? 0, markup);
  const outFen = sellFen(pricing.officialOutputFen ?? 0, markup);
  const fen =
    tokensToFen(Math.max(0, promptTokens), inFen) +
    tokensToFen(Math.max(0, completionTokens), outFen);
  return { fen: Math.max(fen, fen > 0 ? fen : 0), pricing };
}

export function quoteRequestFen(
  slug: string,
  paidYuan: number,
): { fen: number; pricing: AiModelPricingConfig } | { error: string } {
  const pricing = resolvePricingForSlug(slug);
  if (!isBillableOfficialPricing(pricing)) {
    return { error: "该模型未上架或无刊例，不能调用" };
  }
  if (pricing.billUnit !== "request" && pricing.officialFen == null) {
    return { error: `模型 ${slug} 无按次刊例` };
  }
  const markup = apiMarkup(paidYuan);
  const official = pricing.officialFen ?? 0;
  const fen = sellFen(official, markup);
  if (fen <= 0) return { error: `模型 ${slug} 售价无效` };
  return { fen, pricing };
}

export function publicModelUnavailableResponse(slug: string): NextResponse | null {
  const model = gatewayGetModel(slug);
  if (model?.enabled && model.ready && modelHasBillablePrice(model)) {
    return null;
  }
  return NextResponse.json(
    { error: "该模型未上架或无刊例，不能调用" },
    { status: 404 },
  );
}

export function walletBalanceFen(workspaceId: string): number {
  return Math.max(0, Number(getOrCreateWorkspaceBilling(workspaceId).wallet_fen ?? 0));
}

export function walletDeniedResponse(message?: string): NextResponse {
  return NextResponse.json(
    {
      error: message || `余额不足 · 请充值 ${PLAN_RECHARGE_HREF}`,
      code: "quota",
      kind: "wallet",
    },
    { status: 402 },
  );
}

export function peekWalletOrRespond(
  workspaceId: string,
  needFen: number,
): NextResponse | null {
  if (needFen <= 0) return null;
  if (walletBalanceFen(workspaceId) >= needFen) return null;
  return walletDeniedResponse();
}

export function chargeWallet(
  workspaceId: string,
  fen: number,
  opts: {
    kind: ApiChargeKind;
    label: string;
    meter: string;
    email?: string;
  },
): { ok: true; remaining: number } | { ok: false; error: string } {
  const cost = Math.round(fen);
  if (cost <= 0) {
    return { ok: true, remaining: walletBalanceFen(workspaceId) };
  }
  const remaining = debitWalletFen(workspaceId, cost, {
    kind: opts.kind,
    label: opts.label,
    meter: opts.meter,
    email: opts.email,
  });
  if (remaining == null) {
    return { ok: false, error: `余额不足 · 请充值` };
  }
  return { ok: true, remaining };
}

export function refundWallet(
  workspaceId: string,
  fen: number,
  opts: {
    kind: ApiChargeKind;
    label: string;
    meter: string;
    email?: string;
  },
) {
  const cost = Math.round(fen);
  if (cost <= 0) return;
  debitWalletFen(workspaceId, -cost, {
    kind: opts.kind,
    label: `${opts.label}·退回`,
    meter: opts.meter,
    email: opts.email,
  });
}

/** 调用前：按 prompt + 预估 completion 预检余额 */
export function peekTextChargeOrRespond(
  workspaceId: string,
  slug: string,
  messages: { role?: string; content?: string }[],
  maxTokens?: number,
):
  | { ok: true; promptTokens: number; paidYuan: number }
  | { ok: false; response: NextResponse } {
  const paidYuan = sumPaidWalletYuan(workspaceId);
  const promptTokens = estimateMessagesTokens(messages);
  const completionCap = Math.max(
    1,
    Math.min(32_000, Math.floor(maxTokens || DEFAULT_MAX_COMPLETION)),
  );
  const quoted = quoteTextFen(slug, promptTokens, completionCap, paidYuan);
  if ("error" in quoted) {
    const hidden = quoted.error.includes("未上架");
    return {
      ok: false,
      response: NextResponse.json(
        { error: quoted.error },
        { status: hidden ? 404 : 400 },
      ),
    };
  }
  const denied = peekWalletOrRespond(workspaceId, quoted.fen);
  if (denied) return { ok: false, response: denied };
  return { ok: true, promptTokens, paidYuan };
}

/** 调用后：按实际 token 扣费 */
export function settleTextCharge(
  workspaceId: string,
  slug: string,
  promptTokens: number,
  completionText: string,
  paidYuan: number,
  email?: string,
):
  | { ok: true; fen: number; usage: TokenUsage }
  | { ok: false; error: string } {
  const completionTokens = estimateTokens(completionText);
  const usage: TokenUsage = {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
  const quoted = quoteTextFen(slug, promptTokens, completionTokens, paidYuan);
  if ("error" in quoted) {
    return { ok: false, error: quoted.error };
  }
  const model = gatewayGetModel(slug);
  const label = model?.label || "API 文本";
  const charged = chargeWallet(workspaceId, quoted.fen, {
    kind: "api",
    label,
    meter: slug,
    email,
  });
  if (!charged.ok) return charged;
  return { ok: true, fen: quoted.fen, usage };
}

export function chargeMusicOrRespond(
  workspaceId: string,
  modelSlug: string,
  email?: string,
):
  | { ok: true; fen: number }
  | { ok: false; response: NextResponse } {
  const paidYuan = sumPaidWalletYuan(workspaceId);
  const quoted = quoteRequestFen(modelSlug, paidYuan);
  if ("error" in quoted) {
    return {
      ok: false,
      response: NextResponse.json({ error: quoted.error }, { status: 400 }),
    };
  }
  const denied = peekWalletOrRespond(workspaceId, quoted.fen);
  if (denied) return { ok: false, response: denied };
  const model = gatewayGetModel(modelSlug);
  const charged = chargeWallet(workspaceId, quoted.fen, {
    kind: "music",
    label: model?.label || "出歌",
    meter: modelSlug,
    email,
  });
  if (!charged.ok) {
    return { ok: false, response: walletDeniedResponse(charged.error) };
  }
  return { ok: true, fen: quoted.fen };
}
