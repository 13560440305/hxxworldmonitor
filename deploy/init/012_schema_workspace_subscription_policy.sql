-- Per-workspace self-service subscription policy

ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS self_service_subscriptions_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS max_subscriptions_per_user INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN workspace_settings.self_service_subscriptions_enabled IS
  'When false, users cannot subscribe/unsubscribe via /platform/v1/auth/*';
COMMENT ON COLUMN workspace_settings.max_subscriptions_per_user IS
  'Max active subscriptions per user; 0 = unlimited';

-- Ensure default workspace has a settings row
INSERT INTO workspace_settings (workspace_id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (workspace_id) DO NOTHING;
