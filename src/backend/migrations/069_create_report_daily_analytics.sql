CREATE TABLE IF NOT EXISTS report_daily_analytics (
    report_id UUID NOT NULL REFERENCES report_definitions(id) ON DELETE CASCADE,
    stat_date DATE NOT NULL,
    avg_price_sensitivity_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    avg_d1_price_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    avg_d2_coupon_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    avg_d3_time_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_order_count BIGINT NOT NULL DEFAULT 0,
    calculated_user_count BIGINT NOT NULL DEFAULT 0,
    distribution_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (report_id, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_report_daily_analytics_range
    ON report_daily_analytics(report_id, stat_date DESC);

---- DOWN
DROP TABLE IF EXISTS report_daily_analytics;
