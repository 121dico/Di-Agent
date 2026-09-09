-- 原生计量按派发去重；保留旧估算账本供历史审计，不把它混进真实累计。
CREATE TABLE IF NOT EXISTS agent_token_usage (
    task_id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    usage JSONB NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_token_usage_context ON agent_token_usage(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_token_usage_totals ON agent_token_usage(conversation_id, agent_id);
-- 旧 schema 要求正窗口，未知容量现在允许为零。
ALTER TABLE agent_sessions DROP CONSTRAINT IF EXISTS agent_sessions_context_window_tokens_check;
ALTER TABLE agent_sessions ADD CONSTRAINT agent_sessions_context_window_tokens_check CHECK (context_window_tokens >= 0);
ALTER TABLE agent_sessions DROP CONSTRAINT IF EXISTS agent_sessions_budget_status_check;
ALTER TABLE agent_sessions ADD CONSTRAINT agent_sessions_budget_status_check CHECK (budget_status IN ('normal', 'warning', 'critical', 'unknown'));

---- DOWN
DROP TABLE IF EXISTS agent_token_usage;
