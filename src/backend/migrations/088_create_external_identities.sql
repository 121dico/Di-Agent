-- 独立保存外部身份，禁止隐式合并同名本地账号。
CREATE TABLE IF NOT EXISTS external_identities (
    provider VARCHAR(32) NOT NULL,
    subject VARCHAR(128) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider, subject),
    UNIQUE (user_id)
);

---- DOWN
-- 仅供手工回滚；关闭 boss.enabled 不需要删除身份数据。
DROP TABLE IF EXISTS external_identities;
