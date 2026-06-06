-- Phase 1: Admin-managed subscription catalog (presets)

CREATE TABLE IF NOT EXISTS subscription_presets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  rules_json    JSONB NOT NULL DEFAULT '{}',
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_subscription_presets_sort
  ON subscription_presets (workspace_id, enabled, sort_order, title);

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS preset_id UUID REFERENCES subscription_presets(id) ON DELETE SET NULL;

-- Default catalog for default workspace
INSERT INTO subscription_presets (workspace_id, slug, title, description, rules_json, sort_order)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'daily-brief-zh',
    '每日世界简报（中文）',
    'AI 生成的全球要闻简报，每日一封',
    '{"mode":"daily_brief","variant":"full","lang":"zh"}'::jsonb,
    10
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'daily-brief-en',
    'Daily World Brief (English)',
    'AI-generated global news brief in English',
    '{"mode":"daily_brief","variant":"full","lang":"en"}'::jsonb,
    20
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'tech-daily',
    '科技每日简报',
    'Tech variant AI brief',
    '{"mode":"daily_brief","variant":"tech","lang":"en"}'::jsonb,
    30
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'conflict-watch',
    '冲突与地缘关键词',
    '匹配 conflict 分类及 ukraine/middle east 等关键词',
    '{"mode":"keyword","categories":["conflict"],"keywords":["ukraine","gaza","taiwan","middle east"],"variant":"full","lang":"en","hours":24,"includeAiBrief":false}'::jsonb,
    40
  )
ON CONFLICT (workspace_id, slug) DO NOTHING;
