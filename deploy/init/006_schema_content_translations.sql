-- Translated subscription content (inline text and/or OSS object reference)

CREATE TABLE IF NOT EXISTS content_translations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('news_item', 'brief', 'digest')),
  entity_id     UUID NOT NULL,
  source_lang   TEXT NOT NULL DEFAULT 'auto',
  target_lang   TEXT NOT NULL,
  category      TEXT,
  title_text    TEXT,
  body_text     TEXT,
  object_key    TEXT,
  checksum      TEXT,
  byte_size     BIGINT,
  provider      TEXT NOT NULL DEFAULT 'hxxbot',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, entity_type, entity_id, target_lang)
);

CREATE INDEX IF NOT EXISTS idx_content_translations_lookup
  ON content_translations (workspace_id, entity_type, entity_id, target_lang);

-- Backfill deliveryLang on existing presets (keep lang as content filter)
UPDATE subscription_presets
SET rules_json = rules_json || jsonb_build_object('deliveryLang', COALESCE(rules_json->>'deliveryLang', rules_json->>'lang', 'en'))
WHERE rules_json->>'deliveryLang' IS NULL;

CREATE INDEX IF NOT EXISTS idx_content_translations_object
  ON content_translations (object_key)
  WHERE object_key IS NOT NULL;
