-- Default subscription/delivery language per subscriber (role=user)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_lang TEXT NOT NULL DEFAULT 'zh';

UPDATE users SET preferred_lang = 'zh' WHERE preferred_lang IS NULL OR preferred_lang = '';
