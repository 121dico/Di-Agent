ALTER TABLE report_daily_analytics
ADD COLUMN IF NOT EXISTS total_user_count BIGINT NOT NULL DEFAULT 0;

---- DOWN
ALTER TABLE report_daily_analytics DROP COLUMN IF EXISTS total_user_count;
