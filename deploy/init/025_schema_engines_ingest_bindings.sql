-- Generic data-acquisition engines (Firecrawl, future browser/proxy types) — separate from business data sources.

CREATE TABLE IF NOT EXISTS engines (
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  engine_type    TEXT NOT NULL DEFAULT 'crawl',
  base_url       TEXT NOT NULL DEFAULT '',
  api_key_enc    TEXT,
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INT NOT NULL DEFAULT 0,
  is_custom      BOOLEAN NOT NULL DEFAULT FALSE,
  remarks        TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_engines_sort
  ON engines (workspace_id, engine_type, sort_order, display_name);

COMMENT ON TABLE engines IS 'Generic acquisition engines (crawl, browser, etc.) — credentials only; not business data sources';

CREATE TABLE IF NOT EXISTS data_source_ingest_bindings (
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_slug        TEXT NOT NULL,
  engine_slug        TEXT,
  ingest_plugin_key  TEXT NOT NULL,
  config_json        JSONB NOT NULL DEFAULT '{}',
  enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, source_slug),
  FOREIGN KEY (workspace_id, source_slug)
    REFERENCES integration_providers (workspace_id, slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ingest_bindings_engine
  ON data_source_ingest_bindings (workspace_id, engine_slug);

-- Migrate crawl-category rows from integration_providers → engines
INSERT INTO engines (
  workspace_id, slug, display_name, engine_type, base_url, api_key_enc,
  enabled, sort_order, is_custom, remarks
)
SELECT
  workspace_id, slug, display_name, 'crawl', base_url, api_key_enc,
  enabled, sort_order, COALESCE(is_custom, FALSE), COALESCE(remarks, '')
FROM integration_providers
WHERE category = 'crawl'
ON CONFLICT (workspace_id, slug) DO NOTHING;

-- Migrate cninfo → firecrawl binding (respect crawl_engine_slug when column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'integration_providers'
      AND column_name = 'crawl_engine_slug'
  ) THEN
    INSERT INTO data_source_ingest_bindings (workspace_id, source_slug, engine_slug, ingest_plugin_key, enabled)
    SELECT
      workspace_id,
      slug,
      COALESCE(NULLIF(TRIM(crawl_engine_slug), ''), 'firecrawl'),
      'cninfo-disclosure',
      TRUE
    FROM integration_providers
    WHERE slug = 'cninfo'
    ON CONFLICT (workspace_id, source_slug) DO UPDATE SET
      engine_slug = EXCLUDED.engine_slug,
      ingest_plugin_key = EXCLUDED.ingest_plugin_key,
      updated_at = NOW();
  ELSE
    INSERT INTO data_source_ingest_bindings (workspace_id, source_slug, engine_slug, ingest_plugin_key, enabled)
    SELECT workspace_id, slug, 'firecrawl', 'cninfo-disclosure', TRUE
    FROM integration_providers
    WHERE slug = 'cninfo'
    ON CONFLICT (workspace_id, source_slug) DO UPDATE SET
      engine_slug = EXCLUDED.engine_slug,
      ingest_plugin_key = EXCLUDED.ingest_plugin_key,
      updated_at = NOW();
  END IF;
END $$;

DELETE FROM integration_providers WHERE category = 'crawl';

ALTER TABLE integration_providers DROP COLUMN IF EXISTS crawl_engine_slug;
