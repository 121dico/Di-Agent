-- 保存查询返回的有界结果及来源，避免复制整张 Hive 原始表。
CREATE TABLE IF NOT EXISTS hive_query_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    table_name TEXT NOT NULL,
    sql_text TEXT NOT NULL,
    rows_json JSONB NOT NULL,
    row_count INTEGER NOT NULL,
    duration_ms BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hive_query_receipts_owner_created
    ON hive_query_receipts(owner_user_id, created_at DESC);

---- DOWN
DROP TABLE IF EXISTS hive_query_receipts;
