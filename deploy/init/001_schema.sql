-- World Monitor platform schema (Phase 0 + reserved tables for Phase 2–4)
-- pgvector is optional — see 002_schema_pgvector.sql (Phase 2 semantic search)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Core tenancy
-- ---------------------------------------------------------------------------

CREATE TABLE workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO workspaces (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'default')
ON CONFLICT DO NOTHING;

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  password_hash TEXT,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, email)
);

-- ---------------------------------------------------------------------------
-- News ingest (Phase 1)
-- ---------------------------------------------------------------------------

CREATE TABLE feeds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  category      TEXT NOT NULL,
  variant       TEXT NOT NULL DEFAULT 'full',
  lang          TEXT NOT NULL DEFAULT 'en',
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, url)
);

CREATE TABLE news_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  feed_id       UUID REFERENCES feeds(id) ON DELETE SET NULL,
  source        TEXT NOT NULL,
  title         TEXT NOT NULL,
  link          TEXT NOT NULL,
  link_hash     TEXT NOT NULL,
  published_at  TIMESTAMPTZ NOT NULL,
  variant       TEXT NOT NULL DEFAULT 'full',
  lang          TEXT NOT NULL DEFAULT 'en',
  category      TEXT,
  threat_level  TEXT,
  is_alert      BOOLEAN NOT NULL DEFAULT FALSE,
  confidence    REAL,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cold_ref      TEXT,
  UNIQUE (workspace_id, link_hash)
);

CREATE INDEX idx_news_items_published ON news_items (workspace_id, published_at DESC);
CREATE INDEX idx_news_items_category ON news_items (workspace_id, category, published_at DESC);
CREATE INDEX idx_news_items_variant ON news_items (workspace_id, variant, lang, published_at DESC);

CREATE TABLE briefs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brief_type    TEXT NOT NULL,
  scope_key     TEXT NOT NULL,
  title         TEXT,
  body          TEXT NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cold_ref      TEXT,
  UNIQUE (workspace_id, brief_type, scope_key, generated_at)
);

CREATE INDEX idx_briefs_scope ON briefs (workspace_id, brief_type, scope_key, generated_at DESC);

CREATE TABLE subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  rules_json    JSONB NOT NULL DEFAULT '{}',
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE subscription_matches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  news_item_id    UUID NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
  matched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified        BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (subscription_id, news_item_id)
);

CREATE TABLE notification_deliveries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  channel       TEXT NOT NULL DEFAULT 'email',
  payload_ref   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  sent_at       TIMESTAMPTZ,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE llm_cache (
  cache_key     TEXT PRIMARY KEY,
  workspace_id  UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  response_json JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Cold storage index (OSS pointers)
-- ---------------------------------------------------------------------------

CREATE TABLE cold_object_index (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  object_key    TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     UUID,
  checksum      TEXT,
  byte_size     BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, object_key)
);

-- ---------------------------------------------------------------------------
-- Phase 2–4 reserved (no business logic yet)
-- news_embeddings → 002_schema_pgvector.sql when pgvector is installed
-- ---------------------------------------------------------------------------

CREATE TABLE entities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL,
  name          TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE entity_mentions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  news_item_id  UUID NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, news_item_id)
);

CREATE TABLE monitor_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  monitor_type  TEXT NOT NULL,
  name          TEXT NOT NULL,
  config_json   JSONB NOT NULL DEFAULT '{}',
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tracking_threads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_definitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_type    TEXT NOT NULL,
  tools_json    JSONB NOT NULL DEFAULT '[]',
  prompt_template TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id      UUID REFERENCES agent_definitions(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  input_json    JSONB NOT NULL DEFAULT '{}',
  output_ref    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ
);

CREATE TABLE api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key_hash      TEXT NOT NULL,
  label         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ
);

CREATE TABLE usage_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  quantity      INT NOT NULL DEFAULT 1,
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE webhook_endpoints (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  secret_hash   TEXT,
  events_json   JSONB NOT NULL DEFAULT '[]',
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE integration_channels (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_type  TEXT NOT NULL,
  config_encrypted TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ingest_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  variant       TEXT NOT NULL,
  lang          TEXT NOT NULL DEFAULT 'en',
  feeds_total   INT NOT NULL DEFAULT 0,
  items_upserted INT NOT NULL DEFAULT 0,
  errors        INT NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'running'
);
