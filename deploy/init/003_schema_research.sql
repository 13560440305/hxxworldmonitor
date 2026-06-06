-- Phase 2: pgvector indexes (run after 002_schema_pgvector.sql)

CREATE INDEX IF NOT EXISTS idx_news_embeddings_workspace
  ON news_embeddings (workspace_id);

CREATE INDEX IF NOT EXISTS idx_monitor_profiles_workspace_type
  ON monitor_profiles (workspace_id, monitor_type);

CREATE INDEX IF NOT EXISTS idx_entities_workspace_name
  ON entities (workspace_id, lower(name));

-- IVFFlat index — build after embeddings populated (lists=50 for dev)
-- Re-run manually when row count > 1000 for better recall
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_news_embeddings_vector_cosine
      ON news_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 32)';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping ivfflat index (need more rows or pgvector version): %', SQLERRM;
END $$;
