-- Per-user subscription email delivery: individual vs merged digest + schedule.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS merged_delivery_time TEXT,
  ADD COLUMN IF NOT EXISTS merged_delivery_timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  ADD COLUMN IF NOT EXISTS merged_delivery_last_sent_date DATE;

COMMENT ON COLUMN users.delivery_mode IS 'individual = one email per subscription; merged = one combined email per user';
COMMENT ON COLUMN users.merged_delivery_time IS 'Local HH:MM when merged digest may be sent (user timezone)';
COMMENT ON COLUMN users.merged_delivery_timezone IS 'IANA timezone for merged_delivery_time';
COMMENT ON COLUMN users.merged_delivery_last_sent_date IS 'Last calendar date (user TZ) a merged digest was sent';

UPDATE users
SET merged_delivery_time = COALESCE(NULLIF(TRIM(merged_delivery_time), ''), '08:00')
WHERE delivery_mode = 'merged'
  AND (merged_delivery_time IS NULL OR TRIM(merged_delivery_time) = '');
