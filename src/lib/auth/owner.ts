import { randomUUID } from "crypto";
import { hashPassword } from "@/lib/auth/password";
import { authRequired } from "@/lib/auth/session";
import type { AuthContext } from "@/lib/auth/types";
import {
  createWorkspaceUser,
  ensureDefaultWorkspace,
  getWorkspaceUserByEmail,
} from "@/lib/db";

/** Cookie "local" fallback has no workspace_users row; create one for tokens. */
export function resolveOwnerUserId(ctx: AuthContext): string | null {
  if (ctx.userId !== "local") return ctx.userId;
  if (authRequired()) return null;
  ensureDefaultWorkspace();
  const existing = getWorkspaceUserByEmail("local@dianwu.geo");
  if (existing) return existing.id;
  const created = createWorkspaceUser({
    workspaceId: ctx.workspaceId,
    email: "local@dianwu.geo",
    passwordHash: hashPassword(randomUUID()),
    displayName: "本地工作区",
  });
  return created.id;
}
