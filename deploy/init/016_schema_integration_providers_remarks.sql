-- Optional admin notes for integration / AI model rows

ALTER TABLE integration_providers
  ADD COLUMN IF NOT EXISTS remarks TEXT NOT NULL DEFAULT '';
