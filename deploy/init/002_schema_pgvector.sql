-- Optional: requires pgvector installed on the PostgreSQL server
-- Windows: https://github.com/pgvector/pgvector#installation
-- Skip automatically if extension is unavailable (Phase 1 does not need this)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS news_embeddings (
  news_item_id  UUID PRIMARY KEY REFERENCES news_items(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  embedding     vector(384),
  model         TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
