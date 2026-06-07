-- Per-subscriber Open API keys (encrypted at rest, hash for auth lookup)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS api_key_enc TEXT,
  ADD COLUMN IF NOT EXISTS api_key_hash TEXT,
  ADD COLUMN IF NOT EXISTS api_key_prefix TEXT,
  ADD COLUMN IF NOT EXISTS api_key_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS api_key_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS api_key_revoked_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key_hash_active
  ON users (api_key_hash)
  WHERE role = 'user' AND api_key_hash IS NOT NULL AND api_key_revoked_at IS NULL;
