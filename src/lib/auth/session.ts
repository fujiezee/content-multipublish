import { cookies } from "next/headers";
import {
  createAuthSession,
  getAuthSessionByToken,
  getExtensionToken,
  getWorkspaceUser,
  touchExtensionToken,
} from "@/lib/db";
import type { AuthContext } from "@/lib/auth/types";

export const SESSION_COOKIE = "dwgeo_session";
const SESSION_DAYS = 30;

export function authRequired(): boolean {
  const raw = process.env.AUTH_REQUIRED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function createSessionCookie(
  userId: string,
  workspaceId: string,
): Promise<string> {
  const expires = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const session = createAuthSession({ userId, workspaceId, expiresAt: expires });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(expires),
  });
  return session.token;
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
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
