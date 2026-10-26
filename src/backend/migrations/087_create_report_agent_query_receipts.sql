CREATE TABLE IF NOT EXISTS report_agent_query_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES report_data_sources(id) ON DELETE CASCADE,
    source_name TEXT NOT NULL,
    request_json JSONB NOT NULL,
    rows_json JSONB NOT NULL,
    pagination_json JSONB NOT NULL,
    source_partition TEXT NOT NULL DEFAULT '',
    upstream_query_id TEXT NOT NULL DEFAULT '',
    duration_ms BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_agent_query_receipts_owner_created
    ON report_agent_query_receipts(owner_user_id, created_at DESC);

---- DOWN
DROP TABLE IF EXISTS report_agent_query_receipts;
