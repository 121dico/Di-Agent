CREATE TABLE IF NOT EXISTS report_data_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    endpoint TEXT NOT NULL,
    api_name VARCHAR(160) NOT NULL,
    app_key_env VARCHAR(160) NOT NULL DEFAULT '',
    signature_env VARCHAR(160) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    data_source_id UUID NOT NULL REFERENCES report_data_sources(id),
    query_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    visualization_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_runs (
    id UUID PRIMARY KEY,
    report_id UUID NOT NULL REFERENCES report_definitions(id),
    trigger VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL,
    requested_by UUID REFERENCES users(id),
    snapshot_json JSONB,
    source_partition VARCHAR(80) NOT NULL DEFAULT '',
    query_id VARCHAR(200) NOT NULL DEFAULT '',
    duration_ms BIGINT NOT NULL DEFAULT 0,
    error_message TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_report_runs_report_started ON report_runs(report_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_definitions_enabled ON report_definitions(enabled);

---- DOWN
DROP TABLE IF EXISTS report_runs;
DROP TABLE IF EXISTS report_definitions;
DROP TABLE IF EXISTS report_data_sources;
