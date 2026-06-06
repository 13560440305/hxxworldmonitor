-- Third-party integration credentials: base_url + api_key only (paths hardcoded in app code)

CREATE TABLE IF NOT EXISTS integration_providers (
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'misc',
  base_url       TEXT NOT NULL DEFAULT '',
  api_key_enc    TEXT,
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_integration_providers_sort
  ON integration_providers (workspace_id, category, sort_order, display_name);
