export type Workspace = {
  id: string;
  name: string;
  created_at: string;
};

export type WorkspaceUser = {
  id: string;
  workspace_id: string;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: string;
};

export type ExtensionToken = {
  id: string;
  workspace_id: string;
  user_id: string;
  token: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
};

export type AuthSession = {
  id: string;
  user_id: string;
  workspace_id: string;
  token: string;
  created_at: string;
  expires_at: string;
};

export type AuthContext = {
  userId: string;
  workspaceId: string;
  email: string;
  displayName: string;
};
