/** Stripe Checkout，走法对齐 vigma / 点悟：不装 SDK，form-urlencoded 调官方 API。 */

const VIGMA_API = (process.env.VIGMA_API_URL || "https://api.vigma.app").replace(
  /\/$/,
  "",
);

export function publicOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = (
    req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "")
  )
    .split(",")[0]
    .trim();
  const host = (
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    url.host
  )
    .split(",")[0]
    .trim();
  if (host) return `${proto}://${host}`;
  const forced = process.env.SITE_URL?.trim().replace(/\/$/, "");
  return forced || `${url.protocol}//${url.host}`;
}

export function isStripeSessionId(id: string): boolean {
  return /^[a-zA-Z0-9_]+$/.test(id);
}

export type GeoCheckoutInput = {
  kind: "plan" | "pack";
  sku: string;
  interval: "monthly" | "yearly" | "once";
  title: string;
  description: string;
  amountYuan: number;
  origin: string;
  workspaceId: string;
  orderId: string;
  email: string;
  embedded?: boolean;
};

export type GeoCheckoutSession = {
  url?: string;
  sessionId: string;
  clientSecret?: string;
  publishableKey?: string;
};

export type GeoVerifyResult =
  | {
      paid: true;
      orderId: string;
      workspaceId: string;
      kind: string;
      sku: string;
      interval: string;
      amountYuan: number;
      actorEmail?: string;
    }
  | { paid: false; status?: string; error?: string };

function stripeSecret(): string {
  return process.env.STRIPE_SECRET_KEY?.trim() || "";
}

async function createStripeCheckoutSession(
  secret: string,
  input: GeoCheckoutInput,
): Promise<GeoCheckoutSession> {
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("locale", "zh");
  if (input.embedded) {
    params.set("ui_mode", "embedded");
    params.set(
      "return_url",
      `${input.origin}/plan/success?session_id={CHECKOUT_SESSION_ID}`,
    );
    params.set("redirect_on_completion", "always");
  } else {
    params.set(
      "success_url",
      `${input.origin}/plan/success?session_id={CHECKOUT_SESSION_ID}`,
    );
    params.set("cancel_url", `${input.origin}/plan#recharge`);
  }
  params.set("client_reference_id", input.orderId);
  params.set("metadata[source]", "dianwu-geo");
  params.set("metadata[kind]", input.kind);
  params.set("metadata[sku]", input.sku);
  params.set("metadata[interval]", input.interval);
  params.set("metadata[workspace_id]", input.workspaceId);
  params.set("metadata[order_id]", input.orderId);
  if (input.email) {
    params.set("metadata[actor_email]", input.email);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
      params.set("customer_email", input.email);
    }
  }
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "cny");
  params.set(
    "line_items[0][price_data][unit_amount]",
    String(input.amountYuan * 100),
  );
  params.set("line_items[0][price_data][product_data][name]", input.title);
  params.set(
    "line_items[0][price_data][product_data][description]",
    input.description.slice(0, 500),
  );

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2024-11-20.acacia",
    },
    body: params,
  });
  const data = (await res.json()) as {
    url?: string | null;
    id?: string;
    client_secret?: string | null;
    error?: { message?: string };
  };
  if (!res.ok || !data.id || (input.embedded ? !data.client_secret : !data.url)) {
    throw new Error(data.error?.message || "无法创建支付会话");
  }
  return {
    url: data.url || undefined,
    sessionId: data.id,
    clientSecret: data.client_secret || undefined,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY?.trim() || undefined,
  };
}

async function retrieveStripeCheckoutSession(
  secret: string,
  sessionId: string,
): Promise<{
  id: string;
  payment_status?: string;
  metadata?: Record<string, string>;
}> {
  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
    {
      headers: {
        Authorization: `Bearer ${secret}`,
        "Stripe-Version": "2024-11-20.acacia",
      },
      signal: AbortSignal.timeout(2500),
    },
  );
  const data = (await res.json()) as {
    id?: string;
    payment_status?: string;
    metadata?: Record<string, string>;
    error?: { message?: string };
  };
  if (!res.ok || !data.id) {
    throw new Error(data.error?.message || "支付会话读不出来");
  }
  return {
    id: data.id,
    payment_status: data.payment_status,
    metadata: data.metadata,
  };
}

function vigmaAuthHeaders(): Record<string, string> {
  const token =
    process.env.PUBLIC_MEDIA_TOKEN?.trim() ||
    process.env.VIGMA_API_TOKEN?.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function createVigmaCheckoutSession(
  input: GeoCheckoutInput,
): Promise<GeoCheckoutSession> {
  const res = await fetch(`${VIGMA_API}/dianwu-geo/checkout`, {
    method: "POST",
    headers: vigmaAuthHeaders(),
    body: JSON.stringify({
      kind: input.kind,
      sku: input.sku,
      interval: input.interval,
      origin: input.origin,
      workspaceId: input.workspaceId,
      orderId: input.orderId,
      email: input.email,
      amountYuan: input.amountYuan,
      embedded: input.embedded === true,
    }),
  });
  const raw = await res.text();
  let data: {
    ok?: boolean;
    url?: string;
    sessionId?: string;
    clientSecret?: string;
    publishableKey?: string;
    error?: string;
  };
  try {
    data = raw ? (JSON.parse(raw) as typeof data) : {};
  } catch {
    throw new Error(
      res.status === 404
        ? "支付服务暂不可用，请稍后再试"
        : "支付服务返回异常，请稍后再试",
    );
  }
  if (!res.ok || !data.ok || !data.sessionId) {
    throw new Error(data.error || "无法创建支付会话");
  }
  if (input.embedded) {
    if (!data.clientSecret) throw new Error(data.error || "无法创建支付会话");
  } else if (!data.url) {
    throw new Error(data.error || "无法创建支付会话");
  }
  return {
    url: data.url,
    sessionId: data.sessionId,
    clientSecret: data.clientSecret,
    publishableKey:
      data.publishableKey ||
      process.env.STRIPE_PUBLISHABLE_KEY?.trim() ||
      undefined,
  };
}

async function verifyVigmaCheckoutSession(
  sessionId: string,
): Promise<GeoVerifyResult> {
  try {
    const res = await fetch(
      `${VIGMA_API}/dianwu-geo/verify?session_id=${encodeURIComponent(sessionId)}`,
      {
        headers: vigmaAuthHeaders(),
        signal: AbortSignal.timeout(2500),
      },
    );
    const data = (await res.json().catch(() => ({}))) as GeoVerifyResult & {
      error?: string;
    };
    if (!res.ok) {
      return { paid: false, error: data.error || "确认支付失败" };
    }
    return data.paid
      ? data
      : { paid: false, status: data.status, error: data.error };
  } catch {
    return { paid: false, error: "确认支付超时" };
  }
}

export async function createGeoCheckoutSession(
  input: GeoCheckoutInput,
): Promise<GeoCheckoutSession> {
  const secret = stripeSecret();
  if (secret) return createStripeCheckoutSession(secret, input);
  return createVigmaCheckoutSession(input);
}

export async function verifyGeoCheckoutSession(
  sessionId: string,
): Promise<GeoVerifyResult> {
  const secret = stripeSecret();
  if (secret) {
    try {
      const session = await retrieveStripeCheckoutSession(secret, sessionId);
      const meta = session.metadata || {};
      if (
        session.payment_status === "paid" &&
        meta.source === "dianwu-geo" &&
        meta.order_id &&
        meta.workspace_id
      ) {
        return {
          paid: true,
          orderId: meta.order_id,
          workspaceId: meta.workspace_id,
          kind: meta.kind || "",
          sku: meta.sku || "",
          interval: meta.interval || "",
          amountYuan: 0,
          actorEmail: meta.actor_email || "",
        };
      }
      return { paid: false, status: "pending" };
    } catch (err) {
      return {
        paid: false,
        error: err instanceof Error ? err.message : "确认支付失败",
      };
    }
  }
  return verifyVigmaCheckoutSession(sessionId);
}
