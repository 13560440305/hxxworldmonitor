-- Email verification codes (password reset, etc.)

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  purpose      TEXT NOT NULL CHECK (purpose IN ('password_reset')),
  code_hash    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_lookup
  ON email_verification_codes (workspace_id, lower(email), purpose)
  WHERE used_at IS NULL;
