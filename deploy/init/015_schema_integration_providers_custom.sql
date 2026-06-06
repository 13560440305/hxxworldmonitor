-- Custom admin-added data sources (not in built-in catalog)

ALTER TABLE integration_providers
  ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE;
