-- Default daily delivery schedule for all users (individual + merged).

UPDATE users
SET merged_delivery_time = COALESCE(NULLIF(TRIM(merged_delivery_time), ''), '08:00')
WHERE merged_delivery_time IS NULL OR TRIM(merged_delivery_time) = '';

UPDATE users
SET merged_delivery_timezone = COALESCE(NULLIF(TRIM(merged_delivery_timezone), ''), 'Asia/Shanghai')
WHERE merged_delivery_timezone IS NULL OR TRIM(merged_delivery_timezone) = '';
