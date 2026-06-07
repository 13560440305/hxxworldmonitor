-- Store RSS source URLs used when generating AI briefs (for email appendix links).

ALTER TABLE briefs
  ADD COLUMN IF NOT EXISTS source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_briefs_source_refs
  ON briefs USING gin (source_refs_json);
