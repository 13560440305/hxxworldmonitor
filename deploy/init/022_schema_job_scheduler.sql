-- Platform job scheduler (Producer tier-3) + reserved tables for equity / knowledge graph

-- ---------------------------------------------------------------------------
-- Job definitions & runs
-- ---------------------------------------------------------------------------

CREATE TABLE job_definitions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  handler_key      TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  tier             TEXT NOT NULL DEFAULT 'batch'
                   CHECK (tier IN ('realtime', 'batch', 'heavy')),
  schedule_kind    TEXT NOT NULL DEFAULT 'interval'
                   CHECK (schedule_kind IN ('interval', 'cron')),
  cron_expr        TEXT,
  interval_seconds INT,
  timezone         TEXT NOT NULL DEFAULT 'UTC',
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  max_concurrency  INT NOT NULL DEFAULT 1,
  timeout_sec      INT NOT NULL DEFAULT 3600,
  max_attempts     INT NOT NULL DEFAULT 3,
  payload_json     JSONB NOT NULL DEFAULT '{}',
  next_run_at      TIMESTAMPTZ,
  last_run_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, handler_key)
);

CREATE INDEX idx_job_definitions_due
  ON job_definitions (next_run_at)
  WHERE enabled = TRUE;

CREATE TABLE job_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  definition_id  UUID REFERENCES job_definitions(id) ON DELETE SET NULL,
  handler_key    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  payload_json   JSONB NOT NULL DEFAULT '{}',
  scheduled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  locked_by      TEXT,
  locked_until   TIMESTAMPTZ,
  attempt        INT NOT NULL DEFAULT 1,
  max_attempts   INT NOT NULL DEFAULT 3,
  error_message  TEXT,
  stats_json     JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_runs_pending
  ON job_runs (scheduled_at)
  WHERE status = 'pending';

CREATE INDEX idx_job_runs_handler_running
  ON job_runs (handler_key, status)
  WHERE status = 'running';

-- ---------------------------------------------------------------------------
-- Equity / filings (Phase 4 — skeleton)
-- ---------------------------------------------------------------------------

CREATE TABLE company_filings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  symbol        TEXT NOT NULL,
  company_name  TEXT,
  filing_type   TEXT NOT NULL,
  period_end    DATE,
  source_url    TEXT,
  raw_ref       TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}',
  published_at  TIMESTAMPTZ,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, symbol, filing_type, period_end, source_url)
);

CREATE INDEX idx_company_filings_symbol ON company_filings (workspace_id, symbol, ingested_at DESC);

-- ---------------------------------------------------------------------------
-- Knowledge graph (Phase 4 — skeleton, PG-native edges)
-- ---------------------------------------------------------------------------

CREATE TABLE kg_entities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL,
  external_key  TEXT NOT NULL,
  name          TEXT NOT NULL,
  props_json    JSONB NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, entity_type, external_key)
);

CREATE TABLE kg_edges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_entity_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  to_entity_id   UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  relation_type  TEXT NOT NULL,
  props_json     JSONB NOT NULL DEFAULT '{}',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, from_entity_id, to_entity_id, relation_type)
);

CREATE INDEX idx_kg_edges_from ON kg_edges (workspace_id, from_entity_id);
CREATE INDEX idx_kg_edges_to ON kg_edges (workspace_id, to_entity_id);
