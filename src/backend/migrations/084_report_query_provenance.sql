-- 仅保存聚合查询快照，应用只开放追加与读取，不写用户明细。
CREATE TABLE IF NOT EXISTS report_query_executions (
 id uuid PRIMARY KEY,
 report_id uuid NOT NULL REFERENCES report_definitions(id),
 source_id uuid NOT NULL REFERENCES report_data_sources(id),
 query_key text NOT NULL,
 payload_json jsonb NOT NULL,
 created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_query_executions_report ON report_query_executions(report_id, created_at DESC);

---- DOWN
DROP TABLE IF EXISTS report_query_executions;
