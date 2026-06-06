-- Subscriber account lifecycle: active / disabled (temp or permanent) / soft-deleted

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_status_check;
ALTER TABLE users
  ADD CONSTRAINT users_account_status_check
  CHECK (account_status IN ('active', 'disabled', 'deleted'));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS disabled_until TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_subscriber_status
  ON users (workspace_id, account_status)
  WHERE role = 'user';
