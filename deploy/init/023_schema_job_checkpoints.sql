-- Job checkpoints (incremental processing + DAG coordination)

CREATE TABLE job_checkpoints (
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  handler_key       TEXT NOT NULL,
  checkpoint_json   JSONB NOT NULL DEFAULT '{}',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, handler_key)
);

CREATE INDEX idx_job_checkpoints_updated
  ON job_checkpoints (workspace_id, updated_at DESC);
