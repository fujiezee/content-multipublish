export const LOCAL_USER_ID = "local";
export const LOCAL_USER_EMAIL = "local@dianwu.geo";
export const LOCAL_WORKSPACE_ID = "ws_local";

export function isLocalWorkspaceUser(
  user:
    | {
        userId?: string;
        id?: string;
        email?: string;
        workspaceId?: string;
        workspace_id?: string;
      }
    | null
    | undefined,
): boolean {
  if (!user) return false;
  const id = user.userId ?? user.id;
  const workspace = user.workspaceId ?? user.workspace_id;
  if (workspace === LOCAL_WORKSPACE_ID) return true;
  return id === LOCAL_USER_ID || user.email === LOCAL_USER_EMAIL;
}
