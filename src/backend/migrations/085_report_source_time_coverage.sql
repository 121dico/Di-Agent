-- 数据源可用日期聚合元数据，不保存用户明细或认证值。
CREATE TABLE IF NOT EXISTS report_source_time_coverage (
 source_id uuid PRIMARY KEY REFERENCES report_data_sources(id) ON DELETE CASCADE,
 coverage jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
---- DOWN
DROP TABLE IF EXISTS report_source_time_coverage;
