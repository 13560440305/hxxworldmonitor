-- Encrypted copy of default subscriber password for admin display (hash remains for login)

ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS default_user_password_enc TEXT;
