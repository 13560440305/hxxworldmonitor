-- Platform auth: admin (single per workspace) + user roles

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

UPDATE users SET role = 'user' WHERE role IS NULL OR role = '';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user'));

-- Only one administrator per workspace
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_one_admin_per_workspace
  ON users (workspace_id)
  WHERE role = 'admin';
