-- 同一版本模板与同一数据源仅生成一个实例，避免重复点击或并发请求生成副本。
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_template_instance ON report_definitions
    (data_source_id, (visualization_json->'template'->>'id'), (visualization_json->'template'->>'version'))
    WHERE visualization_json->'template'->>'id' IS NOT NULL;

-- 完整聚合结果含空值与查询溯源；不使用旧版逐日缓存，避免旧字段与补零语义污染。
CREATE TABLE IF NOT EXISTS report_template_analytics_cache (
    cache_key text PRIMARY KEY,
    report_id uuid NOT NULL REFERENCES report_definitions(id) ON DELETE CASCADE,
    result_json jsonb NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_template_cache_expiry ON report_template_analytics_cache(expires_at);

---- DOWN
DROP TABLE IF EXISTS report_template_analytics_cache;
DROP INDEX IF EXISTS uq_report_template_instance;
