import { cookies } from "next/headers";
import {
  createAuthSession,
  extendAuthSession,
  getAgentDeviceByToken,
  getAuthSessionByToken,
  getExtensionToken,
  getWorkspaceUser,
  hasInteractiveUsers,
  touchAgentDevice,
  touchExtensionToken,
} from "@/lib/db";
import { persistCloudflareDb } from "@/lib/db/cloudflare-sql";
import { isCloudflareRuntime } from "@/lib/paths";
import type { AuthContext } from "@/lib/auth/types";

export const SESSION_COOKIE = "dwgeo_session";
/** Browser-session login: cookie dies when the tab/browser closes. */
const SESSION_DAYS = 14;
/** 「记住登录」：约半年，访问时会顺延。 */
const REMEMBER_DAYS = 180;
const REMEMBER_SLIDE_DAYS = 30;

function cookieSecure() {
  return isCloudflareRuntime() || process.env.NODE_ENV === "production";
}

function expiryFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function isRememberSession(expiresAt: string) {
  return new Date(expiresAt).getTime() - Date.now() > SESSION_DAYS * 24 * 60 * 60 * 1000;
}

async function persistAuthDb() {
  if (!isCloudflareRuntime()) return;
  await persistCloudflareDb();
}

export function authRequired(): boolean {
  const raw = process.env.AUTH_REQUIRED?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return hasInteractiveUsers();
}

function sessionCookieOptions(expires: Date, remember: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: cookieSecure(),
    ...(remember
      ? { expires, maxAge: REMEMBER_DAYS * 24 * 60 * 60 }
      : {}),
  };
}

export async function createSessionCookie(
  userId: string,
  workspaceId: string,
  remember = false,
): Promise<string> {
  const expires = expiryFromNow(remember ? REMEMBER_DAYS : SESSION_DAYS);
  const session = createAuthSession({
    userId,
    workspaceId,
    expiresAt: expires.toISOString(),
  });
  const jar = await cookies();
  jar.set(
    SESSION_COOKIE,
    session.token,
    sessionCookieOptions(expires, remember),
  );
  await persistAuthDb();
  return session.token;
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: cookieSecure(),
    maxAge: 0,
    expires: new Date(0),
  });
  await persistAuthDb();
}

function contextFromUser(
  user: NonNullable<ReturnType<typeof getWorkspaceUser>>,
): AuthContext {
  return {
    userId: user.id,
    workspaceId: user.workspace_id,
    email: user.email,
    displayName: user.display_name,
  };
}

/** Resolve auth from cookie session or Authorization: Bearer extension token. */
export async function resolveAuth(req?: Request): Promise<AuthContext | null> {
  const bearer = req?.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (bearer) {
    const ext = getExtensionToken(bearer);
    if (ext) {
      touchExtensionToken(ext.id);
      const user = getWorkspaceUser(ext.user_id);
      if (user) return contextFromUser(user);
    }
    const agent = getAgentDeviceByToken(bearer);
    if (agent) {
      touchAgentDevice(agent.id);
      const user = getWorkspaceUser(agent.user_id);
      if (user) {
        return { ...contextFromUser(user), agentDeviceId: agent.id };
      }
      return {
        userId: agent.user_id,
        workspaceId: agent.workspace_id,
        email: "",
        displayName: agent.label,
        agentDeviceId: agent.id,
      };
    }
  }

  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const session = getAuthSessionByToken(token);
    if (!session) return null;
    if (new Date(session.expires_at).getTime() < Date.now()) return null;
    const user = getWorkspaceUser(session.user_id);
    if (!user) return null;
    if (isRememberSession(session.expires_at)) {
      const remainingMs = new Date(session.expires_at).getTime() - Date.now();
      if (remainingMs < REMEMBER_SLIDE_DAYS * 24 * 60 * 60 * 1000) {
        const next = expiryFromNow(REMEMBER_DAYS);
        extendAuthSession(token, next.toISOString());
        jar.set(
          SESSION_COOKIE,
          token,
          sessionCookieOptions(next, true),
        );
        await persistAuthDb();
      }
    }
    return contextFromUser(user);
  } catch {
    return null;
  }
}

export async function requireAuth(req?: Request): Promise<AuthContext | null> {
  const ctx = await resolveAuth(req);
  if (ctx) return ctx;
  if (!authRequired()) {
    // Local single-tenant mode: implicit default workspace
    const { ensureDefaultWorkspace } = await import("@/lib/db");
    const ws = ensureDefaultWorkspace();
    return {
      userId: "local",
      workspaceId: ws.id,
      email: "local@dianwu.geo",
      displayName: "本地工作区",
    };
  }
  return null;
}
