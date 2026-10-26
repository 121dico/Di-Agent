-- 用户自行验证的 Hive 表仅属于其 Di Agent 用户和当前 Hadoop 账号。
CREATE TABLE IF NOT EXISTS hive_user_tables (
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hadoop_account TEXT NOT NULL,
    table_name TEXT NOT NULL,
    dt_queryable BOOLEAN NOT NULL DEFAULT FALSE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner_user_id, hadoop_account, table_name)
);

CREATE INDEX IF NOT EXISTS idx_hive_user_tables_owner_account_recent
    ON hive_user_tables(owner_user_id, hadoop_account, added_at DESC);

---- DOWN
DROP TABLE IF EXISTS hive_user_tables;
