-- Per-workspace platform settings (default subscriber password hash, etc.)

CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id               UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  default_user_password_hash TEXT,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
