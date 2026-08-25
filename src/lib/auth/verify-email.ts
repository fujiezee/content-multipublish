import { isCloudflareRuntime } from "@/lib/paths";
import {
  createEmailVerifyToken,
  latestEmailVerifyCreatedAt,
} from "@/lib/db";

const RESEND_URL = "https://api.resend.com/emails";
const RESEND_COOLDOWN_MS = 60_000;

export function siteOrigin(req?: Request): string {
  if (req) {
    try {
      return new URL(req.url).origin;
    } catch {
      // fall through
    }
  }
  return (
    process.env.SITE_URL?.trim().replace(/\/$/, "") || "https://dianwu.tech"
  );
}

function mailFrom(): string {
  return (
    process.env.MAIL_FROM?.trim() ||
    "点物 <noreply@dianwu.ai>"
  );
}

export function verifyPageUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/verify?token=${encodeURIComponent(token)}`;
}

export function canSendVerifyEmail(userId: string): boolean {
  const last = latestEmailVerifyCreatedAt(userId);
  if (!last) return true;
  return Date.now() - new Date(last).getTime() >= RESEND_COOLDOWN_MS;
}

export async function issueAndSendVerifyEmail(input: {
  userId: string;
  email: string;
  displayName?: string;
  origin: string;
}): Promise<{ sent: boolean; verifyUrl?: string }> {
  if (!canSendVerifyEmail(input.userId)) {
    return { sent: true };
  }
  const token = createEmailVerifyToken(input.userId);
  const verifyUrl = verifyPageUrl(input.origin, token);
  const name = (input.displayName || "").trim() || "你好";
  const payload = {
    from: mailFrom(),
    to: [input.email],
    subject: "激活你的点物账号",
    text: `${name}，请打开这个链接激活账号（24 小时内有效）：\n${verifyUrl}\n`,
    html: `<p>${name}，点击下面的链接激活点物账号（24 小时内有效）：</p>
<p><a href="${verifyUrl}">激活账号</a></p>
<p style="color:#666;font-size:13px;word-break:break-all">${verifyUrl}</p>`,
  };

  const key = process.env.RESEND_API_KEY?.trim();
  if (key) {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn("[verify-email] resend", res.status, detail.slice(0, 200));
      throw new Error("激活邮件发送失败，请稍后重试");
    }
    return { sent: true };
  }

  const vigma = process.env.VIGMA_API_URL?.trim().replace(/\/$/, "");
  const vigmaToken =
    process.env.PUBLIC_MEDIA_TOKEN?.trim() ||
    process.env.VIGMA_API_TOKEN?.trim();
  if (vigma && vigmaToken) {
    const res = await fetch(`${vigma}/admin/send-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vigmaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
    if (!res.ok || !data.ok) {
      console.warn("[verify-email] vigma", res.status);
      throw new Error("激活邮件发送失败，请稍后重试");
    }
    return { sent: true };
  }

  if (!isCloudflareRuntime()) {
    console.info("[verify-email]", verifyUrl);
    return { sent: true, verifyUrl };
  }
  throw new Error("未配置激活邮件，请设置 RESEND_API_KEY");
}
